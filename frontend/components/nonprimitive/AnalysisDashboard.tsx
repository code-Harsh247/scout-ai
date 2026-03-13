"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAuditStream,
  type ComplianceReport,
  type SeoReport,
  type UiReport,
  type UxReport,
} from "@/hooks/useAuditStream";

type AgentId = "ui" | "ux" | "compliance" | "seo";
type TabId = "overall" | AgentId;
type AgentStatus = "processing" | "complete";

type AgentState = {
  progress: number;
  status: AgentStatus;
  line: string;
};

type Check = { label: string; pass: boolean; note?: string };

const AGENTS: { id: AgentId; name: string; color: string; glow: string }[] = [
  { id: "ui", name: "UI Agent", color: "#8b5cf6", glow: "rgba(139,92,246,0.25)" },
  { id: "ux", name: "UX Agent", color: "#3b82f6", glow: "rgba(59,130,246,0.25)" },
  { id: "compliance", name: "Compliance Agent", color: "#ef4444", glow: "rgba(239,68,68,0.25)" },
  { id: "seo", name: "SEO Agent", color: "#f59e0b", glow: "rgba(245,158,11,0.25)" },
];

const AGENT_MESSAGES: Record<AgentId, string[]> = {
  ui: [
    "Scanning visual hierarchy...",
    "Analyzing spacing consistency...",
    "Evaluating typography clarity...",
    "Checking color coherence...",
  ],
  ux: [
    "Simulating user journeys...",
    "Detecting interaction friction...",
    "Assessing navigation & IA...",
    "Reviewing accessibility affordances...",
  ],
  compliance: [
    "Checking GDPR/CCPA signals...",
    "Evaluating legal transparency...",
    "Auditing accessibility compliance...",
    "Identifying critical violations...",
  ],
  seo: [
    "Validating metadata...",
    "Checking crawlability delta...",
    "Scoring intent alignment...",
    "Finding content quality issues...",
  ],
};

const SCORE_COLORS: Record<AgentId, string> = {
  ui: "#8b5cf6",
  ux: "#3b82f6",
  compliance: "#ef4444",
  seo: "#f59e0b",
};

