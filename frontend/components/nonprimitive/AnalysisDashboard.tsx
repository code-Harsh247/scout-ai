"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";

/* ─── Types ─── */
type AgentStatus = "processing" | "complete";
type TabId = "overall" | "security" | "ui" | "ux" | "branding" | "vibe";

interface AgentState {
  progress: number;
  status: AgentStatus;
  line: string;
}

/* ─── Agent config ─── */
const AGENT_MESSAGES: Record<string, string[]> = {
  ui: [
    "Scanning visual hierarchy...",
    "Analyzing typography scale...",
    "Checking color contrast ratios...",
    "Evaluating component consistency...",
    "Measuring whitespace distribution...",
    "Auditing responsive breakpoints...",
  ],
  ux: [
    "Simulating user flow...",
    "Analyzing navigation depth...",
    "Measuring interaction friction...",
    "Evaluating loading states...",
    "Testing mobile affordances...",
    "Mapping conversion funnel...",
  ],
  security: [
    "Checking SSL/TLS certificates...",
    "Scanning HTTP security headers...",
    "Detecting exposed endpoints...",
    "Auditing content policy...",
    "Analyzing CORS configuration...",
    "Testing clickjacking protection...",
  ],
  vibe: [
    "Analyzing brand personality...",
    "Evaluating emotional resonance...",
    "Checking tone & voice alignment...",
    "Measuring visual impact...",
    "Assessing trend alignment...",
    "Computing overall vibe score...",
  ],
};

const AGENTS: { id: string; name: string; color: string; glow: string }[] = [
  { id: "ui",       name: "UI Agent",       color: "#8b5cf6", glow: "rgba(139,92,246,0.25)" },
  { id: "ux",       name: "UX Agent",       color: "#3b82f6", glow: "rgba(59,130,246,0.25)" },
  { id: "security", name: "Security Agent", color: "#22c55e", glow: "rgba(34,197,94,0.25)" },
  { id: "vibe",     name: "Vibe Agent",     color: "#ec4899", glow: "rgba(236,72,153,0.25)" },
];

const COMPLETE_TIMES: Record<string, number> = { ui: 4000, security: 5500, ux: 7000, vibe: 8500 };

/* ─── Mock results data ─── */
const SCORES: Record<TabId, number> = { overall: 74, security: 68, ui: 82, ux: 71, branding: 85, vibe: 79 };

type Check = { label: string; pass: boolean; note?: string };
const CHECKS: Record<string, Check[]> = {
  security: [
    { label: "SSL/TLS Certificate valid", pass: true },
    { label: "HTTPS enforced on all routes", pass: true },
    { label: "Content Security Policy header", pass: false, note: "Missing CSP — exposes XSS risk" },
    { label: "X-Frame-Options set", pass: true },
    { label: "HSTS enabled", pass: true },
    { label: "Secure & HttpOnly cookies", pass: true },
    { label: "X-XSS-Protection header", pass: false, note: "Not present on main domain" },
    { label: "Clickjacking protection", pass: false, note: "Consider adding frame-ancestors" },
  ],
  ui: [
    { label: "Visual hierarchy clear", pass: true },
    { label: "Typography scale consistent", pass: true },
    { label: "Color contrast (WCAG AA)", pass: true },
    { label: "Responsive across breakpoints", pass: true },
    { label: "Component design consistency", pass: false, note: "Inconsistent border-radius usage across CTAs" },
    { label: "Icon system unified", pass: true },
    { label: "Whitespace usage balanced", pass: true },
    { label: "Loading / skeleton states", pass: false, note: "No loading indicators found" },
  ],
  ux: [
    { label: "Navigation clarity", pass: true },
    { label: "Primary CTA visible on load", pass: true },
    { label: "Error states defined", pass: false, note: "No error handling UI found for form failures" },
    { label: "Onboarding / empty states", pass: false, note: "Empty states not designed" },
    { label: "Mobile gesture support", pass: true },
    { label: "Search functionality", pass: true },
    { label: "User feedback mechanisms", pass: false, note: "No toast / notification system detected" },
    { label: "Accessibility focus indicators", pass: true },
  ],
  branding: [
    { label: "Logo legibility", pass: true },
    { label: "Brand palette consistent", pass: true },
    { label: "Typography brand alignment", pass: true },
    { label: "Voice & tone consistency", pass: true },
    { label: "Visual style cohesion", pass: true },
    { label: "Unique brand personality", pass: false, note: "Brand feels generic — differentiation needed" },
    { label: "Social proof elements", pass: true },
    { label: "Trust signals present", pass: true },
  ],
  vibe: [
    { label: "Strong first impression", pass: true },
    { label: "Emotional resonance", pass: true },
    { label: "Premium / polished feel", pass: true },
    { label: "Modern aesthetics", pass: true },
    { label: "Energy & pacing", pass: true },
    { label: "Memorable experience", pass: false, note: "Nothing distinctly memorable about the product" },
    { label: "Cultural alignment", pass: true },
    { label: "Trend-forward design", pass: false, note: "Missing micro-interactions and animation layers" },
  ],
};

