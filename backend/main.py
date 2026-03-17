import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from langgraph.graph import StateGraph, END
from pydantic import BaseModel
from auth import get_current_user_optional

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("scout")

from agents.ui_agent import run_ui_audit
from agents.ux_agent import run_ux_audit
from agents.compliance_agent import run_compliance_audit
from agents.seo_agent import run_seo_audit
from agents.security_agent import run_security_audit, run_site_wide_security_audit, run_page_content_security_check
from tools.seo_scraper import fetch_raw_html
from tools.vision_scraper import capture_website_context
from prompt_generator import generate_phased_prompts

# ---------------------------------------------------------------------------
# 1. State
# ---------------------------------------------------------------------------

class ScoutState(TypedDict):
    target_url: str
    page_context: dict
    ui_report: dict
    ux_report: dict
    compliance_report: dict
    seo_report: dict
    security_report: dict

# ---------------------------------------------------------------------------
# 2. Graph nodes
# ---------------------------------------------------------------------------

def scrape_node(state: ScoutState) -> dict:
    """Fetch page context (DOM, screenshot, accessibility signals)."""
    url = state["target_url"]
    log.info("[scrape] START  %s", url)
    t0 = time.perf_counter()
    context = capture_website_context(url)
    elapsed = time.perf_counter() - t0
    if context.get("error"):
        log.error("[scrape] ERROR  %.1fs  %s", elapsed, context["error"])
    else:
        dom_len = len(context.get("dom", ""))
        has_ss = bool(context.get("screenshot_base64"))
        log.info("[scrape] DONE   %.1fs  dom=%d chars  screenshot=%s", elapsed, dom_len, has_ss)
    return {"page_context": context}


def ui_audit_node(state: ScoutState) -> dict:
    """Run the UI audit (Gemini 2.5 Flash + vision)."""
    log.info("[ui_auditor] START  model=gemini-2.5-flash")
    t0 = time.perf_counter()
    report = run_ui_audit(state["target_url"], state["page_context"])
    elapsed = time.perf_counter() - t0
    if "error" in report:
        log.error("[ui_auditor] ERROR  %.1fs  %s", elapsed, report["error"])
    else:
        log.info("[ui_auditor] DONE   %.1fs  overall_score=%s", elapsed, report.get("overall_score"))
    return {"ui_report": report}


def ux_audit_node(state: ScoutState) -> dict:
    """Run the UX audit (Llama 3.3 70B via Gradient)."""
    log.info("[ux_auditor] START  model=llama3.3-70b-instruct")
    t0 = time.perf_counter()
    report = run_ux_audit(state["target_url"], state["page_context"])
    elapsed = time.perf_counter() - t0
    if "error" in report:
        log.error("[ux_auditor] ERROR  %.1fs  %s", elapsed, report["error"])
    else:
        log.info("[ux_auditor] DONE   %.1fs  overall_score=%s", elapsed, report.get("overall_score"))
    return {"ux_report": report}


def compliance_audit_node(state: ScoutState) -> dict:
    """Run the compliance audit (Llama 3.3 70B via Gradient)."""
    log.info("[compliance_auditor] START  model=llama3.3-70b-instruct")
    t0 = time.perf_counter()
    report = run_compliance_audit(state["target_url"], state["page_context"])
    elapsed = time.perf_counter() - t0
    if "error" in report:
        log.error("[compliance_auditor] ERROR  %.1fs  %s", elapsed, report["error"])
    else:
        log.info("[compliance_auditor] DONE   %.1fs  overall_risk_score=%s", elapsed, report.get("overall_risk_score"))
    return {"compliance_report": report}


def seo_audit_node(state: ScoutState) -> dict:
    """Run the SEO audit (Llama 3.3 70B via Gradient + scraper checks)."""
    log.info("[seo_auditor] START  model=llama3.3-70b-instruct")
    t0 = time.perf_counter()

    url = state["target_url"]
    page_context = state["page_context"]

    fetch_res = fetch_raw_html(url)
    raw_html = fetch_res.get("raw_html", "")
    if not raw_html:
        elapsed = time.perf_counter() - t0
        error = fetch_res.get("error", "Failed to fetch raw HTML")
        log.error("[seo_auditor] ERROR  %.1fs  %s", elapsed, error)
        return {"seo_report": {"error": error}}

    rendered_dom = page_context.get("dom", "")
    playwright_succeeded = bool(page_context.get("screenshot_base64"))

    report = run_seo_audit(
        url=url,
        raw_html=raw_html,
        rendered_dom=rendered_dom,
        playwright_succeeded=playwright_succeeded,
    )

    elapsed = time.perf_counter() - t0
    if "error" in report:
        log.error("[seo_auditor] ERROR  %.1fs  %s", elapsed, report["error"])
    else:
        log.info("[seo_auditor] DONE   %.1fs  overall_score=%s", elapsed, report.get("overall_score"))
    return {"seo_report": report}


def security_audit_node(state: ScoutState) -> dict:
    """Run the passive Security audit."""
    log.info("[security_auditor] START  mode=passive")
    t0 = time.perf_counter()
    report = run_security_audit(urls=[state["target_url"]], mode="passive")
    elapsed = time.perf_counter() - t0
    if "error" in report:
        log.error("[security_auditor] ERROR  %.1fs  %s", elapsed, report["error"])
    else:
        log.info(
            "[security_auditor] DONE   %.1fs  overall_score=%s findings=%s",
            elapsed,
            report.get("overall_score"),
            len(report.get("findings", [])),
        )
    return {"security_report": report}


