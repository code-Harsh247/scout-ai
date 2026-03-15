"use client";

import { CrawlStats, CrawlStatus } from "@/hooks/useCrawlStream";

interface CrawlStatsBarProps {
  status: CrawlStatus;
  stats: CrawlStats;
}

const STATUS_CONFIG: Record<CrawlStatus, { label: string; dotClass: string }> = {
  idle:     { label: "Idle",     dotClass: "bg-zinc-500" },
  running:  { label: "Running",  dotClass: "bg-emerald-400 animate-pulse" },
  complete: { label: "Complete", dotClass: "bg-emerald-500" },
  failed:   { label: "Failed",   dotClass: "bg-red-500" },
  stopped:  { label: "Stopped",  dotClass: "bg-amber-400" },
};

export default function CrawlStatsBar({ status, stats }: CrawlStatsBarProps) {
  const { label, dotClass } = STATUS_CONFIG[status];

  return (
    <div className="flex flex-wrap items-center gap-6 rounded-xl border border-white/10 bg-white/5 px-6 py-4 text-sm">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <span className="font-medium text-white">{label}</span>
      </div>

      <Divider />

      <Stat label="Visited"   value={stats.visited}   color="text-emerald-400" />
      <Stat label="Skipped"   value={stats.skipped}   color="text-zinc-400" />
      <Stat label="Broken"    value={stats.broken}    color="text-red-400" />
      <Stat label="Templates" value={stats.templates} color="text-violet-400" />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-5 w-px bg-white/10" />;
}