function AgentIcon({ id }: { id: AgentId }) {
  if (id === "ui") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    );
  }
  if (id === "ux") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7" />
        <path d="M3 6l4-4 4 4M3 18l4 4 4-4" strokeOpacity="0.4" />
      </svg>
    );
  }
  if (id === "compliance") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CircularGauge({ score }: { score: number }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 80 ? "#22c55e" : score >= 65 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, opacity: 0.3, transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        <text x="60" y="55" textAnchor="middle" fill="#f0f2f5" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">
          {score}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="#7a8394" fontSize="9" fontFamily="var(--font-display)">
          /100
        </text>
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
      <span className="text-xs font-semibold text-text w-7 text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

function scoreFromRisk(overallRiskScore: number): number {
  return Math.max(0, Math.min(100, 100 - overallRiskScore * 10));
}

function mapRiskToPass(riskLevel: string): boolean {
  return riskLevel.toLowerCase() === "low";
}

function seoFactorToPass(status: string): boolean {
  return status.toLowerCase() === "pass";
}

function buildUiChecks(report: UiReport | null): Check[] {
  if (!report) return [];
  return [
    { label: "Layout & spacing", pass: report.layout_spacing.score >= 6, note: report.layout_spacing.findings },
    { label: "Responsiveness", pass: report.responsiveness.score >= 6, note: report.responsiveness.findings },
    { label: "Typography", pass: report.typography.score >= 6, note: report.typography.findings },
    { label: "Color coherence", pass: report.color_coherence.score >= 6, note: report.color_coherence.findings },
  ];
}

function buildUxChecks(report: UxReport | null): Check[] {
  if (!report) return [];
  return [
    { label: "Accessibility", pass: report.accessibility.score >= 6, note: report.accessibility.findings },
    { label: "UX friction", pass: report.ux_friction.score >= 6, note: report.ux_friction.findings },
    { label: "Navigation & IA", pass: report.navigation_ia.score >= 6, note: report.navigation_ia.findings },
    { label: "Inclusivity", pass: report.inclusivity.score >= 6, note: report.inclusivity.findings },
  ];
}

function buildComplianceChecks(report: ComplianceReport | null): Check[] {
  if (!report) return [];
  return [
    {
      label: `Data privacy (${report.data_privacy.risk_level})`,
      pass: mapRiskToPass(report.data_privacy.risk_level),
      note: report.data_privacy.findings,
    },
    {
      label: `Legal transparency (${report.legal_transparency.risk_level})`,
      pass: mapRiskToPass(report.legal_transparency.risk_level),
      note: report.legal_transparency.findings,
    },
    {
      label: `Accessibility compliance (${report.accessibility_compliance.risk_level})`,
      pass: mapRiskToPass(report.accessibility_compliance.risk_level),
      note: report.accessibility_compliance.findings,
    },
  ];
}

function buildSeoChecks(report: SeoReport | null): Check[] {
  if (!report) return [];
  return Object.entries(report.universal_factors).map(([key, value]) => ({
    label: key.replace(/_/g, " "),
    pass: seoFactorToPass(value.status),
    note: value.note,
  }));
}

export default function AnalysisDashboard() {
  const params = useSearchParams();
  const targetUrl = params.get("url") || "your-website.com";

  const { uiReport, uxReport, complianceReport, seoReport, isDone, error } = useAuditStream(targetUrl);

  const [agentStates, setAgentStates] = useState<Record<AgentId, AgentState>>(() => ({
    ui: { progress: 0, status: "processing", line: AGENT_MESSAGES.ui[0] },
    ux: { progress: 0, status: "processing", line: AGENT_MESSAGES.ux[0] },
    compliance: { progress: 0, status: "processing", line: AGENT_MESSAGES.compliance[0] },
    seo: { progress: 0, status: "processing", line: AGENT_MESSAGES.seo[0] },
  }));
  const [activeTab, setActiveTab] = useState<TabId>("overall");

  const intervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const hasAllReports = !!(uiReport && uxReport && complianceReport && seoReport);
  const showResults = isDone || hasAllReports;

  const scores = useMemo<Record<TabId, number>>(() => {
    const uiScore = uiReport ? uiReport.overall_score * 10 : 0;
    const uxScore = uxReport ? uxReport.overall_score * 10 : 0;
    const complianceScore = complianceReport ? scoreFromRisk(complianceReport.overall_risk_score) : 0;
    const seoScore = seoReport ? seoReport.overall_score * 10 : 0;
    const available = [uiScore, uxScore, complianceScore, seoScore].filter((x) => x > 0);
    const overall = available.length ? Math.round(available.reduce((a, b) => a + b, 0) / available.length) : 0;

    return {
      overall,
      ui: uiScore,
      ux: uxScore,
      compliance: complianceScore,
      seo: seoScore,
    };
  }, [uiReport, uxReport, complianceReport, seoReport]);

  const checks = useMemo<Record<AgentId, Check[]>>(
    () => ({
      ui: buildUiChecks(uiReport),
      ux: buildUxChecks(uxReport),
      compliance: buildComplianceChecks(complianceReport),
      seo: buildSeoChecks(seoReport),
    }),
    [uiReport, uxReport, complianceReport, seoReport]
  );

  const summaries = useMemo<Record<AgentId | "overall", string>>(() => {
    const uiSummary = uiReport
      ? `Layout: ${uiReport.layout_spacing.findings} Responsiveness: ${uiReport.responsiveness.findings}`
      : "UI analysis pending.";
    const uxSummary = uxReport
      ? `Accessibility: ${uxReport.accessibility.findings} UX friction: ${uxReport.ux_friction.findings}`
      : "UX analysis pending.";
    const complianceSummary = complianceReport
      ? `Risk score ${complianceReport.overall_risk_score}/10. Data privacy: ${complianceReport.data_privacy.findings}`
      : "Compliance analysis pending.";
    const seoSummary = seoReport
      ? `SEO score ${seoReport.overall_score}/10. Intent alignment: ${seoReport.intent_alignment.explanation}`
      : "SEO analysis pending.";

    return {
      overall: `UI ${scores.ui}/100, UX ${scores.ux}/100, Compliance ${scores.compliance}/100, SEO ${scores.seo}/100. Focus first on the highest-risk compliance violations and failed SEO universal factors.`,
      ui: uiSummary,
      ux: uxSummary,
      compliance: complianceSummary,
      seo: seoSummary,
    };
  }, [uiReport, uxReport, complianceReport, seoReport, scores]);

  const actions = useMemo<{ priority: "Critical" | "High" | "Medium"; text: string }[]>(() => {
    const items: { priority: "Critical" | "High" | "Medium"; text: string }[] = [];

    if (complianceReport?.critical_violations?.length) {
      complianceReport.critical_violations.forEach((v) => items.push({ priority: "Critical", text: v }));
    }

    uiReport?.recommendations?.forEach((r) => items.push({ priority: "High", text: r }));
    uxReport?.recommendations?.forEach((r) => items.push({ priority: "High", text: r }));
    seoReport?.recommendations?.forEach((r) => items.push({ priority: "Medium", text: r }));

    return items.slice(0, 6);
  }, [uiReport, uxReport, complianceReport, seoReport]);

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
          const next = Math.min(92, prev[id].progress + 2);
          return { ...prev, [id]: { ...prev[id], progress: next } };
        });
      }, 450);
    });

    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    const doneMap: Record<AgentId, boolean> = {
      ui: !!uiReport,
      ux: !!uxReport,
      compliance: !!complianceReport,
      seo: !!seoReport,
    };

    AGENTS.forEach((agent) => {
      if (!doneMap[agent.id]) return;
      clearInterval(intervalsRef.current[`${agent.id}_msg`]);
      clearInterval(intervalsRef.current[`${agent.id}_progress`]);
      setAgentStates((prev) => ({
        ...prev,
        [agent.id]: { progress: 100, status: "complete", line: "Analysis complete." },
      }));
    });
  }, [uiReport, uxReport, complianceReport, seoReport]);

  const tabs: { id: TabId; label: string }[] = [
    { id: "overall", label: "Overall" },
    { id: "ui", label: "UI" },
    { id: "ux", label: "UX" },
    { id: "compliance", label: "Compliance" },
    { id: "seo", label: "SEO" },
  ];

  return (
    <div className="min-h-screen bg-grid relative overflow-x-hidden">
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-200 h-75 rounded-full opacity-15"
        style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(60px)" }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-10 pb-24">
        <div className="flex items-start justify-between mb-10 animate-fade-in">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-text-sub text-sm">Analyzing</span>
              <span
                className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium text-text"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {targetUrl.length > 40 ? `${targetUrl.slice(0, 40)}...` : targetUrl}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-text">AI Analysis Dashboard</h1>
          </div>
          <a href="/" className="text-text-sub text-sm hover:text-text transition-colors flex items-center gap-1.5 mt-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            New analysis
          </a>
        </div>

        {error && (
          <div
            className="mb-8 p-4 rounded-xl flex items-start gap-3 animate-fade-in"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <svg className="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#ef4444" }}>Audit failed</p>
              <p className="text-xs mt-0.5" style={{ color: "#ef444499" }}>{error}</p>
            </div>
          </div>
        )}

        <section className="mb-10">
          <p className="text-text-sub text-xs font-medium tracking-widest uppercase mb-4 animate-fade-in">
            Active Agents
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENTS.map((agent, i) => {
              const state = agentStates[agent.id];
              const agentDone = state.status === "complete";

              return (
                <div
                  key={agent.id}
                  className={`glass-card rounded-xl p-4 animate-fade-in-up delay-${(i + 1) * 100} transition-all duration-500 ${agentDone ? "opacity-80" : ""}`}
                  style={agentDone ? {} : { borderColor: `${agent.color}22` }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${agent.color}18`, color: agent.color }}>
                        <AgentIcon id={agent.id} />
                      </div>
                      <span className="text-text text-sm font-semibold">{agent.name}</span>
                    </div>
                    {agentDone ? (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    ) : (
                      <div className="relative flex items-center justify-center w-5 h-5">
                        <span className="absolute w-3 h-3 rounded-full opacity-40 animate-pulse-ring" style={{ background: agent.color }} />
                        <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: agent.color, boxShadow: `0 0 6px ${agent.color}` }} />
                      </div>
                    )}
                  </div>

                  <div className="h-1 rounded-full mb-3 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full rounded-full relative overflow-hidden transition-all duration-150"
                      style={{
                        width: `${state.progress}%`,
                        background: agentDone ? `linear-gradient(90deg, ${agent.color}aa, ${agent.color})` : `linear-gradient(90deg, ${agent.color}66, ${agent.color})`,
                        boxShadow: `0 0 8px ${agent.glow}`,
                      }}
                    >
                      {!agentDone && (
                        <span
                          className="absolute inset-0 opacity-50"
                          style={{
                            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                            animation: "progress-shimmer 1.5s ease-in-out infinite",
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="rounded-md px-2.5 py-1.5" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <p className="font-mono text-[10px] leading-relaxed truncate" style={{ color: agentDone ? "#22c55e" : agent.color }}>
                      <span style={{ opacity: 0.5 }}>$ </span>
                      {state.line}
                      {!agentDone && <span className="animate-terminal-cur">▋</span>}
                    </p>
                  </div>

                  <p className="text-right text-[10px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {state.progress}%
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {showResults && (
          <section className="animate-fade-in-up">
            <div className="flex items-center gap-3 mb-6">
              <p className="text-text-sub text-xs font-medium tracking-widest uppercase">Analysis Report</p>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span
                className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                Ready
              </span>
            </div>

            <div className="flex gap-1 p-1 rounded-lg mb-6 overflow-x-auto" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const score = scores[tab.id];
                const col = tab.id === "overall" ? "#8b5cf6" : SCORE_COLORS[tab.id as AgentId];

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap"
                    style={isActive ? { background: "rgba(255,255,255,0.09)", color: col, boxShadow: `0 0 12px ${col}22` } : { color: "#7a8394" }}
                  >
                    {tab.label}
                    {tab.id !== "overall" && (
                      <span className="text-[10px] font-mono font-semibold" style={{ color: isActive ? col : "rgba(255,255,255,0.2)" }}>
                        {score}
                      </span>
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
          <div className="animate-fade-in text-center py-12">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full glass-card">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <span className="text-text-sub text-sm">Agents working in parallel...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
