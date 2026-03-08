import os
import re
import json
import time
import logging

from gradient import Gradient
from gradient import APITimeoutError, APIConnectionError

log = logging.getLogger("scout")

_SYSTEM_PROMPT = """You are a Senior UX Researcher and Accessibility Specialist for Scout.ai.
Score each area from 1 (critically broken) to 10 (excellent).
Respond with valid JSON only — no markdown, no extra text."""

_MODEL = "llama3.3-70b-instruct"
_MAX_RETRIES = 3
_RETRY_DELAY = 3  # seconds

_JSON_SCHEMA = """
Return ONLY this JSON structure (no markdown):
{
  "overall_score": <integer 1-10>,
  "accessibility":  { "score": <integer 1-10>, "findings": "<observations>" },
  "ux_friction":    { "score": <integer 1-10>, "findings": "<observations>" },
  "navigation_ia":  { "score": <integer 1-10>, "findings": "<observations>" },
  "inclusivity":    { "score": <integer 1-10>, "findings": "<observations>" },
  "recommendations": ["<actionable fix>", ...]
}
"""


def run_ux_audit(url: str, context: dict) -> dict:
    """Produce a scored UX audit using Llama 3.3 70B via Gradient."""
    if context.get("error"):
        return {"error": context["error"]}

    summary = context["accessibility_summary"]
    dom_snippet = context["dom"][:6000]

    text_prompt = f"""Perform a UX and accessibility audit on: {url}

ACCESSIBILITY SUMMARY:
- Total images: {summary['images_total']}, missing alt text: {summary['images_missing_alt']}
- Heading hierarchy: {summary['heading_hierarchy']}
- Total form inputs: {summary['total_inputs']}, labeled: {summary['labeled_inputs']}
- ARIA roles present: {summary['aria_roles_found']}

DOM CONTENT (first 6000 chars):
{dom_snippet}

{_JSON_SCHEMA}"""

    client = Gradient(
        model_access_key=os.environ.get("DIGITALOCEAN_INFERENCE_KEY"),
        timeout=120.0,
    )

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": text_prompt},
                ],
                model=_MODEL,
            )
            raw = response.choices[0].message.content
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                return json.loads(match.group())
            return {"error": "Failed to parse UX report", "raw": raw}

        except (APITimeoutError, APIConnectionError) as exc:
            if attempt < _MAX_RETRIES:
                log.warning("[ux_auditor] attempt %d/%d failed (%s) — retrying in %ds",
                            attempt, _MAX_RETRIES, type(exc).__name__, _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)
            else:
                log.error("[ux_auditor] all %d attempts failed: %s", _MAX_RETRIES, exc)
                return {"error": f"Gradient API unreachable after {_MAX_RETRIES} attempts: {exc}"}
