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
from tools.vision_scraper import capture_website_context

# ---------------------------------------------------------------------------
# 1. State
# ---------------------------------------------------------------------------

class ScoutState(TypedDict):
    target_url: str
    page_context: dict
    ui_report: dict
    ux_report: dict

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


def merge_node(state: ScoutState) -> dict:
    """No-op merge point — both audit branches converge here."""
    return {}

# ---------------------------------------------------------------------------
# 3. Build the LangGraph
# ---------------------------------------------------------------------------

workflow = StateGraph(ScoutState)

workflow.add_node("scrape", scrape_node)
workflow.add_node("ui_auditor", ui_audit_node)
workflow.add_node("ux_auditor", ux_audit_node)
workflow.add_node("merge", merge_node)

workflow.set_entry_point("scrape")

# Fan-out: scrape → ui_auditor + ux_auditor (parallel)
workflow.add_edge("scrape", "ui_auditor")
workflow.add_edge("scrape", "ux_auditor")

# Fan-in: both auditors → merge → END
workflow.add_edge("ui_auditor", "merge")
workflow.add_edge("ux_auditor", "merge")
workflow.add_edge("merge", END)

scout_graph = workflow.compile()

# ---------------------------------------------------------------------------
# 4. FastAPI + SSE streaming
# ---------------------------------------------------------------------------

app = FastAPI(title="Scout.ai")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=4)


class AuditRequest(BaseModel):
    url: str


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_NODE_MESSAGES = {
    "scrape":     {"step": "fetch", "message": "🌐 Scraping page (DOM + screenshot)..."},
    "ui_auditor": {"step": "ui",    "message": "🎨 Running UI audit (Gemini 2.5 Flash + vision)..."},
    "ux_auditor": {"step": "ux",    "message": "🧭 Running UX audit (Llama 3.3 70B via Gradient)..."},
}

_NODE_DONE = {
    "scrape":     {"step": "fetch", "message": "✅ Page scraped — launching parallel audits..."},
    "ui_auditor": {"step": "ui",    "message": "✅ UI audit complete"},
    "ux_auditor": {"step": "ux",    "message": "✅ UX audit complete"},
}


def _run_graph(url: str):
    """Run the LangGraph synchronously and yield (node_name, updates) tuples."""
    for event in scout_graph.stream(
        {"target_url": url},
        stream_mode="updates",
    ):
        yield event


async def _stream_audit(url: str):
    loop = asyncio.get_event_loop()
    log.info("[request] AUDIT START  url=%s", url)
    t_total = time.perf_counter()
    try:
        # Emit "starting" status for the scrape step
        yield _sse({"type": "status", **_NODE_MESSAGES["scrape"]})

        ui_report = None
        ux_report = None

        # Stream graph updates from a thread
        for event in await loop.run_in_executor(_executor, lambda: list(_run_graph(url))):
            # event is {node_name: state_update_dict}
            for node_name, update in event.items():
                if node_name == "scrape":
                    # Check for scrape errors
                    ctx = update.get("page_context", {})
                    if ctx.get("error"):
                        yield _sse({"type": "error", "message": ctx["error"]})
                        return
                    yield _sse({"type": "status", **_NODE_DONE["scrape"]})
                    # Emit "starting" for both auditors
                    yield _sse({"type": "status", **_NODE_MESSAGES["ui_auditor"]})
                    yield _sse({"type": "status", **_NODE_MESSAGES["ux_auditor"]})

                elif node_name == "ui_auditor":
                    ui_report = update.get("ui_report")
                    yield _sse({"type": "status", **_NODE_DONE["ui_auditor"]})
                    yield _sse({"type": "ui_result", "ui_report": ui_report})

                elif node_name == "ux_auditor":
                    ux_report = update.get("ux_report")
                    yield _sse({"type": "status", **_NODE_DONE["ux_auditor"]})
                    yield _sse({"type": "ux_result", "ux_report": ux_report})

                elif node_name == "merge":
                    log.info("[request] AUDIT DONE   total=%.1fs", time.perf_counter() - t_total)
                    yield _sse({
                        "type": "result",
                        "ui_report": ui_report,
                        "ux_report": ux_report,
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