"use client";

import { useState } from "react";
import { CrawledPage, TemplatePattern } from "@/hooks/useCrawlStream";

interface CrawlSiteTreeProps {
  pages: Map<string, CrawledPage>;
  templatePatterns: TemplatePattern[];
}

// ─── status dot helpers ────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  visited:    "bg-emerald-400",
  skipped:    "bg-zinc-500",
  visiting:   "bg-violet-400 animate-pulse",
  discovered: "bg-amber-400",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? "bg-zinc-600"}`}
    />
  );
}

// ─── single page row ───────────────────────────────────────────────────────

function PageRow({ page }: { page: CrawledPage }) {
  const [open, setOpen] = useState(false);
  const label = (() => {
    try {
      return new URL(page.url).pathname || "/";
    } catch {
      return page.url;
    }
  })();

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5 focus:outline-none"
      >
        <StatusDot status={page.status} />
        <span className="min-w-0 flex-1 truncate text-zinc-300">{label}</span>
        {page.brokenLinksFound > 0 && (
          <span className="ml-1 shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
            {page.brokenLinksFound} broken
          </span>
        )}
        <span className="shrink-0 text-zinc-600">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="ml-6 mt-1 mb-2 space-y-1 rounded-md border border-white/5 bg-white/3 p-3 text-xs text-zinc-400">
          <Detail label="URL"          value={page.url} />
          {page.statusCode            && <Detail label="HTTP"         value={String(page.statusCode)} />}
          {page.urlPattern            && <Detail label="Template"     value={page.urlPattern} />}
          <Detail label="Depth"        value={String(page.depth)} />
          <Detail label="Links found"  value={String(page.linksFound)} />
          {page.skipReason            && <Detail label="Skip reason"  value={page.skipReason} />}
        </div>
      )}
    </li>
  );
}

// ─── template group row ────────────────────────────────────────────────────

function TemplateGroup({
  template,
  pages,
}: {
  template: TemplatePattern;
  pages: CrawledPage[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5 focus:outline-none"
      >
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-violet-300">
          {template.pattern}
        </span>
        <span className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-xs font-medium text-violet-300">
          ~{template.estimatedTotal} pages
        </span>
        <span className="shrink-0 text-zinc-600">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <ul className="ml-6 mt-1 mb-2 space-y-0.5">
          {pages.map((p) => (
            <PageRow key={p.url} page={p} />
          ))}
          {pages.length === 0 && (
            <li className="px-2 py-1 text-xs text-zinc-600">No samples visited yet</li>
          )}
        </ul>
      )}
    </li>
  );
}

// ─── main component ────────────────────────────────────────────────────────

export default function CrawlSiteTree({ pages, templatePatterns }: CrawlSiteTreeProps) {
  const allPages = Array.from(pages.values());

  // Pages that belong to a template pattern
  const templateUrls = new Set<string>();
  const templatePageMap = new Map<string, CrawledPage[]>();
  for (const tp of templatePatterns) {
    const members = allPages.filter(
      (p) => p.urlPattern === tp.pattern,
    );
    members.forEach((p) => templateUrls.add(p.url));
    templatePageMap.set(tp.pattern, members);
  }

  // Unique (non-template) pages
  const uniquePages = allPages.filter((p) => !templateUrls.has(p.url));

  const totalPage = allPages.length;

  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/5">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-white">
          Site Tree
          <span className="ml-2 text-zinc-500 font-normal">{totalPage} pages</span>
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {/* Unique pages */}
          {uniquePages.map((p) => (
            <PageRow key={p.url} page={p} />
          ))}

          {/* Template groups */}
          {templatePatterns.map((tp) => (
            <TemplateGroup
              key={tp.pattern}
              template={tp}
              pages={templatePageMap.get(tp.pattern) ?? []}
            />
          ))}
        </ul>

        {totalPage === 0 && (
          <p className="mt-4 text-center text-xs text-zinc-600">
            Waiting for pages to be discovered…
          </p>
        )}
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-zinc-600">{label}</span>
      <span className="min-w-0 break-all text-zinc-300">{value}</span>
    </div>
  );
}