const ACTIONS = [
  { priority: "Critical", text: "Add a Content Security Policy (CSP) header to mitigate XSS attack vectors." },
  { priority: "High",     text: "Build comprehensive error state UI — form failures, empty states, and network errors." },
  { priority: "Medium",   text: "Develop a unique, memorable brand personality to stand out from competitors." },
];

const SUMMARIES: Record<TabId, string> = {
  overall: "Your site has solid foundational structure with strong branding and visual design, but has notable gaps in security configuration and UX edge-case handling. Addressing the critical CSP vulnerability and error state coverage would push your score into the 85+ range.",
  security: "Seven of eight security checks passed. The main risk is a missing Content Security Policy header, which leaves the site open to cross-site scripting injection. HSTS and SSL are properly configured.",
  ui: "The UI is well-crafted with clear hierarchy and strong contrast. The two failing areas—component inconsistency and missing loading states—are polish issues rather than critical flaws.",
  ux: "Navigation and core CTA placement score well. The biggest UX gaps are around error recovery and empty state design, both of which directly impact conversion and perceived quality.",
  branding: "One of the strongest dimensions. Brand cohesion and trust signals are excellent. Work on developing a more differentiated personality—what makes your brand unmistakably yours?",
  vibe: "The overall impression is professional and polished. Adding micro-interactions, subtle motion, and a signature animation style would make the site significantly more memorable.",
};

/* ─── Sub-components ─── */

function AgentIcon({ id }: { id: string }) {
  if (id === "ui") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
    </svg>
  );
  if (id === "ux") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
  if (id === "security") return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
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
        {/* track */}
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8"/>
        {/* glow layer */}
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, opacity: 0.3, transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        {/* progress arc */}
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        {/* center text */}
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

const SCORE_COLORS: Record<string, string> = { security: "#22c55e", ui: "#8b5cf6", ux: "#3b82f6", branding: "#f59e0b", vibe: "#ec4899" };

