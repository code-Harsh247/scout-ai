"use client";

import { useMemo } from "react";

interface LiveScreenshotPanelProps {
  screenshots: Map<string, string>;
  activeUrl:   string | null;
  /** URL pinned by clicking a graph node — overrides live tracking */
  pinnedUrl:   string | null;
  onClearPin:  () => void;
}

export default function LiveScreenshotPanel({
  screenshots,
  activeUrl,
  pinnedUrl,
  onClearPin,
}: LiveScreenshotPanelProps) {
  const [displayUrl, displaySrc] = useMemo(() => {
    // Pinned node takes priority
    if (pinnedUrl && screenshots.has(pinnedUrl)) {
      return [pinnedUrl, screenshots.get(pinnedUrl)!] as const;
    }
    // Currently visiting
    if (activeUrl && screenshots.has(activeUrl)) {
      return [activeUrl, screenshots.get(activeUrl)!] as const;
    }
    // Fallback: most-recently-captured screenshot
    const entries = [...screenshots.entries()];
    if (entries.length > 0) {
      const [u, src] = entries[entries.length - 1];
      return [u, src] as const;
    }
    return [null, null] as const;
  }, [screenshots, activeUrl, pinnedUrl]);

  const isPinned = !!pinnedUrl && displayUrl === pinnedUrl;
  const isLive   = !isPinned && displayUrl === activeUrl;

  const pathLabel = displayUrl
    ? (() => {
        try { return new URL(displayUrl).pathname || "/"; }
        catch { return displayUrl; }
      })()
    : null;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
      {/* Fake browser chrome */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-950/80 px-3 py-2">
        {/* Traffic-light dots */}
        <div className="flex gap-1.5 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        </div>

        {/* URL bar */}
        <div className="flex flex-1 min-w-0 items-center rounded bg-zinc-800/70 px-2 py-0.5">
          <span className="text-xs font-mono text-zinc-400 truncate">
            {pathLabel ?? "—"}
          </span>
        </div>

        {/* Status badge */}
        {isLive && (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            LIVE
          </span>
        )}
        {isPinned && (
          <>
            <span className="shrink-0 text-xs text-violet-400">pinned</span>
            <button
              onClick={onClearPin}
              className="shrink-0 text-xs text-zinc-500 hover:text-white transition-colors px-1"
              title="Unpin — follow live view"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Screenshot */}
      {displaySrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displaySrc}
          alt="Page preview"
          className="block w-full"
          style={{ aspectRatio: "16/9", objectFit: "cover", objectPosition: "top" }}
        />
      ) : (
        <div
          className="flex items-center justify-center bg-zinc-950"
          style={{ aspectRatio: "16/9" }}
        >
          <p className="text-sm text-zinc-600">Waiting for first screenshot…</p>
        </div>
      )}
    </div>
  );
}
