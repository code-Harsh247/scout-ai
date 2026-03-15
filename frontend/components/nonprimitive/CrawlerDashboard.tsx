"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCrawlStream } from "@/hooks/useCrawlStream";
import { useSiteAuditStream } from "@/hooks/useSiteAuditStream";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import CrawlStatsBar from "@/components/nonprimitive/CrawlStatsBar";
import CrawlProgressBar from "@/components/nonprimitive/CrawlProgressBar";
import LiveScreenshotPanel from "@/components/nonprimitive/LiveScreenshotPanel";
import CrawlLiveFeed from "@/components/nonprimitive/CrawlLiveFeed";
import SiteAuditResults from "@/components/nonprimitive/SiteAuditResults";

// CrawlNodeGraph uses react-force-graph-2d which requires window/canvas — SSR off
const CrawlNodeGraph = dynamic(
  () => import("@/components/nonprimitive/CrawlNodeGraph"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 rounded-xl border border-white/10 bg-zinc-950 animate-pulse" />
    ),
  },
);

export default function CrawlerDashboard() {
  const params    = useSearchParams();
  const targetUrl = params.get("url") ?? "";
  const existingSessionId = params.get("session") ?? undefined;

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const { accessToken } = useSupabaseSession();

  // ── Phase 1: crawl ────────────────────────────────────────────────────────
  const {
    sessionId,
    crawlStatus,
    stats,
    pages,
    brokenLinks,
    liveFeed,
    screenshots,
    activeUrl,
    graphLinks,
    error: crawlError,
    stop,
  } = useCrawlStream(targetUrl, undefined, accessToken, existingSessionId);

  // All visited pages are candidates for audit (skipped/template-dup pages excluded)
  const urlsToAudit = useMemo(
    () => [...pages.values()].filter((p) => p.status === "visited").map((p) => p.url),
    [pages],
  );

  // ── Phase 2: audit (auto-starts when crawl is complete) ───────────────────
  const auditEnabled = crawlStatus === "complete" && urlsToAudit.length > 0;

  const {
    auditStatus,
    pageAudits,
    currentAuditUrl,
    auditProgress,
    auditError,
  } = useSiteAuditStream(urlsToAudit, sessionId, auditEnabled, accessToken, existingSessionId);

  const running = crawlStatus === "running";

  // Scroll to audit section as soon as the crawl finishes
  const auditSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (auditEnabled) {
      setTimeout(() => {
        auditSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [auditEnabled]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-white">

      {/* ── Sticky top bar: header + progress ─────────────────────────── */}
      <div className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-md">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <Link href="/" className="hover:text-white transition-colors">
              Scout AI
            </Link>
            <span>/</span>
            <span className="max-w-120 truncate text-white">{targetUrl}</span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              Dashboard
            </Link>
            {running && (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </header>

        {/* Progress bar — covers both crawl and audit phases */}
        <CrawlProgressBar
          crawlStatus={crawlStatus}
          auditStatus={auditStatus}
          crawlStats={stats}
          auditProgress={auditProgress}
          currentAuditUrl={currentAuditUrl}
          targetUrl={targetUrl}
        />
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-4 pb-3">
        <CrawlStatsBar status={crawlStatus} stats={stats} />
      </div>

      {/* ── Error banners ──────────────────────────────────────────────── */}
      {crawlError && (
        <div className="mx-6 mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <strong>Crawl error:</strong> {crawlError}
        </div>
      )}
      {auditError && (
        <div className="mx-6 mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <strong>Audit error:</strong> {auditError}
        </div>
      )}

      {/* ── Main panels (graph + right col) ────────────────────────────── */}
      {/* Fixed proportional height — audit results scroll below the fold  */}
      <div
        className="flex shrink-0 gap-4 px-6 pb-4"
        style={{ height: "calc(100svh - 220px)", minHeight: "22rem" }}
      >
        {/* Left — force-directed node graph */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <CrawlNodeGraph
            pages={pages}
            graphLinks={graphLinks}
            activeUrl={activeUrl}
            onNodeClick={setSelectedUrl}
          />
        </div>

        {/* Right — screenshot panel + live feed */}
        <div className="flex w-95 shrink-0 flex-col gap-3 overflow-hidden">
          <div className="shrink-0">
            <LiveScreenshotPanel
              screenshots={screenshots}
              activeUrl={activeUrl}
              pinnedUrl={selectedUrl}
              onClearPin={() => setSelectedUrl(null)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CrawlLiveFeed liveFeed={liveFeed} brokenLinks={brokenLinks} />
          </div>
        </div>
      </div>

      {/* ── Audit Results — appear below once audit starts ───────────── */}
      {auditEnabled && (
        <div ref={auditSectionRef} className="min-h-screen">
          <SiteAuditResults pageAudits={pageAudits} auditStatus={auditStatus} />
        </div>
      )}

    </div>
  );
}
