"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAuditStream,
  type ComplianceReport,
  type Evidence,
  type PageAuditResult,
  type SiteReport,
  type UiReport,
  type UxReport,
  type SeoReport,
  type DiscoveredPage,
} from "@/hooks/useAuditStream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type AgentId = "ui" | "ux" | "compliance" | "seo";
type TabId = "overall" | AgentId;
type AgentStatus = "processing" | "complete";
type AgentState = { progress: number; status: AgentStatus; line: string };
type Check = {
  label: string;
  pass: boolean;
  findings?: string[];
  recommendedFix?: string;
  evidence?: Evidence[];
};

const PAGE_TYPE_ICONS: Record<string, string> = {
  "Landing Page":    "🏠",
  "Login Page":      "🔐",
  "Sign-up Page":    "📝",
  "Pricing Page":    "💰",
  "About Page":      "ℹ️",
  "Contact Page":    "📞",
  "Blog / Content":  "📰",
  "Product Page":    "📦",
  "App / Dashboard": "⚙️",
  "Checkout Page":   "🛒",
  "Legal Page":      "📋",
  "Other":           "🔗",
};

const AGENTS: { id: AgentId; name: string; color: string; glow: string }[] = [
  { id: "ui",         name: "UI Agent",          color: "#8b5cf6", glow: "rgba(139,92,246,0.25)" },
  { id: "ux",         name: "UX Agent",          color: "#3b82f6", glow: "rgba(59,130,246,0.25)" },
  { id: "compliance", name: "Compliance Agent",  color: "#ef4444", glow: "rgba(239,68,68,0.25)" },
  { id: "seo",        name: "SEO Agent",         color: "#f59e0b", glow: "rgba(245,158,11,0.25)" },
];

const AGENT_MESSAGES: Record<AgentId, string[]> = {
  ui:         ["Scanning visual hierarchy...", "Analyzing spacing consistency...", "Evaluating typography clarity...", "Checking color coherence..."],
  ux:         ["Simulating user journeys...", "Detecting interaction friction...", "Assessing navigation & IA...", "Reviewing accessibility affordances..."],
  compliance: ["Checking GDPR/CCPA signals...", "Evaluating legal transparency...", "Auditing accessibility compliance...", "Identifying critical violations..."],
  seo:        ["Validating metadata...", "Checking crawlability delta...", "Scoring intent alignment...", "Finding content quality issues..."],
};

