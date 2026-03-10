import os
import re
import json
import time
import logging
from typing import Dict, Any, List

from gradient import Gradient
from gradient import APITimeoutError, APIConnectionError

log = logging.getLogger("scout")

from tools.seo_scraper import (
    fetch_raw_html,
    extract_seo_elements,
    check_https_redirect,
    analyze_content_quality,
    check_mobile_optimization,
    compute_critical_content_delta
)

_MODEL = "llama3.3-70b-instruct"
_MAX_RETRIES = 3
_RETRY_DELAY = 3  # seconds

# ---------------------------------------------------------------------------
# Core Output Schema
# ---------------------------------------------------------------------------

_SEO_JSON_SCHEMA = """
Return ONLY this JSON structure (no markdown, no preamble):
{
  "overall_score": <integer 1-10>,
  "universal_factors": {
    "https_redirect": { "status": "<pass|warn|fail>", "note": "<explanation>" },
    "meta_description": { "status": "<pass|warn|fail>", "note": "<explanation>" },
    "crawlability_delta": { "status": "<pass|warn|fail>", "note": "<explanation>" },
    "content_quality": { "status": "<pass|warn|fail>", "note": "<explanation>" },
    "mobile_optimization": { "status": "<pass|warn|fail>", "note": "<explanation>" }
  },
  "search_intent": {
    "primary_intent": "<Informational|Navigational|Commercial Investigation|Transactional>",
    "target_keyword_suggestion": "<string>",
    "top_entities": ["<entity1>", "<entity2>", ...]
  },
  "intent_alignment": {
    "status": "<aligned|misaligned|partial>",
    "explanation": "<string highlighting mismatches against Title/H1>"
  },
  "competitor_gap": {
    "missing_crucial_entities": ["<entity1>", ...]
  },
  "recommendations": ["<actionable fix 1>", "<actionable fix 2>", ...]
}
"""

def _call_gradient_json(system_prompt: str, user_prompt: str) -> dict:
    """Helper to call Gradient LLM with retries, explicitly expecting JSON."""
    client = Gradient(
        model_access_key=os.environ.get("DIGITALOCEAN_INFERENCE_KEY"),
        timeout=120.0,
    )

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model=_MODEL,
            )
            raw = response.choices[0].message.content
            match = re.search(r"\{[\s\S]*\}", raw)
            if match:
                return json.loads(match.group())
            return {"error": "Failed to parse LLM JSON response", "raw": raw}

        except (APITimeoutError, APIConnectionError) as exc:
            if attempt < _MAX_RETRIES:
                log.warning("[seo_agent] LLM attempt %d/%d failed (%s) — retrying in %ds",
                            attempt, _MAX_RETRIES, type(exc).__name__, _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)
            else:
                log.error("[seo_agent] LLM all %d attempts failed: %s", _MAX_RETRIES, exc)
                return {"error": f"Gradient API unreachable after {_MAX_RETRIES} attempts: {exc}"}

# ---------------------------------------------------------------------------
# Individual Modules
# ---------------------------------------------------------------------------

def _check_universal_params(seo_elements: dict, https_info: dict, content_info: dict, mobile_info: dict, delta_info: dict) -> dict:
    """Aggregates the 5 universal checks into a scored checklist."""
    
    # HTTPS
    https_status = "pass" if https_info.get("lands_on_https") else "fail"
    https_note = "Valid HTTPS redirect." if https_status == "pass" else "Missing HTTPS redirect chain ending on HTTPS."
    
    # Meta Description
    meta_status = "pass" if seo_elements.get("meta_description") else "fail"
    meta_note = "Meta description present." if meta_status == "pass" else "Missing meta description."
    
    # Crawlability Delta (Playwright vs Raw)
    h1_delta = delta_info.get("h1_delta", False)
    links_delta = delta_info.get("links_delta", False)
    if delta_info.get("status") == "inconclusive":
        delta_status = "warn"
        delta_note = "Crawlability check inconclusive (Playwright did not capture DOM)."
    elif h1_delta or links_delta:
        delta_status = "fail"
        delta_note = f"Heavy JS reliance: H1 delta={h1_delta}, Links delta={links_delta}."
    else:
        delta_status = "pass"
        delta_note = "Core SEO tags found natively in raw HTML."
        
    # Content Quality
    word_count = content_info.get("word_count", 0)
    if word_count < 300:
        cq_status = "warn"
        cq_note = f"Thin content detected ({word_count} words)."
    else:
        cq_status = "pass"
        cq_note = f"Adequate content length ({word_count} words)."

    # Mobile
    if mobile_info.get("is_responsive") and mobile_info.get("has_viewport_meta"):
        mob_status = "pass"
        mob_note = "Viewport meta configured correctly."
    elif mobile_info.get("has_viewport_meta"):
        mob_status = "warn"
        mob_note = "Viewport meta present but lacks responsive scale instructions."
    else:
        mob_status = "fail"
        mob_note = "Missing viewport meta tag entirely."

    return {
        "https_redirect": {"status": https_status, "note": https_note},
        "meta_description": {"status": meta_status, "note": meta_note},
        "crawlability_delta": {"status": delta_status, "note": delta_note},
        "content_quality": {"status": cq_status, "note": cq_note},
        "mobile_optimization": {"status": mob_status, "note": mob_note}
    }

