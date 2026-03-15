"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import NewProjectModal from "@/components/nonprimitive/NewProjectModal";

interface AuditSession {
  audit_session_id:  string;
  crawl_session_id:  string | null;
  root_url:          string;
  status:            string;
  overall_score:     number | null;
  started_at:        string;
  completed_at:      string | null;
  page_count:        number;
}

function buildCrawlHref(a: AuditSession): string {
  const base = `/crawl?url=${encodeURIComponent(a.root_url)}`;
  if (a.crawl_session_id) return `${base}&session=${a.crawl_session_id}`;
  return base;
}

function scoreColor(score: number | null): string {
  if (score === null) return "#7a8394";
  const s = score * 10;
  if (s >= 75) return "#22c55e";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    complete: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
    running:  { bg: "rgba(139,92,246,0.1)", text: "#a78bfa", border: "rgba(139,92,246,0.2)" },
    failed:   { bg: "rgba(239,68,68,0.1)", text: "#ef4444", border: "rgba(239,68,68,0.2)" },
  };
  const s = styles[status] ?? { bg: "rgba(255,255,255,0.06)", text: "#7a8394", border: "rgba(255,255,255,0.1)" };
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Card-level dropdown menu                                           */
/* ------------------------------------------------------------------ */
function CardMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded-md hover:bg-white/10 transition-colors text-text-sub hover:text-text"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-50 w-40 rounded-lg py-1 shadow-xl animate-fade-in"
          style={{ background: "rgba(24,24,30,0.98)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onDelete(); }}
            className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Delete project
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Delete confirmation modal                                          */
/* ------------------------------------------------------------------ */
function DeleteModal({
  audit,
  onConfirm,
  onCancel,
}: {
  audit: AuditSession;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const domain = (() => { try { return new URL(audit.root_url).hostname; } catch { return audit.root_url; } })();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative z-10 w-full max-w-md mx-4 glass-card-hi rounded-2xl p-6 animate-fade-in-up"
        style={{ boxShadow: "0 0 80px rgba(239,68,68,0.08), 0 25px 50px rgba(0,0,0,0.6)" }}
      >
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl" style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.5), transparent)" }} />
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </div>
          <div>
            <h2 className="text-text text-lg font-semibold">Delete project</h2>
            <p className="text-text-sub text-sm">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-text-sub text-sm mb-6">
          Are you sure you want to delete <span className="text-text font-medium">{domain}</span> and all associated crawl &amp; audit data?
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-text-sub hover:text-text hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors"
            style={{ background: "rgba(239,68,68,0.8)", border: "1px solid rgba(239,68,68,0.4)" }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Dashboard page                                                      */
/* ================================================================== */

export default function DashboardPage() {
  const router               = useRouter();
  const { session, loading, accessToken } = useSupabaseSession();

  const [audits,     setAudits]     = useState<AuditSession[]>([]);
  const [fetching,   setFetching]   = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [deleting,   setDeleting]   = useState<AuditSession | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/login?redirect=/dashboard"); return; }

    const supabase = createClient();
    supabase
      .from("user_audit_history")
      .select("*")
      .eq("user_id", session.user.id)
      .order("started_at", { ascending: false })
      .limit(50)
      .then((res) => {
        setFetching(false);
        if (res.error) { setFetchError(res.error.message); return; }
        setAudits((res.data as AuditSession[]) ?? []);
      });
  }, [loading, session, router]);

  const { signOut } = useSupabaseSession();

  async function handleDelete(audit: AuditSession) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000"}/audit/session/${audit.audit_session_id}`, {
        method: "DELETE",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setAudits((prev) => prev.filter((a) => a.audit_session_id !== audit.audit_session_id));
    } catch (err) {
      alert(`Failed to delete project: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="min-h-screen bg-grid">
      {/* Purple glow */}
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-200 h-64 rounded-full opacity-10"
        style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter: "blur(80px)" }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4 pt-10 pb-24">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between animate-fade-in">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/" className="text-text-sub text-sm hover:text-text transition-colors">Scout AI</Link>
              <span className="text-text-sub/40">/</span>
              <span className="text-text text-sm font-medium">Dashboard</span>
            </div>
            <h1 className="text-2xl font-bold text-text">Projects</h1>
          </div>

          <div className="flex items-center gap-3">
            {session?.user.email && (
              <span className="hidden sm:block text-xs text-text-sub truncate max-w-48">
                {session.user.email}
              </span>
            )}
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New project
            </button>
            <button
              type="button"
              onClick={() => signOut().then(() => router.push("/login"))}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-text-sub hover:text-text hover:bg-white/10 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Content */}
        {loading || fetching ? (
          /* Skeleton card grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass-card rounded-xl p-5">
                <div className="h-4 w-36 rounded mb-3" style={{ background: "rgba(255,255,255,0.06)" }} />
                <div className="h-3 w-24 rounded mb-5" style={{ background: "rgba(255,255,255,0.04)" }} />
                <div className="h-5 w-20 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }} />
              </div>
            ))}
          </div>
        ) : fetchError ? (
          <div className="glass-card rounded-2xl p-8 text-center animate-fade-in">
            <p className="text-red-400 text-sm mb-2 font-medium">Failed to load projects</p>
            <p className="text-text-sub text-xs">{fetchError}</p>
            <p className="mt-4 text-text-sub text-xs">This may mean the database hasn&apos;t been set up yet. Run the Phase 3 SQL migration in Supabase to enable history.</p>
          </div>
        ) : audits.length === 0 ? (
          <div className="glass-card rounded-2xl p-16 text-center animate-fade-in">
            <div
              className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <h2 className="mb-2 text-lg font-semibold text-text">No projects yet</h2>
            <p className="mb-6 text-text-sub text-sm max-w-sm mx-auto">
              Start your first project to see results here.
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 transition-colors"
            >
              Start a new project
            </button>
          </div>
        ) : (
          /* ---- Card grid ---- */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
            {audits.map((a) => {
              const domain = (() => { try { return new URL(a.root_url).hostname; } catch { return a.root_url; } })();
              const score  = a.overall_score !== null ? Math.round(a.overall_score * 10) : null;
              const color  = scoreColor(a.overall_score);

              return (
                <Link
                  key={a.audit_session_id}
                  href={buildCrawlHref(a)}
                  className="glass-card rounded-xl p-5 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.035] group relative"
                >
                  {/* Top row: title + menu */}
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="text-text font-semibold text-[15px] truncate pr-4">{domain}</h3>
                    <CardMenu onDelete={() => setDeleting(a)} />
                  </div>

                  {/* URL */}
                  <p className="text-text-sub text-xs truncate mb-4">{a.root_url}</p>

                  {/* Badge row */}
                  <div className="flex items-center gap-2 mb-4">
                    <StatusBadge status={a.status} />
                    {a.page_count > 0 && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#7a8394", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        {a.page_count} {a.page_count === 1 ? "page" : "pages"}
                      </span>
                    )}
                  </div>

                  {/* Bottom row: score + date */}
                  <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    {score !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                        <span className="text-sm font-bold tabular-nums" style={{ color }}>{score}</span>
                        <span className="text-text-sub text-[10px]">/ 100</span>
                      </div>
                    ) : (
                      <span className="text-text-sub text-xs">No score</span>
                    )}
                    <span className="text-text-sub text-[11px]">{formatDate(a.completed_at ?? a.started_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {deleting && (
        <DeleteModal
          audit={deleting}
          onConfirm={() => handleDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
