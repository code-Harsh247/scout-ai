import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import TypedDict

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.graph import StateGraph, END
from pydantic import BaseModel

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
from tools.seo_scraper import fetch_raw_html
from tools.vision_scraper import capture_website_context
from tools.page_crawler import discover_pages

# ---------------------------------------------------------------------------
# 1. State
# ---------------------------------------------------------------------------

class ScoutState(TypedDict):
    target_url: str
    pages: list          # [{"url": str, "page_type": str}]
    page_results: list   # [PageAuditResult dicts]
    site_report: dict    # aggregated report

# ---------------------------------------------------------------------------
# 2. Single-page audit helper (reusable across threads)
# ---------------------------------------------------------------------------

def _audit_single_page(url: str, page_type: str) -> dict:
    """
    Run the full 4-agent audit pipeline for one URL.
    Returns a dict compatible with PageAuditResult.
    Errors on individual agents are caught and stored as {"error": "..."}.
    """
    result = {"url": url, "page_type": page_type,
              "ui_report": None, "ux_report": None,
              "compliance_report": None, "seo_report": None}

    log.info("[multi_audit] START  %s (%s)", url, page_type)
    t0 = time.perf_counter()

    # --- Scrape ---
    context = capture_website_context(url)
    if context.get("error"):
        log.error("[multi_audit] SCRAPE ERROR  %s  %s", url, context["error"])
        return result

    # --- 4 agents ---
    try:
        result["ui_report"] = run_ui_audit(url, context)
    except Exception as exc:
        log.error("[multi_audit] ui_agent error for %s: %s", url, exc)
        result["ui_report"] = {"error": str(exc)}

    try:
        result["ux_report"] = run_ux_audit(url, context)
    except Exception as exc:
        log.error("[multi_audit] ux_agent error for %s: %s", url, exc)
        result["ux_report"] = {"error": str(exc)}

    try:
        result["compliance_report"] = run_compliance_audit(url, context)
    except Exception as exc:
        log.error("[multi_audit] compliance_agent error for %s: %s", url, exc)
        result["compliance_report"] = {"error": str(exc)}

    try:
        fetch_res = fetch_raw_html(url)
        raw_html = fetch_res.get("raw_html", "")
        if raw_html:
            result["seo_report"] = run_seo_audit(
                url=url,
                raw_html=raw_html,
                rendered_dom=context.get("dom", ""),
                playwright_succeeded=bool(context.get("screenshot_base64")),
            )
        else:
            result["seo_report"] = {"error": "Failed to fetch raw HTML"}
    except Exception as exc:
        log.error("[multi_audit] seo_agent error for %s: %s", url, exc)
        result["seo_report"] = {"error": str(exc)}

    log.info("[multi_audit] DONE   %s  %.1fs", url, time.perf_counter() - t0)
    return result

# ---------------------------------------------------------------------------
# 3. Aggregation helper
# ---------------------------------------------------------------------------

def _safe_avg(values: list) -> int:
    clean = [v for v in values if isinstance(v, (int, float)) and v > 0]
    return round(sum(clean) / len(clean)) if clean else 1


def _merge_lists(*lists, cap=10) -> list:
    seen = set()
    merged = []
    for lst in lists:
        for item in (lst or []):
            key = item.strip().lower()
            if key not in seen:
                seen.add(key)
                merged.append(item)
    return merged[:cap]


def _aggregate_score_result(checks: list[dict], key: str) -> dict:
    """Average a ScoreResult field across all pages that have it."""
    scores, all_findings, fixes, all_evidence = [], [], [], []
    worst_score, worst_fix = 11, ""
    for c in checks:
        if not c or "error" in c:
            continue
        sr = c.get(key, {})
        if not sr or "error" in sr:
            continue
        s = sr.get("score", 0)
        scores.append(s)
        all_findings.extend(sr.get("findings", []))
        fix = sr.get("recommended_fix", "")
        if s < worst_score and fix:
            worst_score, worst_fix = s, fix
        all_evidence.extend(sr.get("evidence", []))

    return {
        "score": _safe_avg(scores),
        "findings": _merge_lists(all_findings, cap=6),
        "recommended_fix": worst_fix,
        "evidence": all_evidence[:5],
    }


