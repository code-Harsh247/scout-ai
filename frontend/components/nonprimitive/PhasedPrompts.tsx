"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhasePrompt {
  phase:       number;
  title:       string;
  issue_count: number;
  prompt:      string;
}

interface Props {
  phases: PhasePrompt[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<number, { ring: string; badge: string; dot: string }> = {
  1: { ring: "border-red-500/30",    badge: "bg-red-500/15 text-red-300",    dot: "#ef4444" },
  2: { ring: "border-orange-500/30", badge: "bg-orange-500/15 text-orange-300", dot: "#f97316" },
  3: { ring: "border-amber-500/30",  badge: "bg-amber-500/15 text-amber-300", dot: "#f59e0b" },
  4: { ring: "border-yellow-500/30", badge: "bg-yellow-500/15 text-yellow-300", dot: "#eab308" },
  5: { ring: "border-blue-500/30",   badge: "bg-blue-500/15 text-blue-300",   dot: "#3b82f6" },
  6: { ring: "border-purple-500/30", badge: "bg-purple-500/15 text-purple-300", dot: "#8b5cf6" },
};

function getColors(phase: number) {
  return PHASE_COLORS[phase] ?? PHASE_COLORS[6];
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-200"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Phase card
// ---------------------------------------------------------------------------

function PhaseCard({ phase }: { phase: PhasePrompt }) {
  const [open, setOpen]       = useState(false);
  const [copied, setCopied]   = useState(false);
  const colors                = getColors(phase.phase);

  function handleCopy() {
    navigator.clipboard.writeText(phase.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([phase.prompt], { type: "text/markdown;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `phase-${phase.phase}-${phase.title.toLowerCase().replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className={`rounded-xl border bg-zinc-900/50 overflow-hidden transition-colors ${colors.ring} ${open ? "" : "hover:bg-zinc-900/70"}`}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Phase dot */}
        <span
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ background: `${colors.dot}20`, color: colors.dot, border: `1px solid ${colors.dot}40` }}
        >
          {phase.phase}
        </span>

        {/* Title */}
        <span className="flex-1 text-sm font-medium text-zinc-100">
          Phase {phase.phase} — {phase.title}
        </span>

        {/* Issue count badge */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors.badge}`}>
          {phase.issue_count} issue{phase.issue_count !== 1 ? "s" : ""}
        </span>

        <span className="shrink-0 text-zinc-500">
          <ChevronIcon open={open} />
        </span>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-white/5">
          {/* Prompt text */}
          <pre
            className="px-4 py-4 text-xs leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap overflow-x-auto"
            style={{ background: "rgba(0,0,0,0.3)" }}
          >
            {phase.prompt}
          </pre>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/5">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <DownloadIcon />
              Download
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={
                copied
                  ? { background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }
                  : { background: `${colors.dot}18`, color: colors.dot, border: `1px solid ${colors.dot}30` }
              }
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy Prompt"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PhasedPrompts({ phases }: Props) {
  const [allOpen, setAllOpen] = useState(false);

  if (!phases || phases.length === 0) return null;

  const totalIssues = phases.reduce((sum, p) => sum + p.issue_count, 0);

  return (
    <section className="px-6 pb-16">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex items-center gap-2">
          {/* Sparkle / wand icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" />
            <path d="M17.8 11.8 19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2 19 5" />
            <path d="m3 21 9-9" /><path d="M12.2 6.2 11 5" />
          </svg>
          <h2 className="text-sm font-semibold text-zinc-200">AI Fix Roadmap</h2>
        </div>

        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}>
          {phases.length} phases · {totalIssues} issues
        </span>

        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

        <button
          type="button"
          onClick={() => setAllOpen((v) => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {/* Description */}
      <p className="mb-5 text-xs text-zinc-500 leading-relaxed max-w-2xl">
        Copy each prompt phase-by-phase into your AI coding agent (Cursor, Copilot, etc.).
        Work through them in order — each phase focuses on one domain so your agent stays on task.
      </p>

      {/* Phase cards */}
      <div className="space-y-2.5">
        {phases.map((phase) => (
          <ExpandablePhaseCard key={phase.phase} phase={phase} forceOpen={allOpen} />
        ))}
      </div>
    </section>
  );
}

// Wrapper that respects forceOpen without lifting state into every card
function ExpandablePhaseCard({ phase, forceOpen }: { phase: PhasePrompt; forceOpen: boolean }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceOpen || localOpen;
  const [copied, setCopied]       = useState(false);
  const colors                    = getColors(phase.phase);

  function handleCopy() {
    navigator.clipboard.writeText(phase.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const blob = new Blob([phase.prompt], { type: "text/markdown;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `phase-${phase.phase}-${phase.title.toLowerCase().replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`rounded-xl border bg-zinc-900/50 overflow-hidden transition-colors ${colors.ring} ${open ? "" : "hover:bg-zinc-900/70"}`}>
      <button
        type="button"
        onClick={() => setLocalOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ background: `${colors.dot}20`, color: colors.dot, border: `1px solid ${colors.dot}40` }}
        >
          {phase.phase}
        </span>
        <span className="flex-1 text-sm font-medium text-zinc-100">
          Phase {phase.phase} — {phase.title}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors.badge}`}>
          {phase.issue_count} issue{phase.issue_count !== 1 ? "s" : ""}
        </span>
        <span className="shrink-0 text-zinc-500">
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="border-t border-white/5">
          <pre
            className="px-4 py-4 text-xs leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap overflow-x-auto"
            style={{ background: "rgba(0,0,0,0.3)" }}
          >
            {phase.prompt}
          </pre>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/5">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <DownloadIcon />
              Download
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={
                copied
                  ? { background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }
                  : { background: `${colors.dot}18`, color: colors.dot, border: `1px solid ${colors.dot}30` }
              }
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy Prompt"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
