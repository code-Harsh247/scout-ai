"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  useAuditStream,
  type ComplianceReport,
  type SeoReport,
  type UiReport,
  type UxReport,
} from "@/hooks/useAuditStream";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import PhasedPrompts from "@/components/nonprimitive/PhasedPrompts";

/** Pre-loaded reports â€” passed in lieu of SSE (read-only mode). */
export interface PreloadedReports {
  uiReport:         UiReport         | null;
  uxReport:         UxReport         | null;
  complianceReport: ComplianceReport | null;
  seoReport:        SeoReport        | null;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 7.5) return "#22c55e";
  if (score >= 5)   return "#f59e0b";
  return "#ef4444";
}

function riskColor(risk: number): string {
  if (risk <= 3) return "#22c55e";
  if (risk <= 6) return "#f59e0b";
  return "#ef4444";
}

function scoreBg(score: number): string {
  if (score >= 7.5) return "bg-emerald-500/15 text-emerald-300";
  if (score >= 5)   return "bg-amber-500/15 text-amber-300";
  return "bg-red-500/15 text-red-300";
}

function riskBg(risk: number): string {
  if (risk <= 3) return "bg-emerald-500/15 text-emerald-300";
  if (risk <= 6) return "bg-amber-500/15 text-amber-300";
  return "bg-red-500/15 text-red-300";
}

function riskLabelColor(level: string): string {
  const l = level.toLowerCase();
  if (l === "low")    return "text-emerald-400";
  if (l === "medium") return "text-amber-400";
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Primitive sub-components
// ---------------------------------------------------------------------------

function ScorePill({ score }: { score: number }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold tabular-nums ${scoreBg(score)}`}>
      {score.toFixed(1)}<span className="font-normal opacity-60"> / 10</span>
    </span>
  );
}

function RiskPill({ risk }: { risk: number }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold tabular-nums ${riskBg(risk)}`}>
      Risk {risk.toFixed(1)}<span className="font-normal opacity-60"> / 10</span>
    </span>
  );
}

