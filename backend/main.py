import asyncio
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
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
workflow.add_node("merge", merge_node)

workflow.set_entry_point("scrape")

# Fan-out: scrape -> ui_auditor + ux_auditor + compliance_auditor + seo_auditor (parallel)
workflow.add_edge("scrape", "ui_auditor")
workflow.add_edge("scrape", "ux_auditor")
workflow.add_edge("scrape", "compliance_auditor")
workflow.add_edge("scrape", "seo_auditor")

# Fan-in: all auditors → merge → END
workflow.add_edge("ui_auditor", "merge")
workflow.add_edge("ux_auditor", "merge")
workflow.add_edge("compliance_auditor", "merge")
workflow.add_edge("seo_auditor", "merge")
workflow.add_edge("merge", END)

scout_graph = workflow.compile()

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


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_graph(url: str) -> dict:
    """Run the LangGraph synchronously and return all reports or {error}."""
    ui_report = None
    ux_report = None
    compliance_report = None
    seo_report = None
    for event in scout_graph.stream({"target_url": url}, stream_mode="updates"):
        for node_name, update in event.items():
            if node_name == "scrape":
                ctx = update.get("page_context", {})
                if ctx.get("error"):
                    return {"error": ctx["error"]}
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