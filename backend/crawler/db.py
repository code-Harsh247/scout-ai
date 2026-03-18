"""
Supabase database helpers for the crawler.

All functions are synchronous and designed to be called via asyncio.to_thread()
so they don't block the event loop during crawling.

If SUPABASE_URL / SUPABASE_SERVICE_KEY are not set, all writes are silent no-ops
and a single warning is logged.  This lets the crawler run locally without a
Supabase project configured (Phase 1 dev mode).
"""

import base64
import logging
import os
import time
import uuid
from typing import Optional

log = logging.getLogger("scout")

_client = None
_warned = False

_DB_RETRIES = 3
_DB_RETRY_DELAY = 0.15


def _error_text(exc: Exception) -> str:
    return str(exc)


def _is_retryable(exc: Exception) -> bool:
    txt = _error_text(exc).lower()
    needles = [
        "server disconnected",
        "connectionterminated",
        "protocol_error",
        "connection reset",
        "timed out",
        "timeout",
        "temporarily unavailable",
    ]
    return any(n in txt for n in needles)


def _is_fk_violation(exc: Exception) -> bool:
    txt = _error_text(exc)
    return "'code': '23503'" in txt or '"code":"23503"' in txt


def _is_duplicate_conflict(exc: Exception) -> bool:
    txt = _error_text(exc)
    return "'code': '23505'" in txt or '"code":"23505"' in txt or " 409 " in txt


def _run_with_retry(action, label: str):
    for attempt in range(1, _DB_RETRIES + 1):
        try:
            return action()
        except Exception as e:
            if _is_retryable(e) and attempt < _DB_RETRIES:
                time.sleep(_DB_RETRY_DELAY * attempt)
                continue
            raise


def _get_client():
    global _client, _warned
    if _client is not None:
        return _client

    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

    if not url or not key:
        if not _warned:
            log.warning(
                "[db] SUPABASE_URL or SUPABASE_SERVICE_KEY not configured — "
                "crawl data will NOT be persisted to the database."
            )
            _warned = True
        return None

    try:
        from supabase import create_client  # type: ignore
        _client = create_client(url, key)
        log.info("[db] Supabase client initialised  url=%s", url[:40])
        return _client
    except Exception as e:
        log.warning("[db] Failed to initialise Supabase client: %s", e)
        return None


# ---------------------------------------------------------------------------
# Supabase Storage helpers  (screenshots → bucket instead of TEXT column)
# ---------------------------------------------------------------------------

_SCREENSHOT_BUCKET = "screenshots"
_bucket_ensured = False


def _ensure_bucket() -> bool:
    """Create the screenshots bucket if it doesn't exist yet. Returns True on success."""
    global _bucket_ensured
    if _bucket_ensured:
        return True
    client = _get_client()
    if not client:
        return False
    try:
        client.storage.get_bucket(_SCREENSHOT_BUCKET)
        _bucket_ensured = True
        return True
    except Exception:
        try:
            client.storage.create_bucket(
                _SCREENSHOT_BUCKET,
                options={"public": True},
            )
            _bucket_ensured = True
            log.info("[db] Created storage bucket '%s'", _SCREENSHOT_BUCKET)
            return True
        except Exception as e:
            # Bucket might already exist (race / previous run)
            if "already exists" in str(e).lower() or "Duplicate" in str(e):
                _bucket_ensured = True
                return True
            log.warning("[db] Failed to create storage bucket: %s", e)
            return False


