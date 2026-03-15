"use client";

import { useEffect, useRef, useState } from "react";
import { BrokenLink, LiveFeedItem, LiveFeedEventType } from "@/hooks/useCrawlStream";

interface CrawlLiveFeedProps {
  liveFeed: LiveFeedItem[];
  brokenLinks: BrokenLink[];
}

// ─── Live Feed ─────────────────────────────────────────────────────────────

type FeedFilter = "all" | LiveFeedEventType;

const FILTER_OPTIONS: { value: FeedFilter; label: string }[] = [
  { value: "all",              label: "All" },
  { value: "page_visited",     label: "Visited" },
  { value: "page_skipped",     label: "Skipped" },
  { value: "broken_link",      label: "Broken" },
  { value: "template_detected",label: "Templates" },
];

const EVENT_STYLES: Record<LiveFeedEventType, { dot: string; text: string }> = {
  page_visiting:    { dot: "bg-violet-400", text: "text-violet-300" },
  page_visited:     { dot: "bg-emerald-400", text: "text-emerald-300" },
  page_skipped:     { dot: "bg-zinc-500",   text: "text-zinc-400" },
  broken_link:      { dot: "bg-red-400",    text: "text-red-300" },
  template_detected:{ dot: "bg-violet-500", text: "text-violet-300" },
  page_discovered:  { dot: "bg-amber-400",  text: "text-amber-300" },
};

function LiveFeedTab({ items }: { items: LiveFeedItem[] }) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll only when user has not scrolled up
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const filtered =
    filter === "all" ? items : items.filter((i) => i.type === filter);

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1 border-b border-white/10 p-2">
        {FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
              filter === value
                ? "bg-white/15 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scrolling list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 space-y-px overflow-y-auto p-2 font-mono text-xs"
      >
        {filtered.map((item) => {
          const style = EVENT_STYLES[item.type];
          const path = (() => {
            try { return new URL(item.url).pathname || item.url; } catch { return item.url; }
          })();
          return (
            <div key={item.id} className="flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-white/5">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
              <span className={`flex-1 truncate ${style.text}`}>{path}</span>
              {item.detail && (
                <span className="shrink-0 text-zinc-600">{item.detail}</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="mt-4 text-center text-zinc-600">No events yet</p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ─── Broken Links Table ────────────────────────────────────────────────────

function BrokenLinksTab({ links }: { links: BrokenLink[] }) {
  if (links.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
        No broken links found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-zinc-900">
          <tr className="border-b border-white/10 text-left text-zinc-500">
            <Th>URL</Th>
            <Th>From</Th>
            <Th>Status</Th>
            <Th>Type</Th>
          </tr>
        </thead>
        <tbody>
          {links.map((link, i) => (
            <tr
              key={i}
              className="border-b border-white/5 transition-colors hover:bg-white/5"
            >
              <Td className="max-w-50 break-all text-red-400">{link.url}</Td>
              <Td className="max-w-50 break-all text-zinc-400">{link.fromUrl}</Td>
              <Td className="tabular-nums text-red-300">{link.statusCode ?? "—"}</Td>
              <Td className="text-zinc-500">{link.errorType}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

// ─── Main component ────────────────────────────────────────────────────────

type Tab = "feed" | "broken";

export default function CrawlLiveFeed({ liveFeed, brokenLinks }: CrawlLiveFeedProps) {
  const [tab, setTab] = useState<Tab>("feed");

  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/5">
      {/* Tab bar */}
      <div className="flex border-b border-white/10">
        {(["feed", "broken"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-emerald-400 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "feed"
              ? `Live Feed (${liveFeed.length})`
              : `Broken Links (${brokenLinks.length})`}
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === "feed" ? (
          <LiveFeedTab items={liveFeed} />
        ) : (
          <BrokenLinksTab links={brokenLinks} />
        )}
      </div>
    </div>
  );
}