const SCORE_COLORS: Record<AgentId, string> = {
  ui: "#8b5cf6", ux: "#3b82f6", compliance: "#ef4444", seo: "#f59e0b",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function scoreFromRisk(r: number) { return Math.max(0, Math.min(100, 100 - r * 10)); }
function mapRiskToPass(rl: string) { return rl.toLowerCase() === "low"; }
function seoFactorToPass(s: string) { return s.toLowerCase() === "pass"; }

function buildUiChecks(r: UiReport | null): Check[] {
  if (!r) return [];
  return [
    { label: "Layout & spacing", pass: r.layout_spacing.score >= 6, findings: r.layout_spacing.findings, recommendedFix: r.layout_spacing.recommended_fix, evidence: r.layout_spacing.evidence },
    { label: "Responsiveness",   pass: r.responsiveness.score >= 6, findings: r.responsiveness.findings, recommendedFix: r.responsiveness.recommended_fix, evidence: r.responsiveness.evidence },
    { label: "Typography",       pass: r.typography.score >= 6,     findings: r.typography.findings,     recommendedFix: r.typography.recommended_fix,     evidence: r.typography.evidence },
    { label: "Color coherence",  pass: r.color_coherence.score >= 6, findings: r.color_coherence.findings, recommendedFix: r.color_coherence.recommended_fix, evidence: r.color_coherence.evidence },
  ];
}
function buildUxChecks(r: UxReport | null): Check[] {
  if (!r) return [];
  return [
    { label: "Accessibility",  pass: r.accessibility.score >= 6,  findings: r.accessibility.findings,  recommendedFix: r.accessibility.recommended_fix,  evidence: r.accessibility.evidence },
    { label: "UX friction",    pass: r.ux_friction.score >= 6,    findings: r.ux_friction.findings,    recommendedFix: r.ux_friction.recommended_fix,    evidence: r.ux_friction.evidence },
    { label: "Navigation & IA",pass: r.navigation_ia.score >= 6,  findings: r.navigation_ia.findings,  recommendedFix: r.navigation_ia.recommended_fix,  evidence: r.navigation_ia.evidence },
    { label: "Inclusivity",    pass: r.inclusivity.score >= 6,    findings: r.inclusivity.findings,    recommendedFix: r.inclusivity.recommended_fix,    evidence: r.inclusivity.evidence },
  ];
}
function buildComplianceChecks(r: ComplianceReport | null): Check[] {
  if (!r) return [];
  return [
    { label: `Data privacy (${r.data_privacy.risk_level})`,             pass: mapRiskToPass(r.data_privacy.risk_level),             findings: r.data_privacy.findings,             recommendedFix: r.data_privacy.recommended_fix,             evidence: r.data_privacy.evidence },
    { label: `Legal transparency (${r.legal_transparency.risk_level})`, pass: mapRiskToPass(r.legal_transparency.risk_level),         findings: r.legal_transparency.findings,         recommendedFix: r.legal_transparency.recommended_fix,         evidence: r.legal_transparency.evidence },
    { label: `Accessibility compliance (${r.accessibility_compliance.risk_level})`, pass: mapRiskToPass(r.accessibility_compliance.risk_level), findings: r.accessibility_compliance.findings, recommendedFix: r.accessibility_compliance.recommended_fix, evidence: r.accessibility_compliance.evidence },
  ];
}
function buildSeoChecks(r: SeoReport | null): Check[] {
  if (!r) return [];
  return Object.entries(r.universal_factors).map(([key, value]) => ({
    label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    pass: seoFactorToPass(value.status),
    findings: [value.note],
  }));
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

function AgentIcon({ id }: { id: AgentId }) {
  if (id === "ui") return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>);
  if (id === "ux") return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>);
  if (id === "compliance") return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>);
}

// ---------------------------------------------------------------------------
// Circular gauge
// ---------------------------------------------------------------------------

function CircularGauge({ score, size = 140 }: { score: number; size?: number }) {
  const r = 50, circ = 2 * Math.PI * r, offset = circ * (1 - score / 100);
  const color = score >= 80 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 60 60)" style={{ filter: `drop-shadow(0 0 6px ${color})`, opacity: 0.3, transition: "stroke-dashoffset 1.2s ease-out" }} />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset 1.2s ease-out" }} />
        <text x="60" y="55" textAnchor="middle" fill="#f0f2f5" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">{score}</text>
        <text x="60" y="70" textAnchor="middle" fill="#7a8394" fontSize="9" fontFamily="var(--font-display)">/100</text>
      </svg>
      <p className="text-text-sub text-xs">Overall Score</p>
    </div>
  );
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${score}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <span className="text-xs font-semibold text-text w-7 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence panel
// ---------------------------------------------------------------------------

