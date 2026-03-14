import os
import json
import time
import logging
from pydantic import ValidationError

from agents.schemas import ComplianceReport

from gradient import Gradient
from gradient import APITimeoutError, APIConnectionError

log = logging.getLogger("scout")

_SYSTEM_PROMPT = """You are a strict Regulatory, Data Privacy, and Accessibility Compliance Auditor for Scout.ai.
Your role is to identify legal liabilities and regulatory violations (GDPR, CCPA, WCAG 2.1, ADA).
Score overall_risk_score from 1 (critical legal risk / non-compliant) to 10 (fully compliant).
Each 'findings' field MUST be a JSON array of 2-4 short bullet strings (max 15 words each).
Each 'recommended_fix' field MUST be a single actionable sentence (max 20 words).
Respond with valid JSON only — no markdown, no extra text."""

_MODEL = "llama3.3-70b-instruct"
_MAX_RETRIES = 3
_RETRY_DELAY = 3  # seconds

_JSON_SCHEMA = """
Return ONLY this JSON structure (no markdown):
{
  "overall_risk_score": <integer 1-10>,
  "data_privacy": {
    "risk_level": "<High|Medium|Low>",
    "findings": ["<bullet 1>", "<bullet 2>"],
    "recommended_fix": "<action>"
  },
  "legal_transparency": {
    "risk_level": "<High|Medium|Low>",
    "findings": ["<bullet 1>", "<bullet 2>"],
    "recommended_fix": "<action>"
  },
  "accessibility_compliance": {
    "risk_level": "<High|Medium|Low>",
    "findings": ["<bullet 1>", "<bullet 2>"],
    "recommended_fix": "<action>"
  },
  "critical_violations": ["<immediate legal/regulatory liability>", ...]
}
"""


def _annotate_evidence(blobs: list, label: str, fix: str) -> list:
    """Stamp each evidence blob with a human-readable label and fix hint."""
    for ev in blobs:
        ev.setdefault("label", label)
        ev.setdefault("recommended_fix", fix)
    return blobs




def run_compliance_audit(url: str, context: dict) -> dict:
    """Produce a scored legal & compliance audit using Llama 3.3 70B via Gradient."""
    if context.get("error"):
        return {"error": context["error"]}

    summary = context["accessibility_summary"]
    all_links = context.get("all_links", [])   # [{"text": "...", "href": "..."}, ...]
    meta_tags = context.get("meta_tags", {})   # {"robots": "...", "og:title": "...", ...}
    visible_text = context.get("visible_text", "")
    evidence_blobs = context.get("evidence_blobs", {})

    # Pull all links into a readable block (cap at 80)
    all_links_block = "\n".join(
        f"  [{l['text'][:80]}] -> {l['href'][:150]}" for l in all_links[:80]
    ) or "No links found"

    # Flag suspicious placeholder links up-front so LLM doesn't have to hunt
    placeholder_links = [
        l for l in all_links
        if l["href"].strip() in ("#", "", "javascript:void(0)")
        and any(kw in l["text"].lower() for kw in ("privacy", "terms", "cookie", "gdpr", "legal", "policy"))
    ]
    placeholder_block = "\n".join(
        f"  [{l['text']}] -> {l['href']}" for l in placeholder_links
    ) or "None detected"

    # Format meta tags
    meta_block = "\n".join(f"  {k}: {v}" for k, v in list(meta_tags.items())[:30]) or "None"

    text_prompt = f"""Perform a strict legal and compliance audit on: {url}

ACCESSIBILITY SIGNALS:
- Total images: {summary['images_total']}, missing alt text: {summary['images_missing_alt']}
- Heading tag order: {summary['heading_hierarchy']}
- Total form inputs: {summary['total_inputs']}, labeled: {summary['labeled_inputs']}
- ARIA roles present: {summary['aria_roles_found']}

ALL PAGE LINKS (text → href):
{all_links_block}

SUSPECT PLACEHOLDER LEGAL LINKS (pre-identified, href="#" or empty):
{placeholder_block}

META TAGS:
{meta_block}

VISIBLE PAGE TEXT (cleaned, first 4000 chars):
{visible_text[:4000]}

AUDIT INSTRUCTIONS:
1. Data Privacy: Check for cookie consent banners, GDPR/CCPA opt-in checkboxes, and unconsented PII fields. Flag pre-ticked consent boxes as dark patterns.
2. Legal Transparency: Using the ALL PAGE LINKS list above, verify Privacy Policy and Terms of Service links are real (not href="#"). Check for visible company name, registration number, or contact address in the visible text.
3. Accessibility (WCAG 2.1 / ADA): Missing alt text on images, unlabeled inputs, and broken heading hierarchy are violations.
4. Dark Patterns: Look for hidden unsubscribe options, misleading button labels, forced continuity, or obscured cancellation flows in the visible text and links.

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
                temperature=0,
            )
            raw = response.choices[0].message.content
            # Two-pass parse: direct JSON first, then regex fallback
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                import re
                m = re.search(r"\{[\s\S]*\}", raw)
                if not m:
                    log.error("[compliance_auditor] No JSON block found in response")
                    return {"error": "Failed to parse compliance report — no JSON block found", "raw": raw[:500]}
                try:
                    data = json.loads(m.group())
                except json.JSONDecodeError as je:
                    log.error("[compliance_auditor] JSON decode failed: %s", je)
                    return {"error": f"JSON decode error: {je}", "raw": raw[:500]}
            # Validate schema
            try:
                report = ComplianceReport(**data)
                result = report.model_dump()
                # Attach visual evidence with human-readable labels
                result["legal_transparency"]["evidence"] = _annotate_evidence(
                    evidence_blobs.get("footer_region", []),
                    label="Footer / Legal Links Region",
                    fix="Add real Privacy Policy and Terms of Service links in the footer.",
                )
                result["data_privacy"]["evidence"] = _annotate_evidence(
                    evidence_blobs.get("cookie_banner", []),
                    label="Cookie Consent Banner",
                    fix="Display a GDPR-compliant cookie consent banner on first visit.",
                )
                result["accessibility_compliance"]["evidence"] = _annotate_evidence(
                    evidence_blobs.get("missing_alt_text", []),
                    label="Image Missing Alt Text (WCAG 2.1)",
                    fix="Add descriptive alt attributes to all non-decorative images.",
                )
                return result
            except ValidationError as ve:
                log.error("[compliance_auditor] Schema validation failed: %s", ve)
                return {"error": f"Schema validation error: {ve}"}

        except (APITimeoutError, APIConnectionError) as exc:
            if attempt < _MAX_RETRIES:
                log.warning("[compliance_auditor] attempt %d/%d failed (%s) — retrying in %ds",
                            attempt, _MAX_RETRIES, type(exc).__name__, _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)
            else:
                log.error("[compliance_auditor] all %d attempts failed: %s", _MAX_RETRIES, exc)
                return {"error": f"Gradient API unreachable after {_MAX_RETRIES} attempts: {exc}"}