def merge_node(state: ScoutState) -> dict:
    """No-op merge point — all audit branches converge here."""
    return {}

# ---------------------------------------------------------------------------
# 3. Build the LangGraph
# ---------------------------------------------------------------------------

workflow = StateGraph(ScoutState)

workflow.add_node("scrape", scrape_node)
workflow.add_node("ui_auditor", ui_audit_node)
workflow.add_node("ux_auditor", ux_audit_node)
workflow.add_node("compliance_auditor", compliance_audit_node)
workflow.add_node("seo_auditor", seo_audit_node)
workflow.add_node("security_auditor", security_audit_node)
workflow.add_node("merge", merge_node)

workflow.set_entry_point("scrape")

# Fan-out: scrape -> ui/ux/compliance/seo/security (parallel)
workflow.add_edge("scrape", "ui_auditor")
workflow.add_edge("scrape", "ux_auditor")
workflow.add_edge("scrape", "compliance_auditor")
workflow.add_edge("scrape", "seo_auditor")
workflow.add_edge("scrape", "security_auditor")

# Fan-in: all auditors → merge → END
workflow.add_edge("ui_auditor", "merge")
workflow.add_edge("ux_auditor", "merge")
workflow.add_edge("compliance_auditor", "merge")
workflow.add_edge("seo_auditor", "merge")
workflow.add_edge("security_auditor", "merge")
workflow.add_edge("merge", END)

scout_graph = workflow.compile()

# -- Site-audit graph: same fan-out but WITHOUT security_auditor node --------
_site_workflow = StateGraph(ScoutState)
_site_workflow.add_node("scrape", scrape_node)
_site_workflow.add_node("ui_auditor", ui_audit_node)
_site_workflow.add_node("ux_auditor", ux_audit_node)
_site_workflow.add_node("compliance_auditor", compliance_audit_node)
_site_workflow.add_node("seo_auditor", seo_audit_node)
_site_workflow.add_node("merge", merge_node)
_site_workflow.set_entry_point("scrape")
for _n in ("ui_auditor", "ux_auditor", "compliance_auditor", "seo_auditor"):
    _site_workflow.add_edge("scrape", _n)
    _site_workflow.add_edge(_n, "merge")
_site_workflow.add_edge("merge", END)
scout_graph_no_security = _site_workflow.compile()

# ---------------------------------------------------------------------------
# 4. FastAPI + SSE streaming
# ---------------------------------------------------------------------------

app = FastAPI(title="Scout.ai")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=4)


class AuditRequest(BaseModel):
    url: str


class CrawlRequest(BaseModel):
    url: str
    options: Optional[dict] = None


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_graph(url: str) -> dict:
    """Run the full LangGraph (incl. security) synchronously — single-page /audit."""
    ui_report = None
    ux_report = None
    compliance_report = None
    seo_report = None
    security_report = None
    screenshot_base64 = None
    for event in scout_graph.stream({"target_url": url}, stream_mode="updates"):
        for node_name, update in event.items():
            if node_name == "scrape":
                ctx = update.get("page_context", {})
                if ctx.get("error"):
                    return {"error": ctx["error"]}
                screenshot_base64 = ctx.get("screenshot_base64")
            elif node_name == "ui_auditor":
                ui_report = update.get("ui_report")
            elif node_name == "ux_auditor":
                ux_report = update.get("ux_report")
            elif node_name == "compliance_auditor":
                compliance_report = update.get("compliance_report")
            elif node_name == "seo_auditor":
                seo_report = update.get("seo_report")
            elif node_name == "security_auditor":
                security_report = update.get("security_report")
    return {
        "ui_report": ui_report,
        "ux_report": ux_report,
        "compliance_report": compliance_report,
        "seo_report": seo_report,
        "security_report": security_report,
        "screenshot_base64": screenshot_base64,
    }


def _run_graph_site(url: str) -> dict:
    """Run the site-audit graph (no security node). Returns reports + page_context."""
    ui_report = None
    ux_report = None
    compliance_report = None
    seo_report = None
    page_context: dict = {}
    for event in scout_graph_no_security.stream({"target_url": url}, stream_mode="updates"):
        for node_name, update in event.items():
            if node_name == "scrape":
                page_context = update.get("page_context", {})
                if page_context.get("error"):
                    return {"error": page_context["error"]}
            elif node_name == "ui_auditor":
                ui_report = update.get("ui_report")
            elif node_name == "ux_auditor":
                ux_report = update.get("ux_report")
            elif node_name == "compliance_auditor":
                compliance_report = update.get("compliance_report")
            elif node_name == "seo_auditor":
                seo_report = update.get("seo_report")
    return {
        "ui_report": ui_report,
        "ux_report": ux_report,
        "compliance_report": compliance_report,
        "seo_report": seo_report,
        "page_context": page_context,
    }


