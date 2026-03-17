"""
prompt_generator.py
-------------------
Generates phased, copy-paste-ready AI fix prompts from Scout audit results.

Works for both single-page audits and multi-page (site) audits.
No LLM calls — pure deterministic assembly from structured report data.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


# ---------------------------------------------------------------------------
# Phase definitions
# ---------------------------------------------------------------------------

PHASES = [
    {"phase": 1, "title": "Critical Fixes",  "color": "red"},
    {"phase": 2, "title": "Security",         "color": "orange"},
    {"phase": 3, "title": "Compliance",       "color": "amber"},
    {"phase": 4, "title": "SEO",              "color": "yellow"},
    {"phase": 5, "title": "UX",               "color": "blue"},
    {"phase": 6, "title": "UI Polish",        "color": "purple"},
]

MAX_ITEMS_PER_PHASE = 15


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _deduplicate(items: list[str]) -> list[str]:
    """Remove exact duplicates, preserving order."""
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        norm = item.strip().lower()
        if norm and norm not in seen:
            seen.add(norm)
            result.append(item.strip())
    return result


def _count_and_deduplicate(items: list[str], total_pages: int) -> list[str]:
    """
    Deduplicate across pages and annotate with 'Affects N pages' when
    the same issue recurs on multiple pages.
    """
    counts: Counter[str] = Counter()
    canonical: dict[str, str] = {}

    for item in items:
        norm = item.strip().lower()
        if not norm:
            continue
        counts[norm] += 1
        if norm not in canonical:
            canonical[norm] = item.strip()

    result: list[str] = []
    for norm, count in counts.most_common():
        text = canonical[norm]
        if count > 1:
            text = f"{text}  [Affects {count}/{total_pages} pages]"
        result.append(text)
    return result


def _build_prompt(
    phase: int,
    title: str,
    site_url: str,
    sections: list[tuple[str, list[str]]],   # [(category_name, [items]), ...]
) -> str:
    total_issues = sum(len(items) for _, items in sections)
    lines: list[str] = [
        f"You are fixing a website at {site_url or 'this website'}.",
        "",
        f"## Phase {phase} — {title}  ({total_issues} issue{'s' if total_issues != 1 else ''} to fix)",
        "",
        "## Issues to fix",
    ]

    for category, items in sections:
        if not items:
            continue
        lines.append(f"\n### {category}")
        for item in items:
            lines.append(f"- {item}")

    lines += [
        "",
        "## Instructions",
        "- Fix each issue listed above.",
        "- Do NOT change any functionality, content, or styling that is not listed above.",
        "- Make the smallest change that actually resolves each issue — no refactoring.",
        f"- After all fixes, do a quick manual check on mobile viewport.",
        f'- Commit with message: "fix: phase {phase} — {title.lower()}"',
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Single-page extraction helpers
# ---------------------------------------------------------------------------

def _extract_critical(
    security_report: dict | None,
    compliance_report: dict | None,
    seo_report: dict | None,
) -> list[tuple[str, list[str]]]:
    """Phase 1: pull critical/high items across all agents."""
    sections: list[tuple[str, list[str]]] = []

    # Security critical + high findings
    sec_critical: list[str] = []
    if security_report and not security_report.get("error"):
        for f in security_report.get("findings", []):
            if isinstance(f, dict) and f.get("severity", "").lower() in ("critical", "high"):
                rec = f.get("recommendation") or f.get("title", "")
                if rec:
                    sec_critical.append(rec)
    if sec_critical:
        sections.append(("Security — Critical / High", _deduplicate(sec_critical)))

    # Compliance critical violations
    comp_critical: list[str] = []
    if compliance_report and not compliance_report.get("error"):
        comp_critical = [v for v in compliance_report.get("critical_violations", []) if v]
    if comp_critical:
        sections.append(("Compliance — Critical Violations", _deduplicate(comp_critical)))

    # SEO hard failures
    seo_fails: list[str] = []
    if seo_report and not seo_report.get("error"):
        for _key, factor in (seo_report.get("universal_factors") or {}).items():
            if isinstance(factor, dict) and factor.get("status") == "fail":
                note = factor.get("note", _key)
                seo_fails.append(note)
    if seo_fails:
        sections.append(("SEO — Hard Failures", _deduplicate(seo_fails)))

    return sections


def _extract_security(security_report: dict | None) -> list[tuple[str, list[str]]]:
    if not security_report or security_report.get("error"):
        return []
    items: list[str] = []
    for f in security_report.get("findings", []):
        if isinstance(f, dict):
            rec = f.get("recommendation") or f.get("title", "")
            if rec:
                items.append(rec)
    if not items:
        return []
    return [("Security Findings", _deduplicate(items))]


def _extract_compliance(compliance_report: dict | None) -> list[tuple[str, list[str]]]:
    if not compliance_report or compliance_report.get("error"):
        return []
    sections: list[tuple[str, list[str]]] = []

    cat_map = {
        "Data Privacy":              compliance_report.get("data_privacy", {}),
        "Legal Transparency":        compliance_report.get("legal_transparency", {}),
        "Accessibility Compliance":  compliance_report.get("accessibility_compliance", {}),
    }
    for cat_name, cat in cat_map.items():
        if isinstance(cat, dict) and cat.get("risk_level", "Low").lower() != "low":
            findings = cat.get("findings", "")
            if findings:
                sections.append((cat_name, [findings]))

    violations = [v for v in compliance_report.get("critical_violations", []) if v]
    if violations:
        sections.append(("Critical Violations", _deduplicate(violations)))

    return sections


def _extract_seo(seo_report: dict | None) -> list[tuple[str, list[str]]]:
    if not seo_report or seo_report.get("error"):
        return []
    recs = [r for r in seo_report.get("recommendations", []) if r]
    if not recs:
        return []
    return [("SEO Recommendations", _deduplicate(recs))]


def _extract_ux(ux_report: dict | None) -> list[tuple[str, list[str]]]:
    if not ux_report or ux_report.get("error"):
        return []
    recs = [r for r in ux_report.get("recommendations", []) if r]
    if not recs:
        return []
    return [("UX Recommendations", _deduplicate(recs))]


def _extract_ui(ui_report: dict | None) -> list[tuple[str, list[str]]]:
    if not ui_report or ui_report.get("error"):
        return []
    recs = [r for r in ui_report.get("recommendations", []) if r]
    if not recs:
        return []
    return [("UI Recommendations", _deduplicate(recs))]


# ---------------------------------------------------------------------------
# Single-page entry point
# ---------------------------------------------------------------------------

def _generate_single_page(
    ui_report: dict | None,
    ux_report: dict | None,
    seo_report: dict | None,
    compliance_report: dict | None,
    security_report: dict | None,
    site_url: str,
) -> list[dict]:
    phase_data = [
        (1, "Critical Fixes", _extract_critical(security_report, compliance_report, seo_report)),
        (2, "Security",       _extract_security(security_report)),
        (3, "Compliance",     _extract_compliance(compliance_report)),
        (4, "SEO",            _extract_seo(seo_report)),
        (5, "UX",             _extract_ux(ux_report)),
        (6, "UI Polish",      _extract_ui(ui_report)),
    ]

    result: list[dict] = []
    for phase_num, title, sections in phase_data:
        # Trim each section to cap overall size
        trimmed: list[tuple[str, list[str]]] = []
        running = 0
        for cat, items in sections:
            remaining = MAX_ITEMS_PER_PHASE - running
            if remaining <= 0:
                break
            trimmed.append((cat, items[:remaining]))
            running += min(len(items), remaining)

        issue_count = sum(len(items) for _, items in trimmed)
        if issue_count == 0:
            continue

        result.append({
            "phase":       phase_num,
            "title":       title,
            "issue_count": issue_count,
            "prompt":      _build_prompt(phase_num, title, site_url, trimmed),
        })

    return result


# ---------------------------------------------------------------------------
# Multi-page aggregation helpers
# ---------------------------------------------------------------------------

def _aggregate_security(pages: list[dict], site_url: str) -> dict | None:
    """Merge per-page page_security_findings and site-level security_report."""
    all_findings: list[dict] = []

    # Site-level security (passed as security_report on first page or separately)
    # We look at every page's security_report key if present
    for p in pages:
        sr = p.get("security_report") or p.get("securityReport")
        if isinstance(sr, dict) and not sr.get("error"):
            for f in sr.get("findings", []):
                if isinstance(f, dict):
                    all_findings.append(f)
        # Per-page content security findings
        for f in (p.get("page_security_findings") or p.get("pageSecurityFindings") or []):
            if isinstance(f, dict):
                all_findings.append(f)

    if not all_findings:
        return None
    return {"findings": all_findings}


def _aggregate_report_lists(
    pages: list[dict],
    report_key_camel: str,
    report_key_snake: str,
    *list_field_paths: str,   # dot-separated paths to string-list fields
) -> dict[str, list[str]]:
    """
    Pull string lists out of a per-page report and merge, tracking page frequency.
    Returns {field_path: [item_with_frequency_annotation, ...]}
    """
    from collections import defaultdict
    item_pages: dict[str, dict[str, int]] = defaultdict(Counter)  # field -> norm -> count

    total = len(pages)
    for p in pages:
        report = p.get(report_key_camel) or p.get(report_key_snake) or {}
        if not isinstance(report, dict) or report.get("error"):
            continue
        for path in list_field_paths:
            parts = path.split(".")
            val: Any = report
            for part in parts:
                if not isinstance(val, dict):
                    val = None
                    break
                val = val.get(part)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, str) and item.strip():
                        norm = item.strip().lower()
                        item_pages[path][norm] += 1

    # Build annotated lists
    result: dict[str, list[str]] = {}
    # We need canonical text too — re-scan for it
    canonical: dict[str, dict[str, str]] = defaultdict(dict)
    for p in pages:
        report = p.get(report_key_camel) or p.get(report_key_snake) or {}
        if not isinstance(report, dict):
            continue
        for path in list_field_paths:
            parts = path.split(".")
            val: Any = report
            for part in parts:
                if not isinstance(val, dict):
                    val = None
                    break
                val = val.get(part)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, str) and item.strip():
                        norm = item.strip().lower()
                        if norm not in canonical[path]:
                            canonical[path][norm] = item.strip()

    for path, counts in item_pages.items():
        annotated: list[str] = []
        for norm, count in counts.most_common(MAX_ITEMS_PER_PHASE):
            text = canonical[path].get(norm, norm)
            if count > 1:
                text = f"{text}  [Affects {count}/{total} pages]"
            annotated.append(text)
        result[path] = annotated

    return result


def _aggregate_compliance_categories(pages: list[dict], total: int) -> dict:
    """Aggregate compliance category findings (string fields, not lists)."""
    from collections import defaultdict
    cat_findings: dict[str, Counter] = defaultdict(Counter)

    CAT_KEYS = ["data_privacy", "legal_transparency", "accessibility_compliance"]

    for p in pages:
        report = p.get("complianceReport") or p.get("compliance_report") or {}
        if not isinstance(report, dict) or report.get("error"):
            continue
        for key in CAT_KEYS:
            cat = report.get(key, {})
            if isinstance(cat, dict):
                findings = cat.get("findings", "")
                risk = cat.get("risk_level", "Low")
                if findings and risk.lower() != "low":
                    norm = findings.strip().lower()
                    cat_findings[key][norm] += 1

    result: dict[str, list[str]] = {}
    canonical: dict[str, dict[str, str]] = {}

    for p in pages:
        report = p.get("complianceReport") or p.get("compliance_report") or {}
        if not isinstance(report, dict):
            continue
        for key in CAT_KEYS:
            cat = report.get(key, {})
            if isinstance(cat, dict):
                findings = cat.get("findings", "")
                if findings.strip():
                    norm = findings.strip().lower()
                    if key not in canonical:
                        canonical[key] = {}
                    if norm not in canonical[key]:
                        canonical[key][norm] = findings.strip()

    for key, counts in cat_findings.items():
        items: list[str] = []
        for norm, count in counts.most_common(5):
            text = (canonical.get(key) or {}).get(norm, norm)
            if count > 1:
                text = f"{text}  [Affects {count}/{total} pages]"
            items.append(text)
        result[key] = items

    return result


# ---------------------------------------------------------------------------
# Multi-page entry point
# ---------------------------------------------------------------------------

def _generate_multi_page(pages: list[dict], site_url: str) -> list[dict]:
    total = len(pages)

    # ── Phase 1: Critical ──────────────────────────────────────────────────
    p1_sections: list[tuple[str, list[str]]] = []

    # Security critical/high across all pages
    sec_critical: list[str] = []
    for p in pages:
        for report_key in ("security_report", "securityReport"):
            sr = p.get(report_key)
            if isinstance(sr, dict):
                for f in sr.get("findings", []):
                    if isinstance(f, dict) and f.get("severity", "").lower() in ("critical", "high"):
                        rec = f.get("recommendation") or f.get("title", "")
                        if rec:
                            sec_critical.append(rec)
        for f in (p.get("page_security_findings") or p.get("pageSecurityFindings") or []):
            if isinstance(f, dict) and f.get("severity", "").lower() in ("critical", "high"):
                rec = f.get("recommendation") or f.get("title", "")
                if rec:
                    sec_critical.append(rec)
    if sec_critical:
        p1_sections.append(("Security — Critical / High", _count_and_deduplicate(sec_critical, total)))

    # Compliance critical violations across pages
    comp_crit_all: list[str] = []
    for p in pages:
        r = p.get("complianceReport") or p.get("compliance_report") or {}
        if isinstance(r, dict):
            comp_crit_all.extend(v for v in r.get("critical_violations", []) if v)
    if comp_crit_all:
        p1_sections.append(("Compliance — Critical Violations", _count_and_deduplicate(comp_crit_all, total)))

    # SEO hard failures
    seo_fails_all: list[str] = []
    for p in pages:
        r = p.get("seoReport") or p.get("seo_report") or {}
        if isinstance(r, dict):
            for _key, factor in (r.get("universal_factors") or {}).items():
                if isinstance(factor, dict) and factor.get("status") == "fail":
                    seo_fails_all.append(factor.get("note", _key))
    if seo_fails_all:
        p1_sections.append(("SEO — Hard Failures", _count_and_deduplicate(seo_fails_all, total)))

    # ── Phase 2: Security ─────────────────────────────────────────────────
    p2_sections: list[tuple[str, list[str]]] = []
    all_sec: list[str] = []
    for p in pages:
        for report_key in ("security_report", "securityReport"):
            sr = p.get(report_key)
            if isinstance(sr, dict):
                for f in sr.get("findings", []):
                    if isinstance(f, dict):
                        rec = f.get("recommendation") or f.get("title", "")
                        if rec:
                            all_sec.append(rec)
        for f in (p.get("page_security_findings") or p.get("pageSecurityFindings") or []):
            if isinstance(f, dict):
                rec = f.get("recommendation") or f.get("title", "")
                if rec:
                    all_sec.append(rec)
    if all_sec:
        p2_sections.append(("Security Findings", _count_and_deduplicate(all_sec, total)))

    # ── Phase 3: Compliance ────────────────────────────────────────────────
    p3_sections: list[tuple[str, list[str]]] = []
    cat_data = _aggregate_compliance_categories(pages, total)
    cat_label_map = {
        "data_privacy": "Data Privacy",
        "legal_transparency": "Legal Transparency",
        "accessibility_compliance": "Accessibility Compliance",
    }
    for key, label in cat_label_map.items():
        if cat_data.get(key):
            p3_sections.append((label, cat_data[key]))
    # critical violations (deduplicated already in phase 1 but also here for completeness)
    if comp_crit_all:
        p3_sections.append(("Critical Violations", _count_and_deduplicate(comp_crit_all, total)))

    # ── Phase 4: SEO ───────────────────────────────────────────────────────
    p4_agg = _aggregate_report_lists(pages, "seoReport", "seo_report", "recommendations")
    p4_sections: list[tuple[str, list[str]]] = []
    if p4_agg.get("recommendations"):
        p4_sections.append(("SEO Recommendations", p4_agg["recommendations"]))

    # ── Phase 5: UX ────────────────────────────────────────────────────────
    p5_agg = _aggregate_report_lists(pages, "uxReport", "ux_report", "recommendations")
    p5_sections: list[tuple[str, list[str]]] = []
    if p5_agg.get("recommendations"):
        p5_sections.append(("UX Recommendations", p5_agg["recommendations"]))

    # ── Phase 6: UI ────────────────────────────────────────────────────────
    p6_agg = _aggregate_report_lists(pages, "uiReport", "ui_report", "recommendations")
    p6_sections: list[tuple[str, list[str]]] = []
    if p6_agg.get("recommendations"):
        p6_sections.append(("UI Recommendations", p6_agg["recommendations"]))

    phase_data = [
        (1, "Critical Fixes", p1_sections),
        (2, "Security",       p2_sections),
        (3, "Compliance",     p3_sections),
        (4, "SEO",            p4_sections),
        (5, "UX",             p5_sections),
        (6, "UI Polish",      p6_sections),
    ]

    result: list[dict] = []
    for phase_num, title, sections in phase_data:
        trimmed: list[tuple[str, list[str]]] = []
        running = 0
        for cat, items in sections:
            remaining = MAX_ITEMS_PER_PHASE - running
            if remaining <= 0:
                break
            trimmed.append((cat, items[:remaining]))
            running += min(len(items), remaining)

        issue_count = sum(len(items) for _, items in trimmed)
        if issue_count == 0:
            continue

        result.append({
            "phase":       phase_num,
            "title":       title,
            "issue_count": issue_count,
            "prompt":      _build_prompt(phase_num, title, site_url, trimmed),
        })

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_phased_prompts(
    *,
    # Single-page mode
    ui_report:          dict | None = None,
    ux_report:          dict | None = None,
    seo_report:         dict | None = None,
    compliance_report:  dict | None = None,
    security_report:    dict | None = None,
    # Multi-page mode
    pages:              list[dict] | None = None,
    multi_page:         bool = False,
    site_url:           str = "",
) -> list[dict]:
    """
    Generate phased AI fix prompts from Scout audit results.

    Single-page mode: pass individual report dicts.
    Multi-page mode:  pass pages=[{uiReport/ui_report, uxReport/ux_report, ...}, ...]

    Returns a list of phase dicts (phases with 0 issues are omitted):
        [{"phase": int, "title": str, "issue_count": int, "prompt": str}, ...]
    """
    if multi_page and pages:
        return _generate_multi_page(pages, site_url)

    return _generate_single_page(
        ui_report=ui_report,
        ux_report=ux_report,
        seo_report=seo_report,
        compliance_report=compliance_report,
        security_report=security_report,
        site_url=site_url,
    )