def upload_screenshot(path: str, screenshot_b64: str) -> Optional[str]:
    """Upload a base64-encoded screenshot to Supabase Storage.

    Args:
        path: storage object path, e.g. "crawl/{session_id}/{page_id}.jpg"
        screenshot_b64: base64-encoded image bytes

    Returns:
        The public URL of the uploaded file, or None on failure.
    """
    client = _get_client()
    if not client or not screenshot_b64:
        return None
    if not _ensure_bucket():
        return None
    try:
        image_bytes = base64.b64decode(screenshot_b64)
        client.storage.from_(_SCREENSHOT_BUCKET).upload(
            path,
            image_bytes,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        url = client.storage.from_(_SCREENSHOT_BUCKET).get_public_url(path)
        return url
    except Exception as e:
        log.warning("[db] upload_screenshot %s: %s", path, e)
        return None


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def create_session(root_url: str, config: dict, user_id: Optional[str] = None) -> str:
    """Insert a new crawl_sessions row.  Returns the session UUID."""
    session_id = str(uuid.uuid4())
    client = _get_client()
    if client:
        try:
            row: dict = {
                "id": session_id,
                "root_url": root_url,
                "status": "running",
                "config": config,
            }
            if user_id:
                row["user_id"] = user_id
            client.table("crawl_sessions").insert(row).execute()
        except Exception as e:
            log.warning("[db] create_session: %s", e)
            # If FK violation (e.g. user_id not in profiles), retry without user_id
            if user_id and _is_fk_violation(e):
                log.warning("[db] create_session FK fallback: retrying without user_id")
                try:
                    row.pop("user_id", None)
                    client.table("crawl_sessions").insert(row).execute()
                except Exception as e2:
                    log.warning("[db] create_session FK fallback failed: %s", e2)
    return session_id


def update_session(session_id: str, **kwargs):
    client = _get_client()
    if client:
        try:
            _run_with_retry(
                lambda: client.table("crawl_sessions").update(kwargs).eq("id", session_id).execute(),
                "update_session",
            )
        except Exception as e:
            # Gracefully handle schema drift (missing columns in older migrations).
            msg = _error_text(e)
            if "PGRST204" in msg and "Could not find the" in msg and "column" in msg:
                safe_kwargs = dict(kwargs)
                for k in ["broken_links_found", "pages_visited", "pages_skipped"]:
                    if f"'{k}'" in msg or f'"{k}"' in msg:
                        safe_kwargs.pop(k, None)
                if safe_kwargs:
                    try:
                        _run_with_retry(
                            lambda: client.table("crawl_sessions").update(safe_kwargs).eq("id", session_id).execute(),
                            "update_session_fallback",
                        )
                        log.warning("[db] update_session fallback succeeded after removing unknown column")
                        return
                    except Exception as e2:
                        log.warning("[db] update_session fallback: %s", e2)
            log.warning("[db] update_session: %s", e)


# ---------------------------------------------------------------------------
# Page helpers
# ---------------------------------------------------------------------------

def insert_page(
    session_id: str,
    url: str,
    url_pattern: Optional[str],
    is_template_representative: bool,
    status_code: Optional[int],
    page_title: str,
    dom_hash: str,
    depth: int,
    screenshot_b64: Optional[str] = None,
) -> Optional[str]:
    """Insert a crawled_pages row.  Returns the generated page UUID."""
    page_id = str(uuid.uuid4())
    client = _get_client()
    if client:
        try:
            row: dict = {
                "id": page_id,
                "session_id": session_id,
                "url": url,
                "url_pattern": url_pattern,
                "is_template_representative": is_template_representative,
                "status_code": status_code,
                "page_title": page_title,
                "dom_hash": dom_hash,
                "depth": depth,
            }
            # Upload screenshot to Supabase Storage, store URL in DB
            if screenshot_b64:
                ss_url = upload_screenshot(
                    f"crawl/{session_id}/{page_id}.jpg", screenshot_b64,
                )
                if ss_url:
                    row["screenshot_url"] = ss_url
            _run_with_retry(lambda: client.table("crawled_pages").insert(row).execute(), "insert_page")
        except Exception as e:
            log.warning("[db] insert_page: %s", e)
            return None
    return page_id


def update_page_screenshot(page_id: str, screenshot_b64: str, session_id: str = "") -> None:
    """Upload screenshot to storage and update the crawled_pages row with the URL."""
    client = _get_client()
    if client and screenshot_b64:
        ss_url = upload_screenshot(
            f"crawl/{session_id or 'unknown'}/{page_id}.jpg", screenshot_b64,
        )
        if ss_url:
            try:
                client.table("crawled_pages").update(
                    {"screenshot_url": ss_url}
                ).eq("id", page_id).execute()
            except Exception as e:
                log.warning("[db] update_page_screenshot: %s", e)


# ---------------------------------------------------------------------------
# Link helpers
# ---------------------------------------------------------------------------

def insert_link(
    session_id: str,
    from_page_id: Optional[str],
    to_url: str,
    link_text: str,
    status_code: Optional[int],
    link_status: str,
    is_internal: bool,
    final_url: str,
):
    client = _get_client()
    if client:
        try:
            _run_with_retry(lambda: client.table("crawled_links").insert({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "from_page_id": from_page_id or None,
                "to_url": to_url,
                "link_text": link_text,
                "status_code": status_code,
                "link_status": link_status,
                "is_internal": is_internal,
                "final_url": final_url,
            }).execute(), "insert_link")
        except Exception as e:
            if _is_duplicate_conflict(e):
                log.debug("[db] insert_link duplicate/conflict ignored")
                return
            if _is_fk_violation(e):
                # If page row is missing, keep link row by dropping parent reference.
                try:
                    _run_with_retry(lambda: client.table("crawled_links").insert({
                        "id": str(uuid.uuid4()),
                        "session_id": session_id,
                        "from_page_id": None,
                        "to_url": to_url,
                        "link_text": link_text,
                        "status_code": status_code,
                        "link_status": link_status,
                        "is_internal": is_internal,
                        "final_url": final_url,
                    }).execute(), "insert_link_fk_fallback")
                    log.warning("[db] insert_link FK fallback: inserted without from_page_id")
                    return
                except Exception as e2:
                    log.warning("[db] insert_link FK fallback failed: %s", e2)
            log.warning("[db] insert_link: %s", e)


# ---------------------------------------------------------------------------
# Template pattern helpers
# ---------------------------------------------------------------------------

def upsert_template_pattern(
    session_id: str,
    pattern: str,
    representative_page_id: Optional[str],
    sample_count: int,
    estimated_total: int,
    dom_hash: str,
):
    client = _get_client()
    if client:
        try:
            existing = (
                client.table("template_patterns")
                .select("id")
                .eq("session_id", session_id)
                .eq("pattern", pattern)
                .execute()
            )
            if existing.data:
                _run_with_retry(
                    lambda: client.table("template_patterns").update({
                        "sample_count": sample_count,
                        "estimated_total_pages": estimated_total,
                    }).eq("id", existing.data[0]["id"]).execute(),
                    "upsert_template_pattern_update",
                )
            else:
                _run_with_retry(lambda: client.table("template_patterns").insert({
                    "id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "pattern": pattern,
                    "representative_page_id": representative_page_id or None,
                    "sample_count": sample_count,
                    "estimated_total_pages": estimated_total,
                    "dom_hash": dom_hash,
                }).execute(), "upsert_template_pattern_insert")
        except Exception as e:
            if _is_fk_violation(e):
                # Keep the template row even when representative page write lagged/failed.
                try:
                    existing = (
                        client.table("template_patterns")
                        .select("id")
                        .eq("session_id", session_id)
                        .eq("pattern", pattern)
                        .execute()
                    )
                    if existing.data:
                        _run_with_retry(
                            lambda: client.table("template_patterns").update({
                                "sample_count": sample_count,
                                "estimated_total_pages": estimated_total,
                            }).eq("id", existing.data[0]["id"]).execute(),
                            "upsert_template_pattern_fk_update",
                        )
                    else:
                        _run_with_retry(lambda: client.table("template_patterns").insert({
                            "id": str(uuid.uuid4()),
                            "session_id": session_id,
                            "pattern": pattern,
                            "representative_page_id": None,
                            "sample_count": sample_count,
                            "estimated_total_pages": estimated_total,
                            "dom_hash": dom_hash,
                        }).execute(), "upsert_template_pattern_fk_insert")
                    log.warning("[db] upsert_template_pattern FK fallback: inserted/updated without representative_page_id")
                    return
                except Exception as e2:
                    log.warning("[db] upsert_template_pattern FK fallback failed: %s", e2)
            log.warning("[db] upsert_template_pattern: %s", e)


# ---------------------------------------------------------------------------
# Audit session helpers  (Phase 3 — saved when Supabase is configured)
# ---------------------------------------------------------------------------

def create_audit_session(
    root_url: str,
    crawl_session_id: Optional[str],
    user_id: Optional[str],
) -> str:
    """Insert a new audit_sessions row.  Returns the generated UUID."""
    audit_session_id = str(uuid.uuid4())
    client = _get_client()
    if client:
        try:
            row: dict = {
                "id":     audit_session_id,
                "root_url": root_url,
                "status": "running",
            }
            if crawl_session_id:
                row["crawl_session_id"] = crawl_session_id
            if user_id:
                row["user_id"] = user_id
            client.table("audit_sessions").insert(row).execute()
        except Exception as e:
            log.warning("[db] create_audit_session: %s", e)
            # FK on crawl_session_id or user_id → profiles: retry stripping offending fields
            if _is_fk_violation(e):
                for drop_keys in (
                    ["crawl_session_id", "user_id"],
                    ["crawl_session_id"],
                    ["user_id"],
                ):
                    retried_row = {k: v for k, v in row.items() if k not in drop_keys}
                    try:
                        client.table("audit_sessions").insert(retried_row).execute()
                        log.warning("[db] create_audit_session FK fallback succeeded (dropped %s)", drop_keys)
                        break
                    except Exception as e2:
                        if not _is_fk_violation(e2):
                            log.warning("[db] create_audit_session FK fallback: %s", e2)
                            break
    return audit_session_id


def save_page_audit(
    audit_session_id: str,
    url: str,
    ui_report: Optional[dict],
    ux_report: Optional[dict],
    compliance_report: Optional[dict],
    seo_report: Optional[dict],
    overall_score: Optional[float],
    screenshot_b64: Optional[str] = None,
    security_report: Optional[dict] = None,
) -> None:
    """Insert a page_audits row."""
    client = _get_client()
    if client:
        try:
            page_audit_id = str(uuid.uuid4())
            row: dict = {
                "id":                page_audit_id,
                "audit_session_id":  audit_session_id,
                "url":               url,
                "ui_report":         ui_report,
                "ux_report":         ux_report,
                "compliance_report": compliance_report,
                "seo_report":        seo_report,
                "overall_score":     overall_score,
            }
            if security_report is not None:
                row["security_report"] = security_report
            # Upload screenshot to storage, store URL in DB
            if screenshot_b64:
                ss_url = upload_screenshot(
                    f"audit/{audit_session_id}/{page_audit_id}.jpg", screenshot_b64,
                )
                if ss_url:
                    row["screenshot_url"] = ss_url
            client.table("page_audits").insert(row).execute()
        except Exception as e:
            log.warning("[db] save_page_audit: %s", e)


def complete_audit_session(
    audit_session_id: str,
    overall_score: Optional[float],
) -> None:
    """Mark an audit_sessions row as complete."""
    import datetime
    client = _get_client()
    if client:
        try:
            client.table("audit_sessions").update({
                "status":       "complete",
                "overall_score": overall_score,
                "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }).eq("id", audit_session_id).execute()
        except Exception as e:
            log.warning("[db] complete_audit_session: %s", e)


# ---------------------------------------------------------------------------
# Security session helpers  (Phase 5)
# ---------------------------------------------------------------------------

def create_security_session(
    crawl_session_id: Optional[str],
    mode: str,
    user_id: Optional[str],
    audit_session_id: Optional[str] = None,
) -> str:
    """Insert a new security_sessions row. Returns the generated UUID.

    Both crawl_session_id and audit_session_id are optional — at least one
    should be provided so the session can be looked up later.
    """
    security_session_id = str(uuid.uuid4())
    client = _get_client()
    if client:
        try:
            row: dict = {
                "id": security_session_id,
                "mode": mode,
                "status": "running",
            }
            if crawl_session_id:
                row["crawl_session_id"] = crawl_session_id
            if audit_session_id:
                row["audit_session_id"] = audit_session_id
            if user_id:
                row["user_id"] = user_id
            client.table("security_sessions").insert(row).execute()
        except Exception as e:
            log.warning("[db] create_security_session: %s", e)
            # FK on user_id → profiles may still exist if phase9 migration hasn't run.
            # Retry without user_id so the session is still created.
            if _is_fk_violation(e) and user_id:
                try:
                    fallback_row = {k: v for k, v in row.items() if k != "user_id"}
                    client.table("security_sessions").insert(fallback_row).execute()
                    log.warning("[db] create_security_session FK fallback succeeded (dropped user_id)")
                except Exception as e2:
                    log.warning("[db] create_security_session FK fallback failed: %s", e2)
    return security_session_id


def save_security_finding(
    security_session_id: str,
    page_id: Optional[str],
    url: str,
    category: str,
    title: str,
    description: str,
    severity: str,
    confidence: str,
    recommendation: str,
    evidence_json: Optional[dict],
    scope: str = "site_wide",
) -> None:
    """Insert one security_findings row."""
    client = _get_client()
    if client:
        try:
            row: dict = {
                "id": str(uuid.uuid4()),
                "security_session_id": security_session_id,
                "url": url,
                "category": category,
                "title": title,
                "description": description,
                "severity": severity,
                "confidence": confidence,
                "recommendation": recommendation,
                "evidence_json": evidence_json or {},
                "scope": scope,
            }
            if page_id:
                row["page_id"] = page_id
            client.table("security_findings").insert(row).execute()
        except Exception as e:
            log.warning("[db] save_security_finding: %s", e)


def complete_security_session(
    security_session_id: str,
    overall_score: Optional[float],
    scanned_pages: int,
    finding_counts: dict,
) -> None:
    """Mark security_sessions row as complete with summary metrics."""
    import datetime

    client = _get_client()
    if client:
        try:
            client.table("security_sessions").update({
                "status": "complete",
                "overall_score": overall_score,
                "scanned_pages": scanned_pages,
                "critical_count": int(finding_counts.get("critical", 0)),
                "high_count": int(finding_counts.get("high", 0)),
                "medium_count": int(finding_counts.get("medium", 0)),
                "low_count": int(finding_counts.get("low", 0)),
                "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }).eq("id", security_session_id).execute()
        except Exception as e:
            log.warning("[db] complete_security_session: %s", e)


def save_phased_prompts(
    audit_session_id: str,
    phased_prompts: list,
) -> None:
    """Persist phased_prompts JSON into the audit_sessions row."""
    client = _get_client()
    if client:
        try:
            client.table("audit_sessions").update({
                "phased_prompts": phased_prompts,
            }).eq("id", audit_session_id).execute()
        except Exception as e:
            log.warning("[db] save_phased_prompts: %s", e)