/* ─── Main component ─── */
export default function AnalysisDashboard() {
  const params = useSearchParams();
  const targetUrl = params.get("url") || "your-website.com";

  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>(() =>
    Object.fromEntries(
      AGENTS.map((a) => [a.id, { progress: 0, status: "processing" as AgentStatus, line: AGENT_MESSAGES[a.id][0] }])
    )
  );
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("overall");

  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Run progress bars & terminal messages per agent
    AGENTS.forEach((agent, agentIdx) => {
      const completeAt = COMPLETE_TIMES[agent.id];
      const messages = AGENT_MESSAGES[agent.id];
      let msgIdx = 0;

      // Cycle messages every ~1.4s
      const msgInterval = setInterval(() => {
        msgIdx = (msgIdx + 1) % messages.length;
        setAgentStates((prev) => ({
          ...prev,
          [agent.id]: { ...prev[agent.id], line: messages[msgIdx] },
        }));
      }, 1400);
      intervalsRef.current.push(msgInterval);

      // Progress bar animation
      const start = Date.now();
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - start;
        const raw = Math.min((elapsed / completeAt) * 100, 100);
        const eased = raw < 90 ? raw : 90 + (raw - 90) * 0.3;
        setAgentStates((prev) => ({ ...prev, [agent.id]: { ...prev[agent.id], progress: Math.round(eased) } }));
      }, 80);
      intervalsRef.current.push(progressInterval);

      // Complete agent
      const completeTimeout = setTimeout(() => {
        clearInterval(msgInterval);
        clearInterval(progressInterval);
        setAgentStates((prev) => ({
          ...prev,
          [agent.id]: { progress: 100, status: "complete", line: "Analysis complete." },
        }));
      }, completeAt);
      timeoutsRef.current.push(completeTimeout);
    });

    // Show results after last agent
    const showResultsTimeout = setTimeout(() => setShowResults(true), 9200);
    timeoutsRef.current.push(showResultsTimeout);

    return () => {
      intervalsRef.current.forEach(clearInterval);
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  const TABS: { id: TabId; label: string }[] = [
    { id: "overall",   label: "Overall" },
    { id: "security",  label: "Security" },
    { id: "ui",        label: "UI" },
    { id: "ux",        label: "UX" },
    { id: "branding",  label: "Branding" },
    { id: "vibe",      label: "Vibe" },
  ];

  return (
    <div className="min-h-screen bg-grid relative overflow-x-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-200 h-75 rounded-full opacity-15"
        style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(60px)" }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-start justify-between mb-10 animate-fade-in">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-text-sub text-sm">Analyzing</span>
              <span
                className="px-2.5 py-0.5 rounded-md text-xs font-mono font-medium text-text"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {targetUrl.length > 40 ? targetUrl.slice(0, 40) + "…" : targetUrl}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-text">AI Analysis Dashboard</h1>
          </div>
          <a
            href="/"
            className="text-text-sub text-sm hover:text-text transition-colors flex items-center gap-1.5 mt-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            New analysis
          </a>
        </div>

        {/* ── Agent Cards ── */}
        <section className="mb-10">
          <p className="text-text-sub text-xs font-medium tracking-widest uppercase mb-4 animate-fade-in">
            Active Agents
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENTS.map((agent, i) => {
              const state = agentStates[agent.id];
              const isDone = state.status === "complete";
              return (
                <div
                  key={agent.id}
                  className={`glass-card rounded-xl p-4 animate-fade-in-up delay-${(i + 1) * 100} transition-all duration-500 ${isDone ? "opacity-80" : ""}`}
                  style={isDone ? {} : { borderColor: `${agent.color}22` }}
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${agent.color}18`, color: agent.color }}>
                        <AgentIcon id={agent.id} />
                      </div>
                      <span className="text-text text-sm font-semibold">{agent.name}</span>
                    </div>
                    {/* Status dot */}
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                    ) : (
                      <div className="relative flex items-center justify-center w-5 h-5">
                        <span
                          className="absolute w-3 h-3 rounded-full opacity-40 animate-pulse-ring"
                          style={{ background: agent.color }}
                        />
                        <span
                          className="w-2 h-2 rounded-full animate-pulse-dot"
                          style={{ background: agent.color, boxShadow: `0 0 6px ${agent.color}` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="h-1 rounded-full mb-3 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full rounded-full relative overflow-hidden transition-all duration-150"
                      style={{
                        width: `${state.progress}%`,
                        background: isDone
                          ? `linear-gradient(90deg, ${agent.color}aa, ${agent.color})`
                          : `linear-gradient(90deg, ${agent.color}66, ${agent.color})`,
                        boxShadow: `0 0 8px ${agent.glow}`,
                      }}
                    >
                      {!isDone && (
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

                  {/* Terminal line */}
                  <div
                    className="rounded-md px-2.5 py-1.5"
                    style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <p className="font-mono text-[10px] leading-relaxed truncate" style={{ color: isDone ? "#22c55e" : agent.color }}>
                      <span style={{ opacity: 0.5 }}>$ </span>
                      {state.line}
                      {!isDone && <span className="animate-terminal-cur">▋</span>}
                    </p>
                  </div>

                  {/* Progress % */}
                  <p className="text-right text-[10px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                    {state.progress}%
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Results ── */}
        {showResults && (
          <section className="animate-fade-in-up">
            <div className="flex items-center gap-3 mb-6">
              <p className="text-text-sub text-xs font-medium tracking-widest uppercase">
                Analysis Report
              </p>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span
                className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                Ready
              </span>
            </div>

            {/* Tab nav */}
            <div
              className="flex gap-1 p-1 rounded-lg mb-6 overflow-x-auto"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const score = SCORES[tab.id];
                const col = tab.id === "overall" ? "#8b5cf6" : SCORE_COLORS[tab.id];
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap"
                    style={isActive ? {
                      background: "rgba(255,255,255,0.09)",
                      color: col,
                      boxShadow: `0 0 12px ${col}22`,
                    } : {
                      color: "#7a8394",
                    }}
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

            {/* Tab content */}
            <div key={activeTab} className="animate-fade-in">
              {activeTab === "overall" ? (
                <div className="grid lg:grid-cols-3 gap-5">
                  {/* Score gauge */}
                  <div className="glass-card rounded-xl p-6 flex flex-col items-center justify-center">
                    <CircularGauge score={SCORES.overall} />
                    <div className="mt-4 w-full space-y-2.5">
                      {(["security","ui","ux","branding","vibe"] as TabId[]).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                          <span className="text-text-sub text-xs w-16 capitalize">{k}</span>
                          <ScoreBar score={SCORES[k]} color={SCORE_COLORS[k]} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Summary + actions */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-3 flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                        </svg>
                        Executive Summary
                      </h3>
                      <p className="text-text-sub text-sm leading-relaxed">{SUMMARIES.overall}</p>
                    </div>

                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-4">Top 3 Action Items</h3>
                      <div className="space-y-3">
                        {ACTIONS.map((action, i) => {
                          const priorityColor = action.priority === "Critical" ? "#ef4444" : action.priority === "High" ? "#f59e0b" : "#8b5cf6";
                          return (
                            <div key={i} className="flex gap-3 items-start p-3 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
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
                /* Individual dimension tab */
                <div className="grid lg:grid-cols-3 gap-5">
                  {/* Score card */}
                  <div className="glass-card rounded-xl p-6 flex flex-col items-center justify-center gap-4">
                    <div>
                      <p className="text-text-sub text-xs text-center mb-2 capitalize">{activeTab} Score</p>
                      <div className="relative flex items-center justify-center">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8"/>
                          <circle
                            cx="60" cy="60" r="50" fill="none"
                            stroke={SCORE_COLORS[activeTab] || "#8b5cf6"}
                            strokeWidth="6" strokeLinecap="round"
                            strokeDasharray="314.16"
                            strokeDashoffset={314.16 * (1 - SCORES[activeTab] / 100)}
                            transform="rotate(-90 60 60)"
                            style={{ filter: `drop-shadow(0 0 6px ${SCORE_COLORS[activeTab] || "#8b5cf6"})`, transition: "stroke-dashoffset 1.2s ease-out" }}
                          />
                          <text x="60" y="55" textAnchor="middle" fill="#f0f2f5" fontSize="22" fontWeight="700" fontFamily="var(--font-display)">{SCORES[activeTab]}</text>
                          <text x="60" y="70" textAnchor="middle" fill="#7a8394" fontSize="9" fontFamily="var(--font-display)">/100</text>
                        </svg>
                      </div>
                    </div>
                    <div className="w-full space-y-1.5">
                      {(CHECKS[activeTab] || []).map((c) => (
                        <div key={c.label} className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center`} style={{ background: c.pass ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                            {c.pass
                              ? <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              : <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            }
                          </span>
                          <span className="text-text-sub text-xs truncate">{c.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Insights */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-3 flex items-center gap-2 capitalize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={SCORE_COLORS[activeTab] || "#8b5cf6"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        {activeTab} Insights
                      </h3>
                      <p className="text-text-sub text-sm leading-relaxed">{SUMMARIES[activeTab]}</p>
                    </div>

                    <div className="glass-card rounded-xl p-6">
                      <h3 className="text-text font-semibold mb-4">Detailed Checks</h3>
                      <div className="space-y-2">
                        {(CHECKS[activeTab] || []).map((check, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 p-3 rounded-lg transition-colors"
                            style={{ background: check.pass ? "rgba(34,197,94,0.04)" : "rgba(239,68,68,0.05)", border: `1px solid ${check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.12)"}` }}
                          >
                            <span className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center`} style={{ background: check.pass ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)" }}>
                              {check.pass
                                ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              }
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-text text-sm font-medium">{check.label}</p>
                              {!check.pass && check.note && (
                                <p className="text-[11px] mt-0.5" style={{ color: "#ef444499" }}>{check.note}</p>
                              )}
                            </div>
                            <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                              background: check.pass ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                              color: check.pass ? "#22c55e" : "#ef4444",
                            }}>
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

        {/* Processing indicator when results not ready */}
        {!showResults && (
          <div className="animate-fade-in text-center py-12">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full glass-card">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
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