def _aggregate_risk_area(checks: list[dict], key: str) -> dict:
    """Aggregate a RiskArea field across all pages."""
    risk_priority = {"High": 3, "Medium": 2, "Low": 1}
    worst_risk, all_findings, fixes, all_evidence = "Low", [], [], []
    worst_fix = ""
    for c in checks:
        if not c or "error" in c:
            continue
        ra = c.get(key, {})
        if not ra or "error" in ra:
            continue
        rl = ra.get("risk_level", "Low")
        if risk_priority.get(rl, 0) > risk_priority.get(worst_risk, 0):
            worst_risk = rl
            worst_fix = ra.get("recommended_fix", "")
        all_findings.extend(ra.get("findings", []))
        all_evidence.extend(ra.get("evidence", []))
    return {
        "risk_level": worst_risk,
        "findings": _merge_lists(all_findings, cap=6),
        "recommended_fix": worst_fix,
        "evidence": all_evidence[:5],
    }


def _build_site_report(page_results: list) -> dict:
    """Aggregate all per-page reports into a single site-wide report."""
    ui_reports = [r.get("ui_report") for r in page_results]
    ux_reports = [r.get("ux_report") for r in page_results]
    comp_reports = [r.get("compliance_report") for r in page_results]
    seo_reports = [r.get("seo_report") for r in page_results]

    # UI
    site_ui = {
        "overall_score": _safe_avg([r.get("overall_score", 0) for r in ui_reports if r and "error" not in r]),
        "layout_spacing":  _aggregate_score_result(ui_reports, "layout_spacing"),
        "responsiveness":  _aggregate_score_result(ui_reports, "responsiveness"),
        "typography":      _aggregate_score_result(ui_reports, "typography"),
        "color_coherence": _aggregate_score_result(ui_reports, "color_coherence"),
        "recommendations": _merge_lists(*[r.get("recommendations", []) for r in ui_reports if r], cap=8),
    }

    # UX
    site_ux = {
        "overall_score": _safe_avg([r.get("overall_score", 0) for r in ux_reports if r and "error" not in r]),
        "accessibility":  _aggregate_score_result(ux_reports, "accessibility"),
        "ux_friction":    _aggregate_score_result(ux_reports, "ux_friction"),
        "navigation_ia":  _aggregate_score_result(ux_reports, "navigation_ia"),
        "inclusivity":    _aggregate_score_result(ux_reports, "inclusivity"),
        "recommendations": _merge_lists(*[r.get("recommendations", []) for r in ux_reports if r], cap=8),
    }

    # Compliance
    site_comp = {
        "overall_risk_score": _safe_avg([r.get("overall_risk_score", 0) for r in comp_reports if r and "error" not in r]),
        "data_privacy":             _aggregate_risk_area(comp_reports, "data_privacy"),
        "legal_transparency":       _aggregate_risk_area(comp_reports, "legal_transparency"),
        "accessibility_compliance": _aggregate_risk_area(comp_reports, "accessibility_compliance"),
        "critical_violations": _merge_lists(*[r.get("critical_violations", []) for r in comp_reports if r], cap=10),
    }

    # SEO — use first successful report's structured fields, avg score
    seo_scores = [r.get("overall_score", 0) for r in seo_reports if r and "error" not in r]
    base_seo = next((r for r in seo_reports if r and "error" not in r), {})
    site_seo = {
        **base_seo,
        "overall_score": _safe_avg(seo_scores),
        "recommendations": _merge_lists(*[r.get("recommendations", []) for r in seo_reports if r], cap=8),
    }

    return {
        "pages_analysed": len(page_results),
        "page_urls": [r["url"] for r in page_results],
        "ui_report": site_ui,
        "ux_report": site_ux,
        "compliance_report": site_comp,
        "seo_report": site_seo,
    }

# ---------------------------------------------------------------------------
# 4. LangGraph nodes
# ---------------------------------------------------------------------------

def page_discovery_node(state: ScoutState) -> dict:
    """Discover pages via BFS crawler."""
    url = state["target_url"]
    log.info("[discovery] START  %s", url)
    t0 = time.perf_counter()
    pages = discover_pages(url, max_pages=6, max_depth=3)
    log.info("[discovery] DONE   %.1fs  %d pages", time.perf_counter() - t0, len(pages))
    return {"pages": pages}