async def _stream_audit(url: str):
    loop = asyncio.get_event_loop()
    log.info("[request] AUDIT START  url=%s", url)
    t_total = time.perf_counter()
    try:
        result = await loop.run_in_executor(_executor, lambda: _run_graph(url))

        if "error" in result:
            yield _sse({"type": "error", "message": result["error"]})
            return

        log.info("[request] AUDIT DONE   total=%.1fs", time.perf_counter() - t_total)
        yield _sse({
            "type": "result",
            "ui_report": result["ui_report"],
            "ux_report": result["ux_report"],
            "compliance_report": result["compliance_report"],
            "seo_report": result["seo_report"],
            "security_report": result["security_report"],
            "screenshot_base64": result.get("screenshot_base64"),
        })

    except Exception as exc:
        log.exception("[request] UNHANDLED ERROR  %s", exc)
        yield _sse({"type": "error", "message": str(exc)})


@app.post("/audit")
async def audit(req: AuditRequest):
    return StreamingResponse(
        _stream_audit(req.url),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/audit/compliance")
async def audit_compliance(req: AuditRequest):
    """Scrape the URL and run only the compliance audit."""
    async def _stream():
        loop = asyncio.get_event_loop()
        log.info("[request] COMPLIANCE START  url=%s", req.url)
        t0 = time.perf_counter()
        try:
            context = await loop.run_in_executor(_executor, lambda: capture_website_context(req.url))
            if context.get("error"):
                yield _sse({"type": "error", "message": context["error"]})
                return

            report = await loop.run_in_executor(_executor, lambda: run_compliance_audit(req.url, context))
            log.info("[request] COMPLIANCE DONE   %.1fs", time.perf_counter() - t0)
            yield _sse({"type": "result", "compliance_report": report})
        except Exception as exc:
            log.exception("[request] COMPLIANCE ERROR  %s", exc)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/audit/seo")
async def audit_seo(req: AuditRequest):
    """Scrape the URL and run only the SEO audit."""

    async def _stream():
        loop = asyncio.get_event_loop()
        log.info("[request] SEO START  url=%s", req.url)
        t0 = time.perf_counter()
        try:
            context = await loop.run_in_executor(_executor, lambda: capture_website_context(req.url))
            if context.get("error"):
                yield _sse({"type": "error", "message": context["error"]})
                return

            fetch_res = await loop.run_in_executor(_executor, lambda: fetch_raw_html(req.url))
            raw_html = fetch_res.get("raw_html", "")
            if not raw_html:
                yield _sse({"type": "error", "message": fetch_res.get("error", "Failed to fetch raw HTML")})
                return

            report = await loop.run_in_executor(
                _executor,
                lambda: run_seo_audit(
                    url=req.url,
                    raw_html=raw_html,
                    rendered_dom=context.get("dom", ""),
                    playwright_succeeded=bool(context.get("screenshot_base64")),
                ),
            )
            log.info("[request] SEO DONE   %.1fs", time.perf_counter() - t0)
            yield _sse({"type": "result", "seo_report": report})
        except Exception as exc:
            log.exception("[request] SEO ERROR  %s", exc)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# 6.  Site Crawler  (Phase 1)
# ---------------------------------------------------------------------------

@app.post("/crawl")
async def start_crawl(
    req: CrawlRequest,
    user: dict | None = Depends(get_current_user_optional),
):
    """
    Start a full-site BFS crawl of req.url.
    Streams SSE events: crawler_started, page_discovered, page_visiting,
    page_visited, page_skipped, broken_link, template_detected, crawl_complete.
    """
    async def _sse_stream():
        from crawler.db import create_session
        from crawler.bfs_crawler import BFSCrawler

        opts = req.options or {}
        user_id = user["sub"] if user else None
        log.info("[request] CRAWL START  url=%s  user=%s", req.url, user_id)
        t0 = time.perf_counter()

        session_id = await asyncio.to_thread(create_session, req.url, opts, user_id)

        yield _sse({
            "type": "crawler_started",
            "session_id": session_id,
            "root_url": req.url,
            "config": opts,
        })

        crawler = BFSCrawler(
            root_url=req.url,
            session_id=session_id,
            depth_limit=int(opts.get("depth_limit", 4)),
            page_limit=int(opts.get("page_limit", 150)),
            max_samples=int(opts.get("max_samples_per_template", 3)),
            concurrency=int(opts.get("concurrency", 3)),
        )

        async for event in crawler.crawl():
            yield _sse(event)

        log.info("[request] CRAWL DONE   total=%.1fs", time.perf_counter() - t0)

    return StreamingResponse(
        _sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/crawl/{session_id}")
async def get_crawl_session(session_id: str):
    """Return a crawl session summary (requires Supabase)."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        res = client.table("crawl_sessions").select("*").eq("id", session_id).single().execute()
        return res.data or {}
    except Exception as e:
        return {"error": str(e)}


@app.get("/crawl/{session_id}/pages")
async def get_crawl_pages(session_id: str, limit: int = 100, offset: int = 0):
    """Return paginated visited pages for a crawl session."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        res = (
            client.table("crawled_pages")
            .select("id,url,url_pattern,is_template_representative,status_code,page_title,depth,screenshot_url")
            .eq("session_id", session_id)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return {"pages": res.data or [], "offset": offset, "limit": limit}
    except Exception as e:
        return {"error": str(e)}


@app.get("/crawl/{session_id}/broken-links")
async def get_broken_links(session_id: str):
    """Return all broken links found in a crawl session."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        res = (
            client.table("crawled_links")
            .select("to_url,link_text,link_status,status_code,final_url,from_page_id")
            .eq("session_id", session_id)
            .neq("link_status", "ok")
            .neq("link_status", "redirect")
            .execute()
        )
        return {"broken_links": res.data or []}
    except Exception as e:
        return {"error": str(e)}


@app.get("/crawl/{session_id}/templates")
async def get_template_patterns(session_id: str):
    """Return discovered template patterns for a crawl session."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        res = (
            client.table("template_patterns")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )
        return {"templates": res.data or []}
    except Exception as e:
        return {"error": str(e)}


@app.get("/crawl/{session_id}/links")
async def get_all_links(session_id: str, limit: int = 10000, offset: int = 0):
    """Return ALL links (not just broken) for graph reconstruction."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        # Get links with from_page URL resolved via join
        res = (
            client.table("crawled_links")
            .select("to_url,link_status,is_internal,from_page_id,crawled_pages!from_page_id(url)")
            .eq("session_id", session_id)
            .range(offset, offset + limit - 1)
            .execute()
        )
        links = []
        for row in (res.data or []):
            from_url = ""
            page_data = row.get("crawled_pages")
            if isinstance(page_data, dict):
                from_url = page_data.get("url", "")
            links.append({
                "from_url": from_url,
                "to_url": row["to_url"],
                "is_broken": row.get("link_status") not in ("ok", "redirect"),
                "is_internal": row.get("is_internal", True),
            })
        return {"links": links}
    except Exception as e:
        return {"error": str(e)}


@app.get("/crawl/{session_id}/audit")
async def get_crawl_audit_session(session_id: str):
    """Return the audit session (with page results) associated with a crawl session."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        # Find audit_session linked to this crawl
        audit_res = (
            client.table("audit_sessions")
            .select("id,status,overall_score,started_at,completed_at")
            .eq("crawl_session_id", session_id)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        if not audit_res.data:
            return {"audit_session": None, "pages": []}
        audit_session = audit_res.data[0]
        # Get page audit results, with crawled_pages screenshot as fallback
        pages_res = (
            client.table("page_audits")
            .select("id,url,ui_report,ux_report,compliance_report,seo_report,overall_score,screenshot_url,created_at")
            .eq("audit_session_id", audit_session["id"])
            .order("created_at")
            .execute()
        )

        pages = pages_res.data or []

        # For any page missing a screenshot in page_audits, fall back to
        # the screenshot captured by the BFS crawler in crawled_pages.
        missing_urls = [p["url"] for p in pages if not p.get("screenshot_url")]
        if missing_urls:
            try:
                crawl_res = (
                    client.table("crawled_pages")
                    .select("url,screenshot_url")
                    .eq("session_id", session_id)
                    .in_("url", missing_urls)
                    .execute()
                )
                crawl_shots = {r["url"]: r["screenshot_url"] for r in (crawl_res.data or []) if r.get("screenshot_url")}
                for p in pages:
                    if not p.get("screenshot_url") and p["url"] in crawl_shots:
                        p["screenshot_url"] = crawl_shots[p["url"]]
            except Exception as _e:
                log.debug("[audit/restore] crawled_pages screenshot fallback failed: %s", _e)

        # Enrich with security findings split by scope
        sec_session_res = (
            client.table("security_sessions")
            .select("id,overall_score,critical_count,high_count,medium_count,low_count")
            .eq("crawl_session_id", session_id)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        sec_session = (sec_session_res.data or [None])[0]
        site_wide_findings: list = []
        page_content_findings_by_url: dict[str, list] = {}

        if sec_session and sec_session.get("id"):
            sec_findings_res = (
                client.table("security_findings")
                .select("id,url,category,title,description,severity,confidence,recommendation,evidence_json,scope")
                .eq("security_session_id", sec_session["id"])
                .execute()
            )
            for f in (sec_findings_res.data or []):
                scope = str(f.get("scope", "site_wide")).lower()
                if scope == "page_content":
                    f_url = str(f.get("url", ""))
                    page_content_findings_by_url.setdefault(f_url, []).append(f)
                else:
                    site_wide_findings.append(f)

            # Attach per-page findings
            for p in pages:
                p_url = str(p.get("url", ""))
                pf = page_content_findings_by_url.get(p_url, [])
                p["page_security_findings"] = pf

        security_summary = None
        if sec_session:
            security_summary = {
                "overall_score": sec_session.get("overall_score"),
                "counts": {
                    "critical": sec_session.get("critical_count", 0),
                    "high": sec_session.get("high_count", 0),
                    "medium": sec_session.get("medium_count", 0),
                    "low": sec_session.get("low_count", 0),
                },
                "site_wide_findings": site_wide_findings,
            }

        return {
            "audit_session": audit_session,
            "pages": pages,
            "security_summary": security_summary,
        }
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# 7.  Site Audit  (Phase 2)
# ---------------------------------------------------------------------------

class SiteAuditRequest(BaseModel):
    session_id: Optional[str] = None
    urls: List[str]
    concurrency: Optional[int] = 2


class SecurityRunRequest(BaseModel):
    crawl_session_id: str
    mode: str = "passive"
    page_limit: int = 200


@app.post("/audit/site")
async def audit_site(
    req: SiteAuditRequest,
    user: dict | None = Depends(get_current_user_optional),
):
    """
    Audit a list of pages using the full scout_graph pipeline.
    Accepts page URLs directly so no Supabase dependency is required.
    Persists results to Supabase audit_sessions / page_audits when configured.
    Streams SSE: site_audit_started, page_audit_started,
                 page_audit_complete, page_audit_error, site_audit_complete.
    """
    async def _stream():
        from crawler.db import (
            create_audit_session,
            save_page_audit,
            complete_audit_session,
            create_security_session,
            save_security_finding,
            complete_security_session,
        )
        loop = asyncio.get_event_loop()
        urls        = [u.strip() for u in req.urls if u and u.strip()]
        total       = len(urls)
        concurrency = max(1, min(req.concurrency or 2, 4))
        user_id     = user["sub"] if user else None
        log.info("[request] SITE AUDIT START  pages=%d  session=%s  user=%s", total, req.session_id, user_id)
        t0 = time.perf_counter()

        if total == 0:
            yield _sse({"type": "error", "message": "No URLs provided for audit"})
            return

        # Derive root URL from first page for the audit session record
        root_url = urls[0]
        try:
            from urllib.parse import urlparse
            p = urlparse(urls[0])
            root_url = f"{p.scheme}://{p.netloc}"
        except Exception:
            pass

        # Create audit_session row (no-op when Supabase is not configured)
        audit_session_id: str = await asyncio.to_thread(
            create_audit_session, root_url, req.session_id, user_id
        )

        # Create one security session for this full run when crawl session is available.
        security_session_id: str | None = None
        if req.session_id:
            security_session_id = await asyncio.to_thread(
                create_security_session,
                req.session_id,
                "passive",
                user_id,
            )

        # ── Run site-wide security scan ONCE on the root URL ──────────
        site_wide_report: dict = {}
        site_wide_findings: list = []
        if security_session_id:
            try:
                site_wide_report = await asyncio.to_thread(
                    run_site_wide_security_audit, root_url
                )
                site_wide_findings = site_wide_report.get("findings", [])
                for finding in site_wide_findings:
                    if not isinstance(finding, dict):
                        continue
                    try:
                        await asyncio.to_thread(
                            save_security_finding,
                            security_session_id,
                            None,
                            finding.get("url", root_url),
                            finding.get("category", "unknown"),
                            finding.get("title", "Untitled finding"),
                            finding.get("description", ""),
                            finding.get("severity", "low"),
                            finding.get("confidence", "medium"),
                            finding.get("recommendation", ""),
                            finding.get("evidence", {}),
                            finding.get("scope", "site_wide"),
                        )
                    except Exception as sec_exc:
                        log.warning("[audit/site] save site-wide finding failed: %s", sec_exc)
                log.info("[audit/site] site-wide security done  findings=%d", len(site_wide_findings))
            except Exception as exc:
                log.warning("[audit/site] site-wide security failed: %s", exc)

        yield _sse({"type": "site_audit_started", "total": total, "urls": urls,
                    "audit_session_id": audit_session_id})

        # Queue carries events from concurrent audit tasks back to SSE stream
        q: asyncio.Queue = asyncio.Queue()
        sem = asyncio.Semaphore(concurrency)
        page_scores: list[float] = []
        security_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        security_scanned_pages = 0
        security_lock = asyncio.Lock()

        # Seed security_counts with site-wide findings
        for _f in site_wide_findings:
            if isinstance(_f, dict):
                _sev = str(_f.get("severity", "low")).lower()
                if _sev in security_counts:
                    security_counts[_sev] += 1
                else:
                    security_counts["low"] += 1

        async def _audit_one(url: str, idx: int) -> None:
            nonlocal security_scanned_pages
            async with sem:
                q.put_nowait({
                    "type": "page_audit_started",
                    "url": url, "index": idx, "total": total,
                })
                try:
                    result = await loop.run_in_executor(_executor, lambda: _run_graph_site(url))
                    if "error" in result:
                        q.put_nowait({
                            "type": "page_audit_error",
                            "url": url, "index": idx, "total": total,
                            "error": result["error"],
                        })
                    else:
                        # Compute a simple overall score (average of available scores)
                        scores = [
                            r.get("overall_score") or r.get("overall_risk_score")
                            for r in [
                                result["ui_report"] or {},
                                result["ux_report"] or {},
                                result["seo_report"] or {},
                            ] if r
                        ]
                        risk = (result["compliance_report"] or {}).get("overall_risk_score")
                        if risk is not None:
                            scores.append(10 - risk)  # invert risk score
                        valid = [s for s in scores if isinstance(s, (int, float))]
                        page_score = round(sum(valid) / len(valid), 1) if valid else None
                        if page_score is not None:
                            page_scores.append(page_score)

                        # Persist to Supabase (no-op when not configured)
                        page_ctx = result.get("page_context") or {}
                        await asyncio.to_thread(
                            save_page_audit,
                            audit_session_id, url,
                            result["ui_report"], result["ux_report"],
                            result["compliance_report"], result["seo_report"],
                            page_score,
                            page_ctx.get("screenshot_base64"),
                        )

                        # ── Per-page content security (no HTTP fetch) ──
                        page_sec_findings: list = []
                        try:
                            sec_result = await asyncio.to_thread(
                                run_page_content_security_check,
                                url,
                                page_ctx.get("final_url", url),
                                page_ctx.get("dom", ""),
                            )
                            page_sec_findings = sec_result.get("findings", [])
                        except Exception as sec_exc:
                            log.warning("[audit/site] page content security failed for %s: %s", url, sec_exc)

                        if page_sec_findings and security_session_id:
                            for finding in page_sec_findings:
                                if not isinstance(finding, dict):
                                    continue
                                try:
                                    await asyncio.to_thread(
                                        save_security_finding,
                                        security_session_id,
                                        finding.get("page_id"),
                                        finding.get("url", url),
                                        finding.get("category", "unknown"),
                                        finding.get("title", "Untitled finding"),
                                        finding.get("description", ""),
                                        finding.get("severity", "low"),
                                        finding.get("confidence", "medium"),
                                        finding.get("recommendation", ""),
                                        finding.get("evidence", {}),
                                        finding.get("scope", "page_content"),
                                    )
                                except Exception as sec_exc:
                                    log.warning("[audit/site] save page finding failed for %s: %s", url, sec_exc)

                        if page_sec_findings:
                            async with security_lock:
                                security_scanned_pages += 1
                                for finding in page_sec_findings:
                                    if not isinstance(finding, dict):
                                        continue
                                    sev = str(finding.get("severity", "low")).lower()
                                    if sev in security_counts:
                                        security_counts[sev] += 1
                                    else:
                                        security_counts["low"] += 1

                        ev: dict = {
                            "type":              "page_audit_complete",
                            "url":               url,
                            "index":             idx,
                            "total":             total,
                            "ui_report":         result["ui_report"],
                            "ux_report":         result["ux_report"],
                            "seo_report":        result["seo_report"],
                            "compliance_report": result["compliance_report"],
                            "audit_session_id":  audit_session_id,
                            "screenshot_base64": (result.get("page_context") or {}).get("screenshot_base64"),
                        }
                        if page_sec_findings:
                            ev["page_security_findings"] = page_sec_findings
                        q.put_nowait(ev)
                except Exception as exc:
                    log.exception("[audit/site] url=%s  %s", url, exc)
                    q.put_nowait({
                        "type": "page_audit_error",
                        "url": url, "index": idx, "total": total,
                        "error": str(exc),
                    })

        tasks = [
            asyncio.create_task(_audit_one(url, i + 1))
            for i, url in enumerate(urls)
        ]

        # Drain queue until every page is accounted for
        done = 0
        _completed_page_events: list[dict] = []
        while done < total:
            event = await q.get()
            yield _sse(event)
            if event["type"] in ("page_audit_complete", "page_audit_error"):
                done += 1
            if event["type"] == "page_audit_complete":
                _completed_page_events.append(event)

        await asyncio.gather(*tasks, return_exceptions=True)

        overall_score = round(sum(page_scores) / len(page_scores), 1) if page_scores else None
        await asyncio.to_thread(complete_audit_session, audit_session_id, overall_score)

        elapsed = time.perf_counter() - t0
        log.info("[request] SITE AUDIT DONE   total=%.1fs  pages=%d", elapsed, total)

        # Final security score across site-wide + per-page findings
        sec_penalty = (
            security_counts["critical"] * 20
            + security_counts["high"] * 10
            + security_counts["medium"] * 4
            + security_counts["low"] * 1
        )
        security_overall_score = max(0, 100 - sec_penalty)

        if security_session_id:
            await asyncio.to_thread(
                complete_security_session,
                security_session_id,
                security_overall_score,
                security_scanned_pages,
                security_counts,
            )

        # Build phased prompts from all collected page results
        phased_prompts = generate_phased_prompts(
            pages=[
                {
                    "ui_report":          ev.get("ui_report"),
                    "ux_report":          ev.get("ux_report"),
                    "seo_report":         ev.get("seo_report"),
                    "compliance_report":  ev.get("compliance_report"),
                    "page_security_findings": ev.get("page_security_findings"),
                }
                for ev in _completed_page_events
            ],
            multi_page=True,
            site_url=root_url,
        )

        yield _sse({
            "type":             "site_audit_complete",
            "total":            total,
            "duration_ms":      int(elapsed * 1000),
            "overall_score":    overall_score,
            "audit_session_id": audit_session_id,
            "security_session_id":        security_session_id,
            "security_overall_score":     security_overall_score,
            "security_counts":            security_counts,
            "security_site_wide_findings": site_wide_findings,
            "phased_prompts":             phased_prompts,
        })

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# 7b. Projects list  (for the dashboard)
# ---------------------------------------------------------------------------

@app.get("/projects")
async def list_projects(
    user: dict | None = Depends(get_current_user_optional),
):
    """Return all audit sessions for the authenticated user, newest first.

    Uses the service key so it always works regardless of RLS / view permissions.
    Falls back to an empty list when Supabase is not configured or user is anonymous.
    """
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"projects": []}

    user_id = user["sub"] if user else None
    if not user_id:
        return {"projects": []}

    try:
        # Fetch audit sessions for this user
        sessions_res = (
            client.table("audit_sessions")
            .select("id,root_url,status,overall_score,started_at,completed_at,crawl_session_id")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(50)
            .execute()
        )
        sessions = sessions_res.data or []

        # Attach page counts in one additional query
        if sessions:
            session_ids = [s["id"] for s in sessions]
            counts_res = (
                client.table("page_audits")
                .select("audit_session_id")
                .in_("audit_session_id", session_ids)
                .execute()
            )
            from collections import Counter
            page_counts: Counter = Counter(r["audit_session_id"] for r in (counts_res.data or []))
            for s in sessions:
                s["page_count"] = page_counts.get(s["id"], 0)
                s["audit_session_id"] = s.pop("id")  # rename to match dashboard type
        return {"projects": sessions}
    except Exception as e:
        log.warning("[projects] list_projects error: %s", e)
        return {"projects": [], "error": str(e)}


@app.get("/audit/session/{audit_session_id}/pages")
async def get_audit_session_pages(
    audit_session_id: str,
    user: dict | None = Depends(get_current_user_optional),
):
    """Return all page_audits rows for a given audit_session_id."""
    from crawler.db import _get_client
    client = _get_client()
    if not client:
        return {"error": "Database not configured", "pages": []}
    try:
        res = (
            client.table("page_audits")
            .select("id,url,ui_report,ux_report,compliance_report,seo_report,overall_score,screenshot_url,created_at")
            .eq("audit_session_id", audit_session_id)
            .order("created_at")
            .execute()
        )
        return {"pages": res.data or []}
    except Exception as e:
        return {"error": str(e), "pages": []}


# ---------------------------------------------------------------------------
# 8.  Phased Prompts  (on-demand generation)
# ---------------------------------------------------------------------------

class PromptsRequest(BaseModel):
    # Single-page audit reports
    ui_report:          Optional[dict] = None
    ux_report:          Optional[dict] = None
    seo_report:         Optional[dict] = None
    compliance_report:  Optional[dict] = None
    security_report:    Optional[dict] = None
    # Multi-page audit: list of per-page result dicts
    pages:              Optional[List[dict]] = None
    site_url:           str = ""


@app.post("/audit/prompts")
async def get_audit_prompts(req: PromptsRequest):
    """
    Generate phased AI fix prompts from audit results.

    Accepts either a single-page audit result (ui_report, ux_report, …)
    or a multi-page list (pages=[{ui_report, ux_report, …}, …]).

    Returns synchronously — no LLM calls, pure computation.
    """
    try:
        multi_page = bool(req.pages)
        phases = generate_phased_prompts(
            ui_report=req.ui_report,
            ux_report=req.ux_report,
            seo_report=req.seo_report,
            compliance_report=req.compliance_report,
            security_report=req.security_report,
            pages=req.pages,
            multi_page=multi_page,
            site_url=req.site_url,
        )
        return {"phases": phases, "total_phases": len(phases)}
    except Exception as exc:
        log.exception("[audit/prompts] Failed: %s", exc)
        return JSONResponse(status_code=500, content={"error": str(exc)})


# ---------------------------------------------------------------------------
# 9.  Security Audit  (Phase 5 - V1 passive)
# ---------------------------------------------------------------------------

@app.post("/security/run")
async def run_security_scan(
    req: SecurityRunRequest,
    user: dict | None = Depends(get_current_user_optional),
):
    """Run a passive security scan for URLs under an existing crawl session."""
    from crawler.db import (
        _get_client,
        create_security_session,
        save_security_finding,
        complete_security_session,
    )

    client = _get_client()
    if not client:
        return JSONResponse(status_code=500, content={"error": "Database not configured"})

    try:
        # Verify crawl session exists and, when user is authenticated, enforce ownership.
        crawl_res = (
            client.table("crawl_sessions")
            .select("id,user_id")
            .eq("id", req.crawl_session_id)
            .single()
            .execute()
        )
        crawl_row = crawl_res.data or {}
        if not crawl_row:
            return JSONResponse(status_code=404, content={"error": "Crawl session not found"})

        if user and crawl_row.get("user_id") and crawl_row.get("user_id") != user["id"]:
            return JSONResponse(status_code=403, content={"error": "Not authorised"})

        pages_res = (
            client.table("crawled_pages")
            .select("id,url")
            .eq("session_id", req.crawl_session_id)
            .limit(max(1, min(req.page_limit, 1000)))
            .execute()
        )
        pages = pages_res.data or []
        if not pages:
            return JSONResponse(status_code=400, content={"error": "No crawled pages found for this session"})

        page_id_by_url = {str(p.get("url", "")): str(p.get("id", "")) for p in pages if p.get("url") and p.get("id")}
        urls = [str(p.get("url")) for p in pages if p.get("url")]

        security_session_id = await asyncio.to_thread(
            create_security_session,
            req.crawl_session_id,
            req.mode,
            user["id"] if user else crawl_row.get("user_id"),
        )

        result = await asyncio.to_thread(
            run_security_audit,
            urls,
            req.mode,
            page_id_by_url,
        )
        if result.get("error"):
            return JSONResponse(status_code=400, content=result)

        findings = result.get("findings", [])
        for finding in findings:
            await asyncio.to_thread(
                save_security_finding,
                security_session_id,
                finding.get("page_id"),
                finding.get("url", ""),
                finding.get("category", "unknown"),
                finding.get("title", "Untitled finding"),
                finding.get("description", ""),
                finding.get("severity", "low"),
                finding.get("confidence", "medium"),
                finding.get("recommendation", ""),
                finding.get("evidence", {}),
            )

        await asyncio.to_thread(
            complete_security_session,
            security_session_id,
            result.get("overall_score"),
            int(result.get("scanned_pages", 0)),
            result.get("counts", {}),
        )

        return {
            "security_session_id": security_session_id,
            "crawl_session_id": req.crawl_session_id,
            "mode": result.get("mode", req.mode),
            "overall_score": result.get("overall_score"),
            "counts": result.get("counts", {}),
            "scanned_pages": result.get("scanned_pages", 0),
            "total_findings": len(findings),
        }
    except Exception as e:
        log.exception("[security/run] Failed: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/security/session/{security_session_id}")
async def get_security_session(
    security_session_id: str,
    user: dict | None = Depends(get_current_user_optional),
):
    """Return one security session summary row."""
    from crawler.db import _get_client

    client = _get_client()
    if not client:
        return {"error": "Database not configured"}
    try:
        res = (
            client.table("security_sessions")
            .select("*")
            .eq("id", security_session_id)
            .single()
            .execute()
        )
        row = res.data or {}
        if user and row.get("user_id") and row.get("user_id") != user["id"]:
            return JSONResponse(status_code=403, content={"error": "Not authorised"})
        return {"security_session": row}
    except Exception as e:
        return {"error": str(e)}


@app.get("/security/session/{security_session_id}/findings")
async def get_security_findings(
    security_session_id: str,
    limit: int = 1000,
    offset: int = 0,
    user: dict | None = Depends(get_current_user_optional),
):
    """Return findings for a security session."""
    from crawler.db import _get_client

    client = _get_client()
    if not client:
        return {"error": "Database not configured", "findings": []}
    try:
        session_res = (
            client.table("security_sessions")
            .select("id,user_id")
            .eq("id", security_session_id)
            .single()
            .execute()
        )
        row = session_res.data or {}
        if user and row.get("user_id") and row.get("user_id") != user["id"]:
            return JSONResponse(status_code=403, content={"error": "Not authorised", "findings": []})

        res = (
            client.table("security_findings")
            .select("id,page_id,url,category,title,description,severity,confidence,recommendation,evidence_json,created_at")
            .eq("security_session_id", security_session_id)
            .range(offset, offset + max(1, min(limit, 5000)) - 1)
            .execute()
        )
        return {"findings": res.data or [], "offset": offset, "limit": limit}
    except Exception as e:
        return {"error": str(e), "findings": []}


@app.get("/crawl/{session_id}/security")
async def get_latest_security_for_crawl(
    session_id: str,
    user: dict | None = Depends(get_current_user_optional),
):
    """Return latest security session and its findings for a crawl session."""
    from crawler.db import _get_client

    client = _get_client()
    if not client:
        return {"error": "Database not configured", "security_session": None, "findings": []}

    try:
        sess_res = (
            client.table("security_sessions")
            .select("*")
            .eq("crawl_session_id", session_id)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        if not sess_res.data:
            return {"security_session": None, "findings": []}

        session_row = sess_res.data[0]
        if user and session_row.get("user_id") and session_row.get("user_id") != user["id"]:
            return JSONResponse(status_code=403, content={"error": "Not authorised", "security_session": None, "findings": []})

        findings_res = (
            client.table("security_findings")
            .select("id,page_id,url,category,title,description,severity,confidence,recommendation,evidence_json,created_at")
            .eq("security_session_id", session_row["id"])
            .order("created_at")
            .execute()
        )
        return {"security_session": session_row, "findings": findings_res.data or []}
    except Exception as e:
        return {"error": str(e), "security_session": None, "findings": []}


# ---------------------------------------------------------------------------
# DELETE project (audit_session + associated crawl data)
# ---------------------------------------------------------------------------

@app.delete("/audit/session/{audit_session_id}")
async def delete_audit_session(
    audit_session_id: str,
    user: dict | None = Depends(get_current_user_optional),
):
    """
    Delete an audit session and its associated crawl session.

    Cascade rules handle child rows:
      - audit_sessions  → page_audits          (ON DELETE CASCADE)
      - crawl_sessions  → crawled_pages/links/templates (ON DELETE CASCADE)
    """
    from crawler.db import _get_client

    if not user:
        return JSONResponse(status_code=401, content={"error": "Authentication required"})

    client = _get_client()
    if not client:
        return JSONResponse(status_code=500, content={"error": "Database not configured"})

    try:
        # Fetch the audit session and verify ownership
        row = (
            client.table("audit_sessions")
            .select("id, user_id, crawl_session_id")
            .eq("id", audit_session_id)
            .single()
            .execute()
        )
        if not row.data:
            return JSONResponse(status_code=404, content={"error": "Audit session not found"})

        row_user_id = row.data.get("user_id")
        # Only enforce ownership when the row actually has an owner assigned.
        if row_user_id is not None and row_user_id != user["id"]:
            return JSONResponse(status_code=403, content={"error": "Not authorised"})

        crawl_session_id = row.data.get("crawl_session_id")

        # 1. Delete the audit session (page_audits cascade)
        client.table("audit_sessions").delete().eq("id", audit_session_id).execute()

        # 2. Delete the associated crawl session if it exists
        if crawl_session_id:
            client.table("crawl_sessions").delete().eq("id", crawl_session_id).execute()

        return {"ok": True}

    except Exception as e:
        log.error("[delete] Failed to delete audit session %s: %s", audit_session_id, e)
        return JSONResponse(status_code=500, content={"error": str(e)})