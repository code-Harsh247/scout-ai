/**
 * CrawlNodeGraph — force-directed canvas graph showing the crawler's traversal.
 *
 * This file is intentionally NOT server-rendered; CrawlerDashboard wraps it
 * with next/dynamic { ssr: false } so react-force-graph-2d can safely use
 * window / canvas APIs.
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
// react-force-graph-2d ships its own types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForceGraph2D = require("react-force-graph-2d").default;

import type { CrawledPage, GraphLink } from "@/hooks/useCrawlStream";

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const C = {
  discovered:     "#52525b", // zinc-600
  visiting:       "#f59e0b", // amber-400
  visited:        "#10b981", // emerald-500
  visitedBroken:  "#f97316", // orange-500
  skipped:        "#8b5cf6", // violet-500
  templateRing:   "#a78bfa", // violet-400
  linkNormal:     "rgba(113,113,122,0.25)",
  linkBroken:     "rgba(239,68,68,0.65)",
} as const;

function nodeColor(node: Record<string, unknown>): string {
  if (node.status === "visited" && (node.brokenLinksFound as number) > 0)
    return C.visitedBroken;
  return C[node.status as keyof typeof C] as string ?? C.discovered;
}

// ---------------------------------------------------------------------------
// Graph data shape
// ---------------------------------------------------------------------------
interface GraphData {
  nodes: Record<string, unknown>[];
  links: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface CrawlNodeGraphProps {
  pages: Map<string, CrawledPage>;
  graphLinks: GraphLink[];
  activeUrl: string | null;
  onNodeClick: (url: string) => void;
}

// ---------------------------------------------------------------------------
// Legend items
// ---------------------------------------------------------------------------
const LEGEND = [
  { color: C.discovered,    label: "Discovered" },
  { color: C.visiting,      label: "Visiting" },
  { color: C.visited,       label: "Visited" },
  { color: C.visitedBroken, label: "Has broken links" },
  { color: C.skipped,       label: "Skipped (template)" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CrawlNodeGraph({
  pages,
  graphLinks,
  activeUrl,
  onNodeClick,
}: CrawlNodeGraphProps) {
  // The ForceGraph2D ref only exposes layout methods (zoomToFit, etc.)
  // NOT a graphData setter — data is passed as a controlled prop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // Keep activeUrl available inside stable canvas callbacks without re-creating them
  const activeUrlRef = useRef<string | null>(activeUrl);
  useEffect(() => { activeUrlRef.current = activeUrl; }, [activeUrl]);

  // Stable internal maps — same object references = positions preserved when
  // we spread them into a new graphData state object.
  const nodeMapRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const linkMapRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  // Controlled graphData prop — ForceGraph2D owns the simulation state inside.
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  // ── Container resize observer ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Sync pages + graphLinks → graphData state ──────────────────────────────
  useEffect(() => {
    let changed = false;

    // Nodes ──────────────────────────────────────────────────────────────────
    for (const [url, page] of pages) {
      const existing = nodeMapRef.current.get(url);
      if (existing) {
        // Mutate in-place: canvas picks up new colours on next animation frame.
        // No new array needed — ForceGraph2D already has the reference.
        existing.status            = page.status;
        existing.isTemplateRep     = page.isTemplateRepresentative;
        existing.brokenLinksFound  = page.brokenLinksFound;
      } else {
        let label = "/";
        try {
          const segs = new URL(url).pathname.replace(/\/$/, "").split("/").filter(Boolean);
          label = segs[segs.length - 1] || "/";
        } catch { /* ignore */ }
        const node: Record<string, unknown> = {
          id:               url,
          label,
          status:           page.status,
          depth:            page.depth,
          isTemplateRep:    page.isTemplateRepresentative,
          brokenLinksFound: page.brokenLinksFound,
        };
        nodeMapRef.current.set(url, node);
        changed = true;
      }
    }

    // Links ──────────────────────────────────────────────────────────────────
    for (const link of graphLinks) {
      const key = `${link.source}→${link.target}`;
      if (!linkMapRef.current.has(key)) {
        linkMapRef.current.set(key, {
          source:   link.source,
          target:   link.target,
          isBroken: link.isBroken,
        });
        changed = true;
      } else if (link.isBroken) {
        const existing = linkMapRef.current.get(key)!;
        if (!existing.isBroken) { existing.isBroken = true; }
      }
    }

    // Only trigger a re-render when topology actually changed (new nodes/links).
    // Status colour updates are handled by mutating existing objects above,
    // so the canvas re-draws them on the next animation frame automatically.
    if (changed) {
      setGraphData({
        nodes: [...nodeMapRef.current.values()],
        links: [...linkMapRef.current.values()],
      });
    }
  }, [pages, graphLinks]);

  // ── Custom node canvas renderer ─────────────────────────────────────────────
  const nodeCanvasObject = useCallback((
    node:        Record<string, unknown>,
    ctx:         CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const isActive = (node.id as string) === activeUrlRef.current;
    const radius   = Math.max(3, 7 - (node.depth as number) * 0.8);
    const color    = nodeColor(node);

    // Glow for active/visiting
    if (isActive || node.status === "visiting") {
      ctx.shadowBlur  = 18;
      ctx.shadowColor = C.visiting;
    } else {
      ctx.shadowBlur = 0;
    }

    ctx.beginPath();
    ctx.arc(node.x as number, node.y as number, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outer ring for template representative pages
    if (node.isTemplateRep) {
      ctx.beginPath();
      ctx.arc(node.x as number, node.y as number, radius + 2.5, 0, 2 * Math.PI);
      ctx.strokeStyle = C.templateRing;
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.stroke();
    }

    // Label — only visible when zoomed in enough
    if (globalScale > 1.8) {
      const label    = node.label as string;
      const fontSize = 9 / globalScale;
      ctx.font          = `${fontSize}px ui-monospace, monospace`;
      ctx.textAlign     = "center";
      ctx.textBaseline  = "top";
      ctx.fillStyle     = "rgba(255,255,255,0.65)";
      ctx.fillText(label, node.x as number, (node.y as number) + radius + 2 / globalScale);
    }
  }, []);

  // ── Custom link canvas renderer ────────────────────────────────────────────
  const linkCanvasObject = useCallback((
    link: Record<string, unknown>,
    ctx:  CanvasRenderingContext2D,
  ) => {
    const src = link.source as Record<string, number>;
    const tgt = link.target as Record<string, number>;
    if (!src?.x || !tgt?.x) return;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = link.isBroken ? C.linkBroken : C.linkNormal;
    ctx.lineWidth   = link.isBroken ? 1.2 : 0.6;
    ctx.stroke();
  }, []);

  const handleNodeClick = useCallback(
    (node: Record<string, unknown>) => onNodeClick(node.id as string),
    [onNodeClick],
  );

  const zoomToFit = useCallback(() => {
    graphRef.current?.zoomToFit(400, 40);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-xl overflow-hidden border border-white/10 bg-zinc-950"
    >
      {dims.w > 0 && (
        <ForceGraph2D
          ref={graphRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="#09090b"
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => "replace"}
          linkCanvasObject={linkCanvasObject}
          linkCanvasObjectMode={() => "replace"}
          onNodeClick={handleNodeClick}
          nodeLabel={(node: Record<string, unknown>) => node.id as string}
          cooldownTicks={120}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={() => "rgba(113,113,122,0.5)"}
        />
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-lg bg-zinc-900/90 px-3 py-2.5 backdrop-blur-sm border border-white/10">
        {LEGEND.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-zinc-400">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="h-2 w-2 rounded-full shrink-0 border border-violet-400" />
          <span className="text-xs text-zinc-400">Template rep.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="block h-px w-4 shrink-0" style={{ backgroundColor: C.linkBroken }} />
          <span className="text-xs text-zinc-400">Broken link</span>
        </div>
      </div>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        <span className="rounded-md bg-zinc-900/90 px-2.5 py-1 text-xs text-zinc-400 border border-white/10">
          {pages.size} pages
        </span>
        <button
          type="button"
          onClick={zoomToFit}
          title="Zoom to fit"
          className="rounded-md bg-zinc-900/90 px-2.5 py-1 text-xs text-zinc-400 border border-white/10 hover:text-white hover:border-white/30 transition-colors"
        >
          ⊡ fit
        </button>
      </div>
    </div>
  );
}

