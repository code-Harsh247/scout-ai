"use client";

import Link from "next/link";
import type { AuditStatus, PageAuditResult } from "@/hooks/useSiteAuditStream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractScore(
  report: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!report) return null;
  const v = report[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? null : n; }
  return null;
}

function scoreBg(n: number): string {
  if (n >= 7.5) return "bg-emerald-500/15 text-emerald-300";
  if (n >= 5)   return "bg-amber-500/15 text-amber-300";
  return "bg-red-500/15 text-red-300";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreCell({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null)
    return <span className="text-zinc-600">—</span>;
  const n   = invert ? 10 - value : value;
  const cls = scoreBg(n);
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {value.toFixed(1)}
    </span>
  );
}

function SkeletonCell() {
  return <div className="mx-auto h-5 w-8 animate-pulse rounded bg-zinc-800" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  pageAudits:  Map<string, PageAuditResult>;
  auditStatus: AuditStatus;
}

export default function SiteAuditResults({ pageAudits, auditStatus }: Props) {
  const entries   = [...pageAudits.values()].sort((a, b) => a.index - b.index);
  const completed = entries.filter((e) => e.status === "complete").length;
  const total     = entries.length;

  return (
    <section className="px-6 pb-12">
      {/* ── Section header ── */}
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-zinc-200">Audit Results</h2>
        {auditStatus === "running" && (
          <span className="text-xs text-zinc-500">{completed} / {total} complete</span>
        )}
        {auditStatus === "complete" && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
            All done
          </span>
        )}
        {auditStatus === "failed" && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
            Some errors
          </span>
        )}
      </div>

      {/* ── Waiting state: audit started but no rows yet ── */}
      {entries.length === 0 && auditStatus === "running" && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/10 bg-zinc-900/40 py-16">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <p className="text-sm text-zinc-500">Starting audit…</p>
        </div>
      )}

      {/* ── Table ── */}
      {entries.length > 0 && (
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-zinc-900/80">
              <th className="w-10 py-2.5 pl-4 pr-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">#</th>
              <th className="py-2.5 pr-4 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Page</th>
              <th className="w-16 py-2.5 pr-4 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">UI</th>
              <th className="w-16 py-2.5 pr-4 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">UX</th>
              <th className="w-16 py-2.5 pr-4 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">SEO</th>
              <th className="w-16 py-2.5 pr-4 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">Risk</th>
              <th className="w-28 py-2.5 pr-4 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.map((page) => {
              const path = (() => {
                try { return new URL(page.url).pathname || "/"; } catch { return page.url; }
              })();

              const isAuditing = page.status === "auditing";
              const isDone     = page.status === "complete";
              const isError    = page.status === "error";
              const isPending  = page.status === "pending";

              const uiScore   = extractScore(page.uiReport,         "overall_score");
              const uxScore   = extractScore(page.uxReport,         "overall_score");
              const seoScore  = extractScore(page.seoReport,        "overall_score");
              const riskScore = extractScore(page.complianceReport, "overall_risk_score");

              const rowBg =
                isError    ? "bg-red-500/5 hover:bg-red-500/8" :
                isAuditing ? "bg-indigo-500/5 hover:bg-indigo-500/8" :
                "hover:bg-white/[0.03]";

              return (
                <tr key={page.url} className={`transition-colors ${rowBg}`}>
                  {/* Index */}
                  <td className="py-3 pl-4 pr-2 align-middle text-xs tabular-nums text-zinc-600">
                    {page.index}
                  </td>

                  {/* Path */}
                  <td className="py-3 pr-4 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-300 truncate max-w-xs" title={page.url}>
                        {path}
                      </span>
                      {isError && page.error && (
                        <span className="truncate text-xs text-red-400 max-w-52" title={page.error}>
                          — {page.error}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Score cells */}
                  <td className="py-3 pr-4 text-center align-middle">
                    {isDone ? <ScoreCell value={uiScore} /> : (isPending ? null : <SkeletonCell />)}
                  </td>
                  <td className="py-3 pr-4 text-center align-middle">
                    {isDone ? <ScoreCell value={uxScore} /> : (isPending ? null : <SkeletonCell />)}
                  </td>
                  <td className="py-3 pr-4 text-center align-middle">
                    {isDone ? <ScoreCell value={seoScore} /> : (isPending ? null : <SkeletonCell />)}
                  </td>
                  <td className="py-3 pr-4 text-center align-middle">
                    {isDone ? <ScoreCell value={riskScore} invert /> : (isPending ? null : <SkeletonCell />)}
                  </td>

                  {/* Status */}
                  <td className="py-3 pr-4 text-right align-middle">
                    {isPending && (
                      <span className="text-xs text-zinc-600">Queued</span>
                    )}
                    {isAuditing && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-indigo-400">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                        Auditing
                      </span>
                    )}
                    {isDone && (
                      <Link
                        href={`/analysis?url=${encodeURIComponent(page.url)}`}
                        className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-indigo-400"
                        onClick={() => {
                          try {
                            sessionStorage.setItem(
                              `scout_audit_v1_${page.url}`,
                              JSON.stringify({
                                uiReport:         page.uiReport,
                                uxReport:         page.uxReport,
                                seoReport:        page.seoReport,
                                complianceReport: page.complianceReport,
                              }),
                            );
                          } catch { /* sessionStorage quota — ignore */ }
                        }}
                      >
                        <span className="text-emerald-500">✓</span> View
                      </Link>
                    )}
                    {isError && (
                      <span className="text-xs text-red-500">✗ Error</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