function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  const [expanded, setExpanded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="mt-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-xs font-semibold transition-all rounded-md px-2.5 py-1.5" style={{ color: "#a78bfa", background: expanded ? "rgba(139,92,246,0.1)" : "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
        {expanded ? "Hide" : "View"} evidence
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(139,92,246,0.2)", color: "#c4b5fd" }}>{evidence.length}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 animate-fade-in">
          {evidence.map((ev, i) => (
            <div key={`${ev.check_key}-${i}`} className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-text text-xs font-medium truncate">{ev.label || ev.description}</p>
                  {ev.element_selector && <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>{ev.element_selector}</p>}
                </div>
                <button onClick={() => setLightboxIdx(i)} className="shrink-0 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md" style={{ color: "#a78bfa", background: "rgba(139,92,246,0.1)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><line x1="14" y1="10" x2="21" y2="3" /></svg>
                  Expand
                </button>
              </div>
              <button onClick={() => setLightboxIdx(i)} className="w-full cursor-pointer block" style={{ maxHeight: 200 }}>
                <img src={`data:image/png;base64,${ev.image_base64}`} alt={ev.label || ev.description} className="w-full object-contain" style={{ maxHeight: 200, background: "#0a0a14" }} />
              </button>
            </div>
          ))}
        </div>
      )}
      {lightboxIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: "rgba(0,0,0,0.9)", backdropFilter: "blur(8px)" }} onClick={() => setLightboxIdx(null)}>
          <div className="relative flex flex-col rounded-2xl overflow-hidden" style={{ maxWidth: "min(90vw,800px)", maxHeight: "85vh", border: "1px solid rgba(255,255,255,0.1)", background: "#0d0d1a" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 flex items-center justify-center overflow-hidden" style={{ background: "#080812" }}>
              <img src={`data:image/png;base64,${evidence[lightboxIdx].image_base64}`} alt={evidence[lightboxIdx].label || evidence[lightboxIdx].description} className="max-w-full max-h-[65vh] object-contain" />
            </div>
            <div className="px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>Issue #{lightboxIdx + 1} of {evidence.length}</span>
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{evidence[lightboxIdx].check_key}</span>
              </div>
              {evidence[lightboxIdx].label && <p className="text-text text-sm font-semibold mb-1">{evidence[lightboxIdx].label}</p>}
              <p className="text-text-sub text-xs leading-relaxed">{evidence[lightboxIdx].description}</p>
              {evidence[lightboxIdx].element_selector && <p className="text-text-sub text-xs font-mono mt-1 opacity-50">{evidence[lightboxIdx].element_selector}</p>}
              {evidence[lightboxIdx].recommended_fix && (
                <div className="mt-2 px-2.5 py-1.5 rounded-md text-[11px] leading-relaxed" style={{ background: "rgba(34,197,94,0.07)", color: "#86efac", border: "1px solid rgba(34,197,94,0.12)" }}>💡 {evidence[lightboxIdx].recommended_fix}</div>
              )}
            </div>
            <button onClick={() => setLightboxIdx(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
            {evidence.length > 1 && (
              <>
                <button onClick={() => setLightboxIdx((lightboxIdx - 1 + evidence.length) % evidence.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button onClick={() => setLightboxIdx((lightboxIdx + 1) % evidence.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report tab content
// ---------------------------------------------------------------------------

function ReportTabContent({
  activeTab, scores, checks, summaries, actions, uiReport, uxReport, complianceReport, seoReport,
}: {
  activeTab: TabId;
  scores: Record<TabId, number>;
  checks: Record<AgentId, Check[]>;
  summaries: Record<AgentId | "overall", string>;
  actions: { priority: "Critical" | "High" | "Medium"; source: string; text: string }[];
  uiReport: UiReport | null;
  uxReport: UxReport | null;
  complianceReport: ComplianceReport | null;
  seoReport: SeoReport | null;
}) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "overall", label: "Overall" },
    { id: "ui", label: "UI" },
    { id: "ux", label: "UX" },
    { id: "compliance", label: "Compliance" },
    { id: "seo", label: "SEO" },
  ];

  const [tab, setTab] = useState<TabId>(activeTab);
  useEffect(() => { setTab(activeTab); }, [activeTab]);

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg mb-6 overflow-x-auto" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {tabs.map((t) => {
          const isActive = tab === t.id;
          const col = t.id === "overall" ? "#8b5cf6" : SCORE_COLORS[t.id as AgentId];
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap" style={isActive ? { background: "rgba(255,255,255,0.09)", color: col, boxShadow: `0 0 12px ${col}22` } : { color: "#7a8394" }}>
              {t.label}
              {t.id !== "overall" && <span className="text-[10px] font-mono font-semibold" style={{ color: isActive ? col : "rgba(255,255,255,0.2)" }}>{scores[t.id as AgentId]}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div key={tab} className="animate-fade-in">
        {tab === "overall" ? (
          <div className="space-y-5">
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="glass-card rounded-xl p-5 flex flex-col items-center justify-center">
                <CircularGauge score={scores.overall} />
              </div>
              <div className="lg:col-span-2 glass-card rounded-xl p-6">
                <h3 className="text-text font-semibold mb-3 flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
                  Executive Summary
                </h3>
                <p className="text-text-sub text-sm leading-relaxed mb-4">{summaries.overall}</p>
                <div className="space-y-2.5">
                  {(["ui", "ux", "compliance", "seo"] as AgentId[]).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-text-sub text-xs w-24 capitalize">{k}</span>
                      <ScoreBar score={scores[k]} color={SCORE_COLORS[k]} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="glass-card rounded-xl p-6">
              <h3 className="text-text font-semibold mb-4">Priority Actions</h3>
              <div className="space-y-3">
                {actions.length === 0 && <p className="text-text-sub text-sm">No recommendations yet.</p>}
                {actions.map((action, i) => {
                  const priorityColor = action.priority === "Critical" ? "#ef4444" : action.priority === "High" ? "#f59e0b" : "#8b5cf6";
                  const sourceColor: Record<string, string> = { UI: "#8b5cf6", UX: "#3b82f6", Compliance: "#ef4444", SEO: "#f59e0b" };
                  return (
                    <div key={`${action.text}-${i}`} className="flex gap-3 items-start p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span className="shrink-0 w-6 h-6 rounded-full bg-black/40 text-xs font-bold flex items-center justify-center" style={{ color: priorityColor, border: `1px solid ${priorityColor}40` }}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold" style={{ color: priorityColor }}>{action.priority}</span>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: `${sourceColor[action.source] ?? "#ffffff"}18`, color: sourceColor[action.source] ?? "#ffffff" }}>{action.source}</span>
                        </div>
                        <span className="text-text-sub text-sm">{action.text}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="glass-card rounded-xl p-5 flex flex-col items-center justify-center">
                <p className="text-text-sub text-xs text-center mb-2 capitalize">{tab} Score</p>
                <div className="relative flex items-center justify-center">
                  <svg width="100" height="100" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke={SCORE_COLORS[tab as AgentId]} strokeWidth="6" strokeLinecap="round" strokeDasharray="314.16" strokeDashoffset={314.16 * (1 - scores[tab] / 100)} transform="rotate(-90 60 60)" style={{ filter: `drop-shadow(0 0 6px ${SCORE_COLORS[tab as AgentId]})`, transition: "stroke-dashoffset 1.2s ease-out" }} />
                    <text x="60" y="55" textAnchor="middle" fill="#f0f2f5" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">{scores[tab]}</text>
                    <text x="60" y="70" textAnchor="middle" fill="#7a8394" fontSize="9" fontFamily="var(--font-display)">/100</text>
                  </svg>
                </div>
                {tab === "compliance" && complianceReport && <p className="text-xs text-text-sub mt-2">Risk score: {complianceReport.overall_risk_score}/10</p>}
              </div>
              <div className="lg:col-span-2 glass-card rounded-xl p-6">
                <h3 className="text-text font-semibold mb-3 capitalize">{tab} Insights</h3>
                <p className="text-text-sub text-sm leading-relaxed">{summaries[tab as AgentId]}</p>
              </div>
            </div>
            <div className="glass-card rounded-xl p-6">
              <h3 className="text-text font-semibold mb-4">Detailed Checks</h3>
              <div className="space-y-3">
                {(checks[tab as AgentId] || []).map((check, i) => (
                  <div key={`${check.label}-${i}`} className="rounded-xl" style={{ background: check.pass ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.05)", border: `1px solid ${check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.12)"}` }}>
                    <div className="flex items-start gap-3 p-4">
                      <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center" style={{ background: check.pass ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                        {check.pass ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-text text-sm font-medium capitalize">{check.label}</p>
                        {check.findings && check.findings.length > 0 && (
                          <ul className="mt-2 space-y-1 pl-4 list-disc">
                            {check.findings.map((b, bi) => <li key={bi} className="text-[11px] leading-relaxed" style={{ color: check.pass ? "#22c55eaa" : "#ef4444bb" }}>{b}</li>)}
                          </ul>
                        )}
                        {!check.pass && check.recommendedFix && (
                          <div className="mt-2 px-2.5 py-1.5 rounded-md text-[11px] leading-relaxed" style={{ background: "rgba(34,197,94,0.07)", color: "#86efac", border: "1px solid rgba(34,197,94,0.12)" }}>💡 {check.recommendedFix}</div>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: check.pass ? "#22c55e" : "#ef4444" }}>{check.pass ? "PASS" : "FAIL"}</span>
                    </div>
                    {check.evidence && check.evidence.length > 0 && (
                      <div className="px-4 pb-4" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <EvidencePanel evidence={check.evidence} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function AnalysisDashboard() {
  const params = useSearchParams();
  const targetUrl = params.get("url") || "your-website.com";

  const { discoveredPages, completedPageUrls, siteReport, pageResults, isDone, error } = useAuditStream(targetUrl);

  // Agent card animation state
  const [agentStates, setAgentStates] = useState<Record<AgentId, AgentState>>(() => ({
    ui:         { progress: 0, status: "processing", line: AGENT_MESSAGES.ui[0] },
    ux:         { progress: 0, status: "processing", line: AGENT_MESSAGES.ux[0] },
    compliance: { progress: 0, status: "processing", line: AGENT_MESSAGES.compliance[0] },
    seo:        { progress: 0, status: "processing", line: AGENT_MESSAGES.seo[0] },
  }));
  const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Selected page: null = show site overview, string = specific page URL
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overall");

  const showResults = isDone || !!siteReport;

  // Reset page selection when a new audit starts
  useEffect(() => { setSelectedPageUrl(null); setActiveTab("overall"); }, [targetUrl]);

  // Compute which reports to show (site-wide or per-page)
  const activeReports = useMemo(() => {
    if (selectedPageUrl) {
      const pr = pageResults.find((r) => r.url === selectedPageUrl);
      return { uiReport: pr?.ui_report ?? null, uxReport: pr?.ux_report ?? null, complianceReport: pr?.compliance_report ?? null, seoReport: pr?.seo_report ?? null };
    }
    return {
      uiReport: siteReport?.ui_report ?? null,
      uxReport: siteReport?.ux_report ?? null,
      complianceReport: siteReport?.compliance_report ?? null,
      seoReport: siteReport?.seo_report ?? null,
    };
  }, [selectedPageUrl, pageResults, siteReport]);

  const { uiReport, uxReport, complianceReport, seoReport } = activeReports;

  const scores = useMemo<Record<TabId, number>>(() => {
    const uiScore = uiReport ? (uiReport.overall_score ?? 0) * 10 : 0;
    const uxScore = uxReport ? (uxReport.overall_score ?? 0) * 10 : 0;
    const complianceScore = complianceReport ? scoreFromRisk(complianceReport.overall_risk_score ?? 0) : 0;
    const seoScore = seoReport ? (seoReport.overall_score ?? 0) * 10 : 0;
    const available = [uiScore, uxScore, complianceScore, seoScore].filter((x) => x > 0);
    const overall = available.length ? Math.round(available.reduce((a, b) => a + b, 0) / available.length) : 0;
    return { overall, ui: uiScore, ux: uxScore, compliance: complianceScore, seo: seoScore };
  }, [uiReport, uxReport, complianceReport, seoReport]);

  const checks = useMemo<Record<AgentId, Check[]>>(() => ({
    ui: buildUiChecks(uiReport),
    ux: buildUxChecks(uxReport),
    compliance: buildComplianceChecks(complianceReport),
    seo: buildSeoChecks(seoReport),
  }), [uiReport, uxReport, complianceReport, seoReport]);

  const summaries = useMemo<Record<AgentId | "overall", string>>(() => {
    const label = selectedPageUrl
      ? (() => { const pr = pageResults.find((r) => r.url === selectedPageUrl); return pr ? `${PAGE_TYPE_ICONS[pr.page_type] ?? "🔗"} ${pr.page_type}` : ""; })()
      : `${siteReport?.pages_analysed ?? 0} pages`;
    return {
      overall: `UI ${scores.ui}/100 · UX ${scores.ux}/100 · Compliance ${scores.compliance}/100 · SEO ${scores.seo}/100`,
      ui:         uiReport  ? `Score ${uiReport.overall_score}/10 — ${uiReport.layout_spacing.findings?.[0] ?? ""}` : "UI analysis pending.",
      ux:         uxReport  ? `Score ${uxReport.overall_score}/10 — ${uxReport.accessibility.findings?.[0] ?? ""}` : "UX analysis pending.",
      compliance: complianceReport ? `Risk score ${complianceReport.overall_risk_score}/10 — ${complianceReport.data_privacy.findings?.[0] ?? ""}` : "Compliance analysis pending.",
      seo:        seoReport ? `SEO score ${seoReport.overall_score}/10 — ${seoReport.intent_alignment?.explanation ?? ""}` : "SEO analysis pending.",
    };
  }, [uiReport, uxReport, complianceReport, seoReport, scores, selectedPageUrl, pageResults, siteReport]);

  const actions = useMemo<{ priority: "Critical" | "High" | "Medium"; source: string; text: string }[]>(() => {
    const items: { priority: "Critical" | "High" | "Medium"; source: string; text: string }[] = [];
    complianceReport?.critical_violations?.forEach((v) => items.push({ priority: "Critical", source: "Compliance", text: v }));
    uiReport?.recommendations?.forEach((r) => items.push({ priority: "High", source: "UI", text: r }));
    uxReport?.recommendations?.forEach((r) => items.push({ priority: "High", source: "UX", text: r }));
    seoReport?.recommendations?.forEach((r) => items.push({ priority: "Medium", source: "SEO", text: r }));
    return items.slice(0, 8);
  }, [uiReport, uxReport, complianceReport, seoReport]);

  // Agent card animations (progress bars + rotating messages)
  useEffect(() => {
    AGENTS.forEach((agent) => {
      const id = agent.id;
      const messages = AGENT_MESSAGES[id];
      let msgIdx = 0;
      intervalsRef.current[`${id}_msg`] = setInterval(() => {
        msgIdx = (msgIdx + 1) % messages.length;
        setAgentStates((prev) => ({ ...prev, [id]: { ...prev[id], line: messages[msgIdx] } }));
      }, 1400);
      intervalsRef.current[`${id}_progress`] = setInterval(() => {
        setAgentStates((prev) => {
          if (prev[id].status === "complete") return prev;
          return { ...prev, [id]: { ...prev[id], progress: Math.min(92, prev[id].progress + 2) } };
        });
      }, 450);
    });
    return () => { Object.values(intervalsRef.current).forEach(clearInterval); };
  }, []);

  useEffect(() => {
    if (!isDone) return;
    AGENTS.forEach((agent) => {
      clearInterval(intervalsRef.current[`${agent.id}_msg`]);
      clearInterval(intervalsRef.current[`${agent.id}_progress`]);
      setAgentStates((prev) => ({ ...prev, [agent.id]: { progress: 100, status: "complete", line: "Analysis complete." } }));
    });
  }, [isDone]);

  // Derive selected page info for banner
  const selectedPage = selectedPageUrl ? pageResults.find((r) => r.url === selectedPageUrl) ?? null : null;

  return (
    <div className="min-h-screen bg-grid relative overflow-x-hidden">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-200 h-75 rounded-full opacity-15" style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(60px)" }} />

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-10 pb-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-10 animate-fade-in">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-text-sub text-sm">Analyzing</span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium text-text" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {targetUrl.length > 40 ? `${targetUrl.slice(0, 40)}...` : targetUrl}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-text">AI Analysis Dashboard</h1>
          </div>
          <a href="/" className="text-text-sub text-sm hover:text-text transition-colors flex items-center gap-1.5 mt-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            New analysis
          </a>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-8 p-4 rounded-xl flex items-start gap-3 animate-fade-in" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <svg className="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#ef4444" }}>Audit failed</p>
              <p className="text-xs mt-0.5" style={{ color: "#ef444499" }}>{error}</p>
            </div>
          </div>
        )}

        {/* Agent cards */}
        <section className="mb-10">
          <p className="text-text-sub text-xs font-medium tracking-widest uppercase mb-4 animate-fade-in">Active Agents</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENTS.map((agent, i) => {
              const state = agentStates[agent.id];
              const agentDone = state.status === "complete";
              return (
                <div key={agent.id} className={`glass-card rounded-xl p-4 animate-fade-in-up delay-${(i + 1) * 100} transition-all duration-500 ${agentDone ? "opacity-80" : ""}`} style={agentDone ? {} : { borderColor: `${agent.color}22` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${agent.color}18`, color: agent.color }}><AgentIcon id={agent.id} /></div>
                      <span className="text-text text-sm font-semibold">{agent.name}</span>
                    </div>
                    {agentDone ? (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                    ) : (
                      <div className="relative flex items-center justify-center w-5 h-5">
                        <span className="absolute w-3 h-3 rounded-full opacity-40 animate-pulse-ring" style={{ background: agent.color }} />
                        <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: agent.color, boxShadow: `0 0 6px ${agent.color}` }} />
                      </div>
                    )}
                  </div>
                  <div className="h-1 rounded-full mb-3 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full relative overflow-hidden transition-all duration-150" style={{ width: `${state.progress}%`, background: agentDone ? `linear-gradient(90deg, ${agent.color}aa, ${agent.color})` : `linear-gradient(90deg, ${agent.color}66, ${agent.color})`, boxShadow: `0 0 8px ${agent.glow}` }}>
                      {!agentDone && <span className="absolute inset-0 opacity-50" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)", animation: "progress-shimmer 1.5s ease-in-out infinite" }} />}
                    </div>
                  </div>
                  <div className="rounded-md px-2.5 py-1.5" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <p className="font-mono text-[10px] leading-relaxed truncate" style={{ color: agentDone ? "#22c55e" : agent.color }}>
                      <span style={{ opacity: 0.5 }}>$ </span>{state.line}{!agentDone && <span className="animate-terminal-cur">▋</span>}
                    </p>
                  </div>
                  <p className="text-right text-[10px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>{state.progress}%</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Section A: Crawl Progress List ── */}
        {discoveredPages.length > 0 && (
          <section className="mb-8 animate-fade-in">
            <div className="flex items-center gap-3 mb-3">
              <p className="text-text-sub text-xs font-medium tracking-widest uppercase">Pages Being Analysed ({discoveredPages.length})</p>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              {isDone && <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Complete</span>}
            </div>
            <div className="glass-card rounded-xl overflow-hidden">
              {discoveredPages.map((page, i) => {
                const done = completedPageUrls.has(page.url) || isDone;
                const icon = PAGE_TYPE_ICONS[page.page_type] ?? "🔗";
                return (
                  <div key={page.url} className="flex items-center gap-3 px-4 py-3 transition-all" style={{ borderBottom: i < discoveredPages.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", background: done ? "rgba(34,197,94,0.03)" : "transparent" }}>
                    <span className="text-base shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-text text-xs font-semibold">{page.page_type}</p>
                      <p className="text-text-sub text-[11px] font-mono truncate">{page.url}</p>
                    </div>
                    <div className="shrink-0">
                      {done ? (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      ) : (
                        <div className="relative flex items-center justify-center w-5 h-5">
                          <span className="absolute w-3 h-3 rounded-full opacity-40 animate-pulse-ring" style={{ background: "#8b5cf6" }} />
                          <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: "#8b5cf6" }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Results ── */}
        {showResults && (
          <section className="animate-fade-in-up">
            <div className="flex items-center gap-3 mb-6">
              <p className="text-text-sub text-xs font-medium tracking-widest uppercase">Analysis Report</p>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>Ready</span>
            </div>

            {/* ── Section B: Page Selector ── */}
            {pageResults.length > 0 && (
              <div className="mb-5 overflow-x-auto">
                <div className="flex gap-2 pb-1" style={{ minWidth: "max-content" }}>
                  {/* Site Overview pill */}
                  <button
                    onClick={() => { setSelectedPageUrl(null); setActiveTab("overall"); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 whitespace-nowrap"
                    style={!selectedPageUrl ? { background: "rgba(139,92,246,0.18)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.35)", boxShadow: "0 0 10px rgba(139,92,246,0.15)" } : { background: "rgba(255,255,255,0.04)", color: "#7a8394", border: "1px solid rgba(255,255,255,0.08)" }}
                  >
                    🌐 Site Overview
                    {siteReport && <span className="ml-1 text-[10px] opacity-70">{siteReport.pages_analysed}p</span>}
                  </button>

                  {/* Per-page pills */}
                  {pageResults.map((pr) => {
                    const isSelected = selectedPageUrl === pr.url;
                    const icon = PAGE_TYPE_ICONS[pr.page_type] ?? "🔗";
                    return (
                      <button
                        key={pr.url}
                        onClick={() => { setSelectedPageUrl(pr.url); setActiveTab("overall"); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 whitespace-nowrap"
                        style={isSelected ? { background: "rgba(139,92,246,0.18)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.35)", boxShadow: "0 0 10px rgba(139,92,246,0.15)" } : { background: "rgba(255,255,255,0.04)", color: "#7a8394", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        {icon} {pr.page_type}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Section C: Per-page banner ── */}
            {selectedPage && (
              <div className="mb-5 px-4 py-3 rounded-xl flex items-center justify-between animate-fade-in" style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.18)" }}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xl shrink-0">{PAGE_TYPE_ICONS[selectedPage.page_type] ?? "🔗"}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold" style={{ color: "#c4b5fd" }}>Viewing: {selectedPage.page_type}</p>
                    <p className="text-[11px] font-mono truncate" style={{ color: "rgba(196,181,253,0.6)" }}>{selectedPage.url}</p>
                  </div>
                </div>
                <button onClick={() => { setSelectedPageUrl(null); setActiveTab("overall"); }} className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors" style={{ color: "#a78bfa", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                  Site Overview
                </button>
              </div>
            )}

            {/* Report tabs */}
            <ReportTabContent
              activeTab={activeTab}
              scores={scores}
              checks={checks}
              summaries={summaries}
              actions={actions}
              uiReport={uiReport}
              uxReport={uxReport}
              complianceReport={complianceReport}
              seoReport={seoReport}
            />
          </section>
        )}

        {!showResults && !error && (
          <div className="animate-fade-in text-center py-12">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full glass-card">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
              <span className="text-text-sub text-sm">Agents working in parallel...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