def _classify_search_intent(page_text: str, title: str) -> dict:
    """Classifies search intent and extracts top entities via LLM."""
    system_prompt = "You are a Senior Technical SEO Data extraction system. Reply only in valid JSON."
    user_prompt = f"""
Analyze the following webpage content (Title: {title}).
1. Classify the principal search intent belonging to exactly one of: [Informational, Navigational, Commercial Investigation, Transactional].
2. Identify the top 5 to 10 entities (core topics/concepts).
3. Suggest the strongest single target keyword.

Page text (truncated to 4000 chars):
{page_text[:4000]}

Return ONLY valid JSON in this exact format:
{{
  "primary_intent": "<intent string>",
  "top_entities": ["<entity1>", "<entity2>"],
  "target_keyword_suggestion": "<keyword string>"
}}
"""
    return _call_gradient_json(system_prompt, user_prompt)

def _check_intent_alignment(intent_result: dict, title: str, h1_tags: list[str]) -> dict:
    """Checks if the LLM's determined intent/entities align with the Page Title & H1s."""
    
    if "error" in intent_result:
        return {"status": "misaligned", "explanation": "Failed to determine intent due to LLM error."}
        
    system_prompt = "You are an SEO analyst evaluating intent coherence. Reply only in valid JSON."
    user_prompt = f"""
Evaluate if the assigned Search Intent and Core Entities match the actual HTML headers used on the page.

Assigned Search Intent: {intent_result.get('primary_intent')}
Core Entities Extracted: {', '.join(intent_result.get('top_entities', []))}

Actual Page Title: {title}
Actual H1 Tags: {h1_tags}

Are these aligned? Or does the page talk about "transactional" entities while the H1 is purely "informational"?
Return ONLY valid JSON:
{{
  "status": "<aligned|misaligned|partial>",
  "explanation": "<1 sentence explaining why>"
}}
"""
    return _call_gradient_json(system_prompt, user_prompt)

def _competitor_entity_gap(competitor_urls: list[str], target_entities: list[str]) -> dict:
    """Fetches competitor URLs, extracts their entities, diffs against target entities."""
    if not competitor_urls:
        return {"missing_crucial_entities": []}

    all_competitor_text = ""
    for c_url in competitor_urls[:3]: # Cap at 3 for speed/token limits
        try:
            fetch_res = fetch_raw_html(c_url)
            if fetch_res.get("raw_html"):
                soup = extract_seo_elements(fetch_res["raw_html"])
                # We'll just append title and H1s as text proxy for speed
                all_competitor_text += f"{soup.get('title', '')} " + " ".join(soup.get("h1_tags", [])) + " "
        except Exception as e:
            log.warning("[seo_agent] Competitor fetch failed for %s: %s", c_url, e)

    if not all_competitor_text.strip():
        return {"missing_crucial_entities": []}

    system_prompt = "You are an SEO competitor analyzer. Reply only in valid JSON."
    user_prompt = f"""
We want to rank for these target entities: {', '.join(target_entities)}

Top Competitor content summary (Titles/H1s):
{all_competitor_text[:2000]}

List up to 5 crucial sub-topics or entities that the competitors are mentioning, which are NOT in our target entities list.
Return ONLY valid JSON:
{{
  "missing_crucial_entities": ["<entity1>", "<entity2>"]
}}
"""
    return _call_gradient_json(system_prompt, user_prompt)

# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def run_seo_audit(url: str, raw_html: str, rendered_dom: str, playwright_succeeded: bool, competitor_urls: list[str] = None) -> dict:
    """
    Orchestrates all SEO checks and LLM evaluations.
    """
    log.info("[seo_agent] Starting comprehensive SEO Audit for %s", url)

    # 1. Parsing & Check tools
    seo_elements = extract_seo_elements(raw_html)
    https_info = check_https_redirect(url)
    content_info = analyze_content_quality(raw_html)
    mobile_info = check_mobile_optimization(raw_html)
    delta_info = compute_critical_content_delta(seo_elements, rendered_dom, playwright_succeeded)

    # 2. Universal parameters
    universal_params = _check_universal_params(seo_elements, https_info, content_info, mobile_info, delta_info)

    # 3. Search Intent Extraction (LLM)
    # Simple heuristic to strip HTML quickly for intent scanning
    stripped_text = re.sub(r'<[^>]+>', ' ', raw_html)
    intent_result = _classify_search_intent(stripped_text, seo_elements.get("title", ""))

    # 4. Intent Alignment (LLM)
    alignment_result = _check_intent_alignment(intent_result, seo_elements.get("title", ""), seo_elements.get("h1_tags", []))

    # 5. Competitor Gap (LLM - Optional)
    competitor_gap = {"missing_crucial_entities": []}
    if competitor_urls:
        competitor_gap = _competitor_entity_gap(competitor_urls, intent_result.get("top_entities", []))

    # Calculate basic algorithmic score modifier based on universal checks
    score_penalty = 0
    fail_recs = []
    
    for category, result in universal_params.items():
        if result["status"] == "fail":
            score_penalty += 2
            fail_recs.append(f"Fix critical issue: {category} ({result['note']})")
        elif result["status"] == "warn":
            score_penalty += 1
            
    if alignment_result.get("status") == "misaligned":
        score_penalty += 2
        fail_recs.append(f"Realign page intent: {alignment_result.get('explanation')}")

    missing_entities = competitor_gap.get("missing_crucial_entities", [])
    if missing_entities:
        fail_recs.append(f"Cover missing topics: {', '.join(missing_entities)}")

    base_score = 10
    final_score = max(1, base_score - score_penalty)

    return {
        "overall_score": final_score,
        "universal_factors": universal_params,
        "search_intent": intent_result,
        "intent_alignment": alignment_result,
        "competitor_gap": competitor_gap,
        "recommendations": fail_recs if fail_recs else ["Page is well-optimized for SEO."]
    }
