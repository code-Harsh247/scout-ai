"""
Supabase database helpers for the crawler.

All functions are synchronous and designed to be called via asyncio.to_thread()
so they don't block the event loop during crawling.

If SUPABASE_URL / SUPABASE_SERVICE_KEY are not set, all writes are silent no-ops
and a single warning is logged.  This lets the crawler run locally without a
Supabase project configured (Phase 1 dev mode).
"""

import logging
import os
import uuid
from typing import Optional

log = logging.getLogger("scout")

_client = None
_warned = False


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
    return session_id


def update_session(session_id: str, **kwargs):
    client = _get_client()
    if client:
        try:
            client.table("crawl_sessions").update(kwargs).eq("id", session_id).execute()
        except Exception as e:
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
) -> str:
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
            if screenshot_b64:
                row["screenshot_b64"] = screenshot_b64
            client.table("crawled_pages").insert(row).execute()
        except Exception as e:
            log.warning("[db] insert_page: %s", e)
    return page_id


def update_page_screenshot(page_id: str, screenshot_b64: str) -> None:
    """Attach a screenshot to an already-inserted crawled_pages row."""
    client = _get_client()
    if client:
        try:
            client.table("crawled_pages").update(
                {"screenshot_b64": screenshot_b64}
            ).eq("id", page_id).execute()
        except Exception as e:
            log.warning("[db] update_page_screenshot: %s", e)


# ---------------------------------------------------------------------------
# Link helpers
# ---------------------------------------------------------------------------

def insert_link(
    session_id: str,
    from_page_id: str,
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
            client.table("crawled_links").insert({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "from_page_id": from_page_id or None,
                "to_url": to_url,
                "link_text": link_text,
                "status_code": status_code,
                "link_status": link_status,
                "is_internal": is_internal,
                "final_url": final_url,
            }).execute()
        except Exception as e:
            log.warning("[db] insert_link: %s", e)


# ---------------------------------------------------------------------------
# Template pattern helpers
# ---------------------------------------------------------------------------

def upsert_template_pattern(
    session_id: str,
    pattern: str,
    representative_page_id: str,
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
                client.table("template_patterns").update({
                    "sample_count": sample_count,
                    "estimated_total_pages": estimated_total,
                }).eq("id", existing.data[0]["id"]).execute()
            else:
                client.table("template_patterns").insert({
                    "id": str(uuid.uuid4()),
                    "session_id": session_id,
                    "pattern": pattern,
                    "representative_page_id": representative_page_id or None,
                    "sample_count": sample_count,
                    "estimated_total_pages": estimated_total,
                    "dom_hash": dom_hash,
                }).execute()
        except Exception as e:
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
    return audit_session_id


def save_page_audit(
    audit_session_id: str,
    url: str,
    ui_report: Optional[dict],
    ux_report: Optional[dict],
    compliance_report: Optional[dict],
    seo_report: Optional[dict],
    overall_score: Optional[float],
) -> None:
    """Insert a page_audits row."""
    client = _get_client()
    if client:
        try:
            client.table("page_audits").insert({
                "id":                str(uuid.uuid4()),
                "audit_session_id":  audit_session_id,
                "url":               url,
                "ui_report":         ui_report,
                "ux_report":         ux_report,
                "compliance_report": compliance_report,
                "seo_report":        seo_report,
                "overall_score":     overall_score,
            }).execute()
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