def multi_page_audit_node(state: ScoutState) -> dict:
    """Audit all discovered pages in parallel."""
    pages = state.get("pages") or []
    if not pages:
        pages = [{"url": state["target_url"], "page_type": "Landing Page"}]

    log.info("[multi_audit] auditing %d pages in parallel", len(pages))
    results = [None] * len(pages)

    with ThreadPoolExecutor(max_workers=min(len(pages), 6)) as ex:
        future_to_idx = {
            ex.submit(_audit_single_page, p["url"], p["page_type"]): i
            for i, p in enumerate(pages)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                log.error("[multi_audit] thread error for page %d: %s", idx, exc)
                results[idx] = {**pages[idx], "ui_report": None, "ux_report": None,
                                "compliance_report": None, "seo_report": None}

    page_results = [r for r in results if r is not None]
    return {"page_results": page_results}


def aggregate_node(state: ScoutState) -> dict:
    """Merge per-page results into a site-wide report."""
    page_results = state.get("page_results") or []
    log.info("[aggregate] merging %d page reports", len(page_results))
    site_report = _build_site_report(page_results)
    return {"site_report": site_report}

# ---------------------------------------------------------------------------
# 5. Build the LangGraph
# ---------------------------------------------------------------------------

workflow = StateGraph(ScoutState)

workflow.add_node("page_discovery",    page_discovery_node)
workflow.add_node("multi_page_audit",  multi_page_audit_node)
workflow.add_node("aggregate",         aggregate_node)

workflow.set_entry_point("page_discovery")
workflow.add_edge("page_discovery",   "multi_page_audit")
workflow.add_edge("multi_page_audit", "aggregate")
workflow.add_edge("aggregate",        END)

scout_graph = workflow.compile()

# ---------------------------------------------------------------------------
# 6. FastAPI + SSE streaming
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


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_graph(url: str, sse_queue: list) -> dict:
    """
    Run the scout graph synchronously, collecting SSE events into sse_queue.
    Returns the final state dict.
    """
    pages_sent = False
    page_results_sent: set = set()

    for event in scout_graph.stream({"target_url": url}, stream_mode="updates"):
        for node_name, update in event.items():

            if node_name == "page_discovery":
                pages = update.get("pages", [])
                sse_queue.append(_sse({"type": "pages_discovered", "pages": pages}))
                pages_sent = True

            elif node_name == "multi_page_audit":
                page_results = update.get("page_results", [])
                total = len(page_results)
                for i, pr in enumerate(page_results):
                    sse_queue.append(_sse({
                        "type": "page_complete",
                        "url": pr.get("url", ""),
                        "page_type": pr.get("page_type", ""),
                        "page_index": i + 1,
                        "total": total,
                    }))

            elif node_name == "aggregate":
                site_report = update.get("site_report", {})
                # We need page_results from the state — carried via closure
                sse_queue.append(("__site_report__", site_report))

    return {}


async def _stream_audit(url: str):
    loop = asyncio.get_event_loop()
    log.info("[request] AUDIT START  url=%s", url)
    t_total = time.perf_counter()

    # We use a simpler direct approach: run each graph step and yield SSE
    try:
        # Run in executor to avoid blocking
        pages: list = []
        page_results: list = []
        site_report: dict = {}

        def run_sync():
            nonlocal pages, page_results, site_report
            for event in scout_graph.stream({"target_url": url}, stream_mode="updates"):
                for node_name, update in event.items():
                    if node_name == "page_discovery":
                        pages[:] = update.get("pages", [])
                    elif node_name == "multi_page_audit":
                        page_results[:] = update.get("page_results", [])
                    elif node_name == "aggregate":
                        site_report.update(update.get("site_report", {}))

        # Phase 1: discovery (fast, just crawl links)
        # We can't easily stream mid-graph from a thread, so we split manually:

        # Discover pages
        discovered = await loop.run_in_executor(_executor,
            lambda: discover_pages(url, max_pages=6, max_depth=3))

        if not discovered:
            yield _sse({"type": "error", "message": "Could not discover any pages"})
            return

        yield _sse({"type": "pages_discovered", "pages": discovered})

        # Audit each page in parallel
        results: list = [None] * len(discovered)

        def _audit_with_notify(page_info, idx, total):
            res = _audit_single_page(page_info["url"], page_info["page_type"])
            return idx, res

        completed_results = {}
        futures = {}
        with ThreadPoolExecutor(max_workers=min(len(discovered), 6)) as ex:
            for i, page in enumerate(discovered):
                f = ex.submit(_audit_single_page, page["url"], page["page_type"])
                futures[f] = (i, page)

            for future in as_completed(futures):
                i, page = futures[future]
                try:
                    result = future.result()
                except Exception as exc:
                    result = {**page, "ui_report": None, "ux_report": None,
                              "compliance_report": None, "seo_report": None}
                completed_results[i] = result
                yield _sse({
                    "type": "page_complete",
                    "url": page["url"],
                    "page_type": page["page_type"],
                    "page_index": i + 1,
                    "total": len(discovered),
                })

        page_results = [completed_results[i] for i in range(len(discovered)) if i in completed_results]

        # Aggregate
        site_report = _build_site_report(page_results)

        log.info("[request] AUDIT DONE   total=%.1fs", time.perf_counter() - t_total)

        yield _sse({
            "type": "result",
            "site_report": site_report,
            "page_results": page_results,
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