function SubScoreRow({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-xs text-zinc-400 capitalize">{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${(score / 10) * 100}%`, background: color, boxShadow: `0 0 6px ${color}55` }}
        />
      </div>
      <span className="w-6 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function SeoFactorRow({ label, status, note }: { label: string; status: string; note: string }) {
  const s     = status.toLowerCase();
  const color = s === "pass" ? "#22c55e" : s === "warn" ? "#f59e0b" : "#ef4444";
  const bg    = s === "pass" ? "bg-emerald-500/10" : s === "warn" ? "bg-amber-500/10" : "bg-red-500/10";
  const badge = s === "pass" ? "PASS" : s === "warn" ? "WARN" : "FAIL";
  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
      <span className={`shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${bg}`} style={{ color }}>
        {badge}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-200 capitalize">{label.replace(/_/g, " ")}</p>
        {note && <p className="mt-0.5 text-[11px] text-zinc-500">{note}</p>}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-white/8 bg-zinc-900/50 p-5 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 rounded bg-white/8" />
        <div className="h-5 w-20 rounded bg-white/8" />
      </div>
      <div className="space-y-2.5 pt-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-28 rounded bg-white/6" />
            <div className="flex-1 h-1.5 rounded-full bg-white/5" />
            <div className="h-3 w-5 rounded bg-white/6" />
          </div>
        ))}
      </div>
      <div className="space-y-2 pt-2 border-t border-white/5">
        {[80, 65, 90].map((w) => (
          <div key={w} className="h-3 rounded bg-white/5" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score summary bar
// ---------------------------------------------------------------------------

function AuditScoreSummaryBar({
  uiReport, uxReport, seoReport, complianceReport,
}: {
  uiReport: UiReport | null;
  uxReport: UxReport | null;
  seoReport: SeoReport | null;
  complianceReport: ComplianceReport | null;
}) {
  const items = [
    { label: "UI",         score: uiReport?.overall_score ?? null,              isRisk: false },
    { label: "UX",         score: uxReport?.overall_score ?? null,              isRisk: false },
    { label: "SEO",        score: seoReport?.overall_score ?? null,             isRisk: false },
    { label: "Compliance", score: complianceReport?.overall_risk_score ?? null, isRisk: true  },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      {items.map(({ label, score, isRisk }) => {
        const color = score === null ? "#3f3f46" : isRisk ? riskColor(score) : scoreColor(score);
        const pct   = score === null ? 0 : isRisk ? ((10 - score) / 10) * 100 : (score / 10) * 100;
        return (
          <div key={label} className="rounded-xl border border-white/8 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-zinc-400">{label}</span>
              {score !== null ? (
                <span className="text-xs font-bold tabular-nums" style={{ color }}>
                  {isRisk ? `Risk ${score.toFixed(1)}` : score.toFixed(1)}
                  <span className="text-zinc-600"> / 10</span>
                </span>
              ) : (
                <span className="text-xs text-zinc-600">â€”</span>
              )}
            </div>
            <div className="h-1.5 rounded-full overflow-hidden bg-white/5">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}55` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Priority recommendations
// ---------------------------------------------------------------------------

type Priority = "Critical" | "High" | "Medium";

interface Recommendation {
  priority: Priority;
  agent: string;
  text: string;
}

const PRIORITY_COLOR: Record<Priority, string> = {
  Critical: "#ef4444",
  High:     "#f59e0b",
  Medium:   "#8b5cf6",
};

const AGENT_COLOR: Record<string, string> = {
  UI:         "#8b5cf6",
  UX:         "#3b82f6",
  SEO:        "#f59e0b",
  Compliance: "#ef4444",
};

function PriorityRecommendations({ items }: { items: Recommendation[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/8 bg-zinc-900/50 p-5 mb-8">
      <h2 className="mb-4 text-sm font-semibold text-zinc-200">Priority Recommendations</h2>
      <div className="space-y-2">
        {items.map((item, i) => {
          const pc = PRIORITY_COLOR[item.priority];
          const ac = AGENT_COLOR[item.agent] ?? "#a1a1aa";
          return (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
              style={{ background: `${pc}0a`, border: `1px solid ${pc}1a` }}
            >
              <span
                className="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: `${pc}18`, color: pc }}
              >
                {item.priority}
              </span>
              <span
                className="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: `${ac}12`, color: ac }}
              >
                {item.agent}
              </span>
              <p className="text-sm leading-snug text-zinc-300">{item.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent panels
// ---------------------------------------------------------------------------

function FindingsBlock({ items }: { items: { label: string; findings: string }[] }) {
  const visible = items.filter((c) => c.findings);
  if (visible.length === 0) return null;
  return (
    <div className="space-y-3 pt-3 border-t border-white/5">
      {visible.map((c) => (
        <div key={c.label}>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{c.label}</p>
          <p className="text-xs leading-relaxed text-zinc-400">{c.findings}</p>
        </div>
      ))}
    </div>
  );
}

function UIAgentPanel({ report }: { report: UiReport }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SubScoreRow label="Layout & Spacing" score={report.layout_spacing.score} />
        <SubScoreRow label="Responsiveness"   score={report.responsiveness.score} />
        <SubScoreRow label="Typography"       score={report.typography.score} />
        <SubScoreRow label="Color Coherence"  score={report.color_coherence.score} />
      </div>
      <FindingsBlock items={[
        { label: "Layout & Spacing", findings: report.layout_spacing.findings },
        { label: "Responsiveness",   findings: report.responsiveness.findings },
        { label: "Typography",       findings: report.typography.findings },
        { label: "Color Coherence",  findings: report.color_coherence.findings },
      ]} />
    </div>
  );
}

function UXAgentPanel({ report }: { report: UxReport }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SubScoreRow label="Accessibility"   score={report.accessibility.score} />
        <SubScoreRow label="UX Friction"     score={report.ux_friction.score} />
        <SubScoreRow label="Navigation & IA" score={report.navigation_ia.score} />
        <SubScoreRow label="Inclusivity"     score={report.inclusivity.score} />
      </div>
      <FindingsBlock items={[
        { label: "Accessibility",   findings: report.accessibility.findings },
        { label: "UX Friction",     findings: report.ux_friction.findings },
        { label: "Navigation & IA", findings: report.navigation_ia.findings },
        { label: "Inclusivity",     findings: report.inclusivity.findings },
      ]} />
    </div>
  );
}

function SEOAgentPanel({ report }: { report: SeoReport }) {
  const factors = Object.entries(report.universal_factors ?? {});
  const missingEntities = report.competitor_gap?.missing_crucial_entities ?? [];
  return (
    <div className="space-y-4">
      {factors.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Universal Factors</p>
          <div className="divide-y divide-white/5">
            {factors.map(([key, val]) => (
              <SeoFactorRow key={key} label={key} status={val.status} note={val.note} />
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3 pt-1 border-t border-white/5">
        {report.intent_alignment?.explanation && (
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Intent Alignment</p>
            <p className="text-xs leading-relaxed text-zinc-400">{report.intent_alignment.explanation}</p>
          </div>
        )}
        {missingEntities.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Missing Entities</p>
            <div className="flex flex-wrap gap-1.5">
              {missingEntities.map((e) => (
                <span key={e} className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">{e}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ComplianceAgentPanel({ report }: { report: ComplianceReport }) {
  const categories = [
    { label: "Data Privacy",             level: report.data_privacy.risk_level,             findings: report.data_privacy.findings },
    { label: "Legal Transparency",       level: report.legal_transparency.risk_level,       findings: report.legal_transparency.findings },
    { label: "Accessibility Compliance", level: report.accessibility_compliance.risk_level, findings: report.accessibility_compliance.findings },
  ];
  const violations = report.critical_violations ?? [];
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat.label}>
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-xs font-medium text-zinc-300">{cat.label}</p>
              <span className={`text-[11px] font-semibold ${riskLabelColor(cat.level)}`}>
                {cat.level}
              </span>
            </div>
            {cat.findings && <p className="text-[11px] leading-relaxed text-zinc-500">{cat.findings}</p>}
          </div>
        ))}
      </div>
      {violations.length > 0 && (
        <div className="pt-1 border-t border-white/5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-500">Critical Violations</p>
          <ul className="space-y-1.5">
            {violations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-red-500" />
                {v}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AnalysisDashboard({ reports }: { reports?: PreloadedReports }) {
  const params    = useSearchParams();
  const targetUrl = params.get("url") || "";

  const { accessToken } = useSupabaseSession();

  const streamUrl = reports ? "" : (targetUrl || "your-website.com");
  const {
    uiReport:         streamedUi,
    uxReport:         streamedUx,
    complianceReport: streamedCompliance,
    seoReport:        streamedSeo,
    screenshotUrl: streamedScreenshot,
    isDone:           streamedDone,
    error,
    phasedPrompts,
  } = useAuditStream(streamUrl, accessToken);

  const uiReport         = reports?.uiReport         ?? streamedUi;
  const uxReport         = reports?.uxReport         ?? streamedUx;
  const complianceReport = reports?.complianceReport ?? streamedCompliance;
  const seoReport        = reports?.seoReport        ?? streamedSeo;
  const screenshotUrl = streamedScreenshot;
  const isDone      = !!reports || streamedDone;
  const showResults = isDone || !!(uiReport && uxReport && complianceReport && seoReport);

  type TabId = "ui" | "ux" | "seo" | "compliance";
  const [activeTab, setActiveTab] = useState<TabId>("ui");

  const tabs: { id: TabId; label: string; score: number | null; isRisk: boolean }[] = [
    { id: "ui",         label: "UI",         score: uiReport?.overall_score ?? null,              isRisk: false },
    { id: "ux",         label: "UX",         score: uxReport?.overall_score ?? null,              isRisk: false },
    { id: "seo",        label: "SEO",        score: seoReport?.overall_score ?? null,             isRisk: false },
    { id: "compliance", label: "Compliance", score: complianceReport?.overall_risk_score ?? null, isRisk: true  },
  ];

  const recommendations = useMemo<Recommendation[]>(() => {
    const items: Recommendation[] = [];
    complianceReport?.critical_violations?.forEach((v) =>
      items.push({ priority: "Critical", agent: "Compliance", text: v }),
    );
    uiReport?.recommendations?.forEach((r)  => items.push({ priority: "High",   agent: "UI",  text: r }));
    uxReport?.recommendations?.forEach((r)  => items.push({ priority: "High",   agent: "UX",  text: r }));
    seoReport?.recommendations?.forEach((r) => items.push({ priority: "Medium", agent: "SEO", text: r }));
    return items.slice(0, 10);
  }, [uiReport, uxReport, complianceReport, seoReport]);

  return (
    <div className="min-h-screen bg-grid relative overflow-x-hidden">
      {/* bg glow */}
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-200 h-75 rounded-full opacity-10"
        style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(60px)" }}
      />

      {/* Sticky header */}
      <header className="sticky top-0 z-50 border-b border-white/8 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Back
            </button>
            <span className="text-zinc-600">/</span>
            <span className="truncate rounded-md border border-white/8 bg-white/5 px-2.5 py-0.5 font-mono text-xs text-zinc-300">
              {targetUrl.length > 52 ? `${targetUrl.slice(0, 52)}â€¦` : targetUrl}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm font-semibold text-zinc-200">Audit Report</span>
            {showResults ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                Ready
              </span>
            ) : (
              <span className="rounded-full border border-indigo-500/20 bg-indigo-500/15 px-2.5 py-0.5 text-xs font-medium text-indigo-400">
                Processingâ€¦
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3">
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-400">Audit failed</p>
              <p className="mt-0.5 text-xs text-red-400/60">{error}</p>
            </div>
          </div>
        )}

        {/* Page screenshot preview */}
        {screenshotUrl && (
          <div className="mb-5 overflow-hidden rounded-xl border border-white/8">
            <div className="flex items-center justify-between border-b border-white/8 bg-zinc-900/60 px-4 py-2">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Page Preview</span>
              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate max-w-xs font-mono text-[11px] text-zinc-400 transition-colors hover:text-indigo-400"
              >
                {targetUrl}
              </a>
            </div>
            <div className="w-full bg-zinc-950" style={{ maxHeight: "520px", overflowY: "auto" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotUrl}
                alt={`Screenshot of ${targetUrl}`}
                className="w-full object-top"
              />
            </div>
          </div>
        )}

        {/* Score summary bar — always visible, fills in as agents complete */}
        <AuditScoreSummaryBar
          uiReport={uiReport}
          uxReport={uxReport}
          seoReport={seoReport}
          complianceReport={complianceReport}
        />

        {/* Priority recommendations */}
        {showResults && recommendations.length > 0 && (
          <PriorityRecommendations items={recommendations} />
        )}

        {/* Agent report tabs */}
        <div className="rounded-xl border border-white/8 bg-zinc-900/50 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-white/8">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const color    = tab.score === null ? "#71717a" : tab.isRisk ? riskColor(tab.score) : scoreColor(tab.score);
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-1 flex-col items-center gap-0.5 px-4 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? "bg-white/4 text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/2"
                  }`}
                  style={isActive ? { borderBottomColor: color } : {}}
                >
                  <span>{tab.label}</span>
                  {tab.score !== null ? (
                    <span className="tabular-nums text-[10px] font-bold" style={{ color }}>
                      {tab.isRisk ? `Risk ${tab.score.toFixed(1)}` : tab.score.toFixed(1)}
                    </span>
                  ) : (
                    <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-700" />
                  )}
                </button>
              );
            })}
          </div>

            <div key={activeTab} className="animate-fade-in">
              {activeTab === "overall" ? (
                <div className="grid lg:grid-cols-3 gap-5">
                  <div className="glass-card rounded-xl p-6 flex flex-col items-center justify-center">
                    <CircularGauge score={scores.overall} />
                    <div className="mt-4 w-full space-y-2.5">
                      {(["ui", "ux", "compliance", "seo"] as AgentId[]).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-text-sub text-xs w-24 capitalize">{k}</span>
                          <ScoreBar score={scores[k]} color={SCORE_COLORS[k]} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-2 space-y-4">
                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-3 flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                        </svg>
                        Executive Summary
                      </h3>
                      <p className="text-text-sub text-sm leading-relaxed">{summaries.overall}</p>
                    </div>

                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-4">Priority Actions</h3>
                      <div className="space-y-3">
                        {actions.length === 0 && <p className="text-text-sub text-sm">No recommendations yet.</p>}
                        {actions.map((action, i) => {
                          const priorityColor = action.priority === "Critical" ? "#ef4444" : action.priority === "High" ? "#f59e0b" : "#8b5cf6";
                          return (
                            <div key={`${action.text}-${i}`} className="flex gap-3 items-start p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                              <span className="shrink-0 w-6 h-6 rounded-full bg-black/40 text-xs font-bold flex items-center justify-center" style={{ color: priorityColor, border: `1px solid ${priorityColor}40` }}>
                                {i + 1}
                              </span>
                              <div>
                                <span className="text-xs font-semibold mr-2" style={{ color: priorityColor }}>{action.priority}</span>
                                <span className="text-text-sub text-sm">{action.text}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid lg:grid-cols-3 gap-5">
                  <div className="glass-card rounded-xl p-6 flex flex-col items-center justify-center gap-4">
                    <div>
                      <p className="text-text-sub text-xs text-center mb-2 capitalize">{activeTab} Score</p>
                      <div className="relative flex items-center justify-center">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
                          <circle
                            cx="60"
                            cy="60"
                            r="50"
                            fill="none"
                            stroke={SCORE_COLORS[activeTab as AgentId]}
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray="314.16"
                            strokeDashoffset={314.16 * (1 - scores[activeTab] / 100)}
                            transform="rotate(-90 60 60)"
                            style={{ filter: `drop-shadow(0 0 6px ${SCORE_COLORS[activeTab as AgentId]})`, transition: "stroke-dashoffset 1.2s ease-out" }}
                          />
                          <text x="60" y="55" textAnchor="middle" fill="#f0f2f5" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">
                            {scores[activeTab]}
                          </text>
                          <text x="60" y="70" textAnchor="middle" fill="#7a8394" fontSize="9" fontFamily="var(--font-display)">
                            /100
                          </text>
                        </svg>
                      </div>
                    </div>

                    {activeTab === "compliance" && complianceReport && (
                      <p className="text-xs text-text-sub">Risk score: {complianceReport.overall_risk_score}/10 (lower is better)</p>
                    )}

                    <div className="w-full space-y-1.5">
                      {(checks[activeTab as AgentId] || []).map((c) => (
                        <div key={c.label} className="flex items-center gap-2">
                          <span className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center" style={{ background: c.pass ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                            {c.pass ? (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            )}
                          </span>
                          <span className="text-text-sub text-xs truncate capitalize">{c.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-2 space-y-4">
                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-3 flex items-center gap-2 capitalize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SCORE_COLORS[activeTab as AgentId]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {activeTab} Insights
                      </h3>
                      <p className="text-text-sub text-sm leading-relaxed">{summaries[activeTab as AgentId]}</p>
                    </div>

                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-4">Detailed Checks</h3>
                      <div className="space-y-2">
                        {(checks[activeTab as AgentId] || []).map((check, i) => (
                          <div
                            key={`${check.label}-${i}`}
                            className="flex items-start gap-3 p-3 rounded-lg transition-colors"
                            style={{ background: check.pass ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.05)", border: `1px solid ${check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.12)"}` }}
                          >
                            <span className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center" style={{ background: check.pass ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                              {check.pass ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              )}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-text text-sm font-medium capitalize">{check.label}</p>
                              {check.note && <p className="text-[11px] mt-0.5" style={{ color: check.pass ? "#22c55e99" : "#ef444499" }}>{check.note}</p>}
                            </div>
                            <span
                              className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: check.pass ? "#22c55e" : "#ef4444" }}
                            >
                              {check.pass ? "PASS" : "FAIL"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {!showResults && (
          <section className="animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <p className="text-text-sub text-xs font-medium tracking-widest uppercase">Analysis Report</p>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span
                className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}
              >
                Processing…
              </span>
            </div>

            {/* Skeleton cards */}
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="glass-card rounded-xl p-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-35 h-35 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }} />
                  <div className="w-full space-y-3">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div
                            className="h-full rounded-full animate-shimmer"
                            style={{
                              width: "60%",
                              backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%)",
                              backgroundSize: "200% 100%",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2 space-y-4">
                {[0, 1].map((i) => (
                  <div key={i} className="glass-card rounded-xl p-6">
                    <div className="h-4 w-32 mb-4 rounded" style={{ background: "rgba(255,255,255,0.06)" }} />
                    <div className="space-y-3">
                      {[0, 1, 2].map((j) => (
                        <div key={j} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <div
                            className="h-3 rounded animate-shimmer"
                            style={{
                              width: `${60 + j * 15}%`,
                              backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%)",
                              backgroundSize: "200% 100%",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

