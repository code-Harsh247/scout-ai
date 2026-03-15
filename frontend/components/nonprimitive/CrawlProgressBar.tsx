"use client";

import type { CrawlStatus } from "@/hooks/useCrawlStream";
import type { AuditStatus } from "@/hooks/useSiteAuditStream";

interface Props {
  crawlStatus:    CrawlStatus;
  auditStatus:    AuditStatus;
  crawlStats:     { visited: number; broken: number };
  auditProgress:  { completed: number; total: number };
  currentAuditUrl: string | null;
  targetUrl:      string;
}

export default function CrawlProgressBar({
  crawlStatus,
  auditStatus,
  crawlStats,
  auditProgress,
  currentAuditUrl,
  targetUrl,
}: Props) {
  if (crawlStatus === "idle") return null;

  const domain = (() => {
    try { return new URL(targetUrl).hostname; } catch { return targetUrl; }
  })();

  const auditPath = currentAuditUrl
    ? (() => { try { return new URL(currentAuditUrl).pathname || "/"; } catch { return currentAuditUrl; } })()
    : null;

  // ── Derive display values ──────────────────────────────────────────────────
  const isCrawling  = crawlStatus === "running";
  const isStopped   = crawlStatus === "stopped";
  const crawlDone   = crawlStatus === "complete" || crawlStatus === "stopped";
  const isAuditing  = auditStatus === "running";
  const auditDone   = auditStatus === "complete";

  let phase       = "";
  let statusText  = "";
  let percent     = 0;
  let indeterminate = false;
  let isDone      = false;

  if (isCrawling) {
    phase        = "Crawling";
    statusText   = `${domain} — ${crawlStats.visited} page${crawlStats.visited !== 1 ? "s" : ""} found${crawlStats.broken > 0 ? `, ${crawlStats.broken} broken` : ""}`;
    indeterminate = true;
  } else if (isAuditing) {
    const { completed, total } = auditProgress;
    percent    = total > 0 ? Math.round((completed / total) * 100) : 0;
    phase      = "Auditing";
    statusText = auditPath
      ? `${auditPath} — ${completed} of ${total} pages`
      : `${completed} of ${total} pages`;
  } else if (auditDone) {
    percent    = 100;
    phase      = "Complete";
    statusText = `${domain} — crawled ${crawlStats.visited} pages, audited ${auditProgress.total}`;
    isDone     = true;
  } else if (isStopped) {
    percent    = 100;
    phase      = "Stopped";
    statusText = `${crawlStats.visited} pages visited`;
  } else if (crawlDone) {
    // crawl complete but audit is idle (either 0 pages or the brief transition frame)
    percent    = auditProgress.total > 0 ? 5 : 100;
    phase      = auditProgress.total > 0 ? "Preparing" : "Crawl complete";
    statusText = auditProgress.total > 0
      ? "Starting audit…"
      : `${crawlStats.visited} pages visited, ${crawlStats.broken} broken links`;
    indeterminate = auditProgress.total > 0;
  }

  const barColor  = isDone ? "bg-emerald-500" : isStopped ? "bg-zinc-500" : "bg-indigo-500";
  const dotColor  = isDone ? "bg-emerald-500" : isStopped ? "bg-zinc-500" : "bg-indigo-400";
  const dotPulse  = isCrawling || isAuditing;

  return (
    <div className="border-b border-white/10">
      {/* Progress track */}
      <div className="h-1 w-full overflow-hidden bg-zinc-800/80">
        {indeterminate ? (
          <div className="animate-shimmer h-full w-full bg-linear-to-r from-indigo-700 via-indigo-400 to-indigo-700 bg-size-[400%_100%]" />
        ) : (
          <div
            className={`h-full ${barColor} transition-all duration-700 ease-out`}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>

      {/* Status line */}
      <div className="flex items-center gap-2.5 px-6 py-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor} ${dotPulse ? "animate-pulse" : ""}`}
        />
        <p className="flex-1 truncate text-xs">
          <span className="font-semibold text-zinc-100">{phase}</span>
          {statusText && (
            <span className="ml-1.5 text-zinc-500">{statusText}</span>
          )}
        </p>
        {!indeterminate && percent > 0 && percent < 100 && (
          <span className="shrink-0 tabular-nums text-xs font-medium text-zinc-400">{percent}%</span>
        )}
      </div>
    </div>
  );
}
