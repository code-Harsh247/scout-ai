import os
import base64
import json
from pydantic import ValidationError

from agents.schemas import UIReport

from google import genai
from google.genai import types

_SYSTEM_PROMPT = """You are a Senior UI Engineer and Visual Design Critic for Scout.ai.
Score each area from 1 (broken) to 10 (excellent).
Each 'findings' field MUST be a JSON array of 2-4 short bullet strings (max 15 words each).
Each 'recommended_fix' field MUST be a single actionable sentence (max 20 words).
Respond with valid JSON only — no markdown, no extra text."""

_MODEL = "gemini-2.5-flash"

_JSON_SCHEMA = """
Return ONLY this JSON structure:
{
  "overall_score": <integer 1-10>,
  "layout_spacing":  { "score": <integer 1-10>, "findings": ["<bullet 1>", "<bullet 2>"], "recommended_fix": "<action>" },
  "responsiveness":  { "score": <integer 1-10>, "findings": ["<bullet 1>", "<bullet 2>"], "recommended_fix": "<action>" },
  "typography":      { "score": <integer 1-10>, "findings": ["<bullet 1>", "<bullet 2>"], "recommended_fix": "<action>" },
  "color_coherence": { "score": <integer 1-10>, "findings": ["<bullet 1>", "<bullet 2>"], "recommended_fix": "<action>" },
  "recommendations": ["<actionable fix>", ...]
}"""


def _annotate_evidence(blobs: list, label: str, fix: str) -> list:
    """Stamp each evidence blob with a human-readable label and fix hint."""
    for ev in blobs:
        ev.setdefault("label", label)
        ev.setdefault("recommended_fix", fix)
    return blobs


def run_ui_audit(url: str, context: dict) -> dict:
    """Produce a scored UI audit using Gemini 2.5 Flash with vision."""
    if context.get("error"):
        return {"error": context["error"]}

    summary = context["accessibility_summary"]
    headings = context.get("headings", [])            # structured [{tag, text}]
    computed_styles = context.get("computed_styles", {})
    page_timing_ms = context.get("page_timing_ms", {})
    screenshot_b64 = context.get("screenshot_base64")
    evidence_blobs = context.get("evidence_blobs", {})

    # Format heading outline
    heading_outline = " | ".join(
        f"{h['tag'].upper()}: {h['text']}" for h in headings[:20]
    ) or "No headings found"

    # Format computed styles block
    styles_block = "\n".join(
        f"  {k}: {v}" for k, v in computed_styles.items()
    ) or "  Not available"

    # Format timing block
    timing_block = (
        f"  DOM Content Loaded: {page_timing_ms.get('dom_content_loaded', 'N/A')} ms\n"
        f"  Page Load: {page_timing_ms.get('load', 'N/A')} ms\n"
        f"  TTFB: {page_timing_ms.get('ttfb', 'N/A')} ms\n"
        f"  DOM Interactive: {page_timing_ms.get('dom_interactive', 'N/A')} ms"
    )

    text_prompt = f"""Perform a UI (visual design & layout) audit on: {url}

PAGE SIGNALS:
- Has viewport meta tag: {summary['has_viewport_meta']}
- Heading tag order: {summary['heading_hierarchy']}

PAGE HEADING OUTLINE (H1 → H6 with actual text):
{heading_outline}

COMPUTED BODY STYLES (from browser):
{styles_block}

PAGE PERFORMANCE TIMING:
{timing_block}

DOM CONTENT (first 6000 chars):
{context["dom"][:6000]}

{_JSON_SCHEMA}"""

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    parts = []
    if screenshot_b64:
        parts.append(types.Part.from_bytes(
            data=base64.b64decode(screenshot_b64),
            mime_type="image/png",
        ))
    parts.append(types.Part.from_text(text=text_prompt))

    response = client.models.generate_content(
        model=_MODEL,
        contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    raw_data = json.loads(response.text)
    try:
        report = UIReport(**raw_data)
        result = report.model_dump()
        # Attach visual evidence to relevant findings, with human-readable labels
        result["layout_spacing"]["evidence"] = _annotate_evidence(
            evidence_blobs.get("heading_positions", []),
            label="Heading / Layout Issue Detected",
            fix="Ensure consistent spacing between headings and fix visual hierarchy.",
        )
        return result
    except ValidationError as ve:
        import logging
        logging.getLogger("scout").warning("[ui_agent] Schema validation failed: %s", ve)
        return {"error": f"Schema validation error: {ve}"}
