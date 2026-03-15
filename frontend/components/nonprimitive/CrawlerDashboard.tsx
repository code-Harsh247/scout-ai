"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCrawlStream } from "@/hooks/useCrawlStream";
import CrawlStatsBar from "@/components/nonprimitive/CrawlStatsBar";
import LiveScreenshotPanel from "@/components/nonprimitive/LiveScreenshotPanel";
import CrawlLiveFeed from "@/components/nonprimitive/CrawlLiveFeed";

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

  // url of the node the user clicked in the graph — pins the screenshot panel
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

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
    error,
    stop,
  } = useCrawlStream(targetUrl);

  const running = crawlStatus === "running";

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-white overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Link href="/" className="hover:text-white transition-colors">
            Scout AI
          </Link>
          <span>/</span>
          <span className="max-w-120 truncate text-white">{targetUrl}</span>
        </div>

        <div className="flex items-center gap-3">
          {running && (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Stop
            </button>
          )}
          {(crawlStatus === "complete" || crawlStatus === "stopped") && sessionId && (
            <Link
              href={`/analysis/site?session_id=${sessionId}`}
              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors"
            >
              Audit All Representative Pages →
            </Link>
          )}
        </div>
      </header>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        <CrawlStatsBar status={crawlStatus} stats={stats} />
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="mx-6 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 gap-4 overflow-hidden px-6 pb-6">

        {/* Left — force-directed node graph */}
        <div className="flex-1 overflow-hidden">
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
          <div className="flex-1 overflow-hidden">
            <CrawlLiveFeed liveFeed={liveFeed} brokenLinks={brokenLinks} />
          </div>
        </div>

      </div>
    </div>
  );
}

