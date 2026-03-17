"""
schemas.py — Pydantic models for all Scout.ai agent report outputs.

These are the canonical contracts between LLMs and the rest of the system.
If an LLM response doesn't conform, Pydantic raises a ValidationError,
which the agent catches and converts to a safe {"error": "..."} dict.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

class Evidence(BaseModel):
    check_key: str
    label: str = ""                 # Human-readable title for the screenshot
    description: str
    recommended_fix: str = ""       # One-line fix hint shown in the lightbox
    image_base64: str
    element_selector: str = ""


class ScoreResult(BaseModel):
    score: int = Field(ge=1, le=10)
    findings: list[str]             # 2-4 concise bullet points, each ≤ 15 words
    recommended_fix: str            # Single most impactful action to raise this score
    evidence: list[Evidence] = []


class StatusNote(BaseModel):
    status: Literal["pass", "warn", "fail"]
    note: str


class RiskArea(BaseModel):
    risk_level: Literal["High", "Medium", "Low"]
    findings: list[str]             # 2-4 concise bullet points, each ≤ 15 words
    recommended_fix: str            # Single most impactful action to reduce this risk
    evidence: list[Evidence] = []


# ---------------------------------------------------------------------------
# UI Report
# ---------------------------------------------------------------------------

class UIReport(BaseModel):
    overall_score: int = Field(ge=1, le=10)
    layout_spacing: ScoreResult
    responsiveness: ScoreResult
    typography: ScoreResult
    color_coherence: ScoreResult
    recommendations: list[str]


# ---------------------------------------------------------------------------
# UX Report
# ---------------------------------------------------------------------------

class UXReport(BaseModel):
    overall_score: int = Field(ge=1, le=10)
    accessibility: ScoreResult
    ux_friction: ScoreResult
    navigation_ia: ScoreResult
    inclusivity: ScoreResult
    recommendations: list[str]


# ---------------------------------------------------------------------------
# Compliance Report
# ---------------------------------------------------------------------------

class ComplianceReport(BaseModel):
    overall_risk_score: int = Field(ge=1, le=10)
    data_privacy: RiskArea
    legal_transparency: RiskArea
    accessibility_compliance: RiskArea
    critical_violations: list[str]


# ---------------------------------------------------------------------------
# SEO Report
# ---------------------------------------------------------------------------

class UniversalFactors(BaseModel):
    https_redirect: StatusNote
    meta_description: StatusNote
    crawlability_delta: StatusNote
    content_quality: StatusNote
    mobile_optimization: StatusNote


class SearchIntent(BaseModel):
    primary_intent: Literal[
        "Informational",
        "Navigational",
        "Commercial Investigation",
        "Transactional",
    ]
    target_keyword_suggestion: str
    top_entities: list[str]


class IntentAlignment(BaseModel):
    status: Literal["aligned", "misaligned", "partial"]
    explanation: str


class CompetitorGap(BaseModel):
    missing_crucial_entities: list[str]


class SEOReport(BaseModel):
    overall_score: int = Field(ge=1, le=10)
    universal_factors: UniversalFactors
    search_intent: SearchIntent
    intent_alignment: IntentAlignment
    competitor_gap: CompetitorGap
    recommendations: list[str]


# ---------------------------------------------------------------------------
# Multi-page models
# ---------------------------------------------------------------------------

class PageAuditResult(BaseModel):
    url: str
    page_type: str
    ui_report: Optional[dict] = None
    ux_report: Optional[dict] = None
    compliance_report: Optional[dict] = None
    seo_report: Optional[dict] = None
