"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageStatus = "discovered" | "visiting" | "visited" | "skipped";
export type CrawlStatus = "idle" | "running" | "complete" | "failed" | "stopped";

export interface CrawledPage {
  url: string;
  urlPattern: string | null;
  status: PageStatus;
  skipReason?: string;
  statusCode?: number | null;
  isTemplateRepresentative: boolean;
  depth: number;
  linksFound: number;
  brokenLinksFound: number;
}

export interface BrokenLink {
  url: string;
  fromUrl: string;
  fromPageTitle: string;
  statusCode: number | null;
  errorType: string;
}

export interface TemplatePattern {
  pattern: string;
  representativeUrl: string;
  estimatedTotal: number;
}

export interface CrawlStats {
  visited: number;
  skipped: number;
  broken: number;
  templates: number;
}

export type LiveFeedEventType =
  | "page_visiting"
  | "page_visited"
  | "page_skipped"
  | "broken_link"
  | "template_detected"
  | "page_discovered";

export interface LiveFeedItem {
  id: number;
  type: LiveFeedEventType;
  url: string;
  detail?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  isBroken: boolean;
}

export interface CrawlStreamResult {
  sessionId: string | null;
  crawlStatus: CrawlStatus;
  stats: CrawlStats;
  /** Keyed by normalized URL */
  pages: Map<string, CrawledPage>;
  brokenLinks: BrokenLink[];
  templatePatterns: TemplatePattern[];
  liveFeed: LiveFeedItem[];
  screenshots: Map<string, string>;
  activeUrl: string | null;
  graphLinks: GraphLink[];
  error: string | null;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_FEED_ITEMS = 500;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCrawlStream(
  targetUrl: string,
  options?: Record<string, unknown>,
  accessToken?: string | null,
  existingSessionId?: string,
): CrawlStreamResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus>("idle");
  const [stats, setStats] = useState<CrawlStats>({ visited: 0, skipped: 0, broken: 0, templates: 0 });
  const [pages, setPages] = useState<Map<string, CrawledPage>>(new Map());
  const [brokenLinks, setBrokenLinks] = useState<BrokenLink[]>([]);
  const [templatePatterns, setTemplatePatterns] = useState<TemplatePattern[]>([]);
  const [liveFeed, setLiveFeed] = useState<LiveFeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<Map<string, string>>(new Map());
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [graphLinks, setGraphLinks] = useState<GraphLink[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const feedIdRef = useRef(0);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setCrawlStatus("stopped");
  }, []);

  const pushFeed = useCallback((type: LiveFeedEventType, url: string, detail?: string) => {
    const item: LiveFeedItem = { id: feedIdRef.current++, type, url, detail };
    setLiveFeed((prev) => {
      const next = [...prev, item];
      return next.length > MAX_FEED_ITEMS ? next.slice(next.length - MAX_FEED_ITEMS) : next;
    });
  }, []);

  // Persist finished crawl so back-navigation can restore state without re-crawling.
  useEffect(() => {
    if (crawlStatus !== "complete") return;
    try {
      sessionStorage.setItem(
        `scout_crawl_v1_${targetUrl}`,
        JSON.stringify({
          sessionId,
          stats,
          pages:        [...pages.entries()],
          brokenLinks,
          graphLinks,
        }),
      );
    } catch { /* sessionStorage quota exceeded — ignore */ }
    // Only fires when crawlStatus flips to "complete"; other values are already
    // committed by that render so ESLint exhaustive-deps is intentionally relaxed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawlStatus, targetUrl]);

  useEffect(() => {
    if (!targetUrl) return;

    // Restore a previously completed crawl instead of re-crawling.
    try {
      const cached = sessionStorage.getItem(`scout_crawl_v1_${targetUrl}`);
      if (cached) {
        const data = JSON.parse(cached) as {
          sessionId:        string | null;
          stats:            CrawlStats;
          pages:            [string, CrawledPage][];
          brokenLinks:      BrokenLink[];
          graphLinks:       GraphLink[];
        };
        setSessionId(data.sessionId ?? null);
        setCrawlStatus("complete");
        setStats(data.stats ?? { visited: 0, skipped: 0, broken: 0, templates: 0 });
        setPages(new Map(data.pages ?? []));
        setBrokenLinks(data.brokenLinks ?? []);
        setGraphLinks(data.graphLinks ?? []);
        setActiveUrl(null);
        return;
      }
    } catch { /* corrupt cache — fall through to normal crawl */ }

    // ── Load existing crawl from DB when a session ID is provided ──────────
    if (existingSessionId) {
      const controller = new AbortController();
      abortRef.current = controller;

      setCrawlStatus("running");

      async function loadFromDb() {
        try {
          const headers: Record<string, string> = {};
          if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

          const [sessionRes, pagesRes, brokenRes, templatesRes, linksRes] = await Promise.all([
            fetch(`${API_URL}/crawl/${existingSessionId}`, { headers, signal: controller.signal }),
            fetch(`${API_URL}/crawl/${existingSessionId}/pages?limit=5000`, { headers, signal: controller.signal }),
            fetch(`${API_URL}/crawl/${existingSessionId}/broken-links`, { headers, signal: controller.signal }),
            fetch(`${API_URL}/crawl/${existingSessionId}/templates`, { headers, signal: controller.signal }),
            fetch(`${API_URL}/crawl/${existingSessionId}/links?limit=10000`, { headers, signal: controller.signal }),
          ]);

          if (controller.signal.aborted) return;

          const sessionData = await sessionRes.json();
          const pagesData   = await pagesRes.json();
          const brokenData  = await brokenRes.json();
          const tmplData    = await templatesRes.json();
          const linksData   = await linksRes.json();

          if (sessionData.error || pagesData.error) {
            throw new Error(sessionData.error || pagesData.error);
          }

          // Map DB pages → CrawledPage + collect screenshots
          const pageMap = new Map<string, CrawledPage>();
          const screenshotMap = new Map<string, string>();
          for (const p of (pagesData.pages ?? []) as { url: string; url_pattern: string | null; is_template_representative: boolean; status_code: number | null; depth: number; screenshot_b64?: string | null }[]) {
            pageMap.set(p.url, {
              url: p.url,
              urlPattern: p.url_pattern ?? null,
              status: "visited",
              statusCode: p.status_code ?? null,
              isTemplateRepresentative: p.is_template_representative ?? false,
              depth: p.depth ?? 0,
              linksFound: 0,
              brokenLinksFound: 0,
            });
            if (p.screenshot_b64) {
              screenshotMap.set(p.url, `data:image/jpeg;base64,${p.screenshot_b64}`);
            }
          }

          // Map DB broken links → BrokenLink[]
          const bl: BrokenLink[] = ((brokenData.broken_links ?? []) as { to_url: string; link_status: string; status_code: number | null; from_page_id: string }[]).map((l) => ({
            url: l.to_url,
            fromUrl: "",
            fromPageTitle: "",
            statusCode: l.status_code ?? null,
            errorType: l.link_status ?? "",
          }));

          // Map DB templates → TemplatePattern[]
          const tp: TemplatePattern[] = ((tmplData.templates ?? []) as { url_pattern: string; representative_url: string; estimated_total: number }[]).map((t) => ({
            pattern: t.url_pattern,
            representativeUrl: t.representative_url ?? "",
            estimatedTotal: t.estimated_total ?? 0,
          }));

          // Map DB links → GraphLink[] for the force-directed graph
          const gl: GraphLink[] = ((linksData.links ?? []) as { from_url: string; to_url: string; is_broken: boolean; is_internal: boolean }[])
            .filter((l) => l.from_url && l.is_internal)
            .map((l) => ({
              source: l.from_url,
              target: l.to_url,
              isBroken: l.is_broken,
            }));

          setSessionId(existingSessionId ?? null);
          setStats({
            visited:   sessionData.pages_visited   ?? pageMap.size,
            skipped:   sessionData.pages_skipped   ?? 0,
            broken:    sessionData.broken_links_found ?? bl.length,
            templates: tp.length,
          });
          setPages(pageMap);
          setBrokenLinks(bl);
          setTemplatePatterns(tp);
          setGraphLinks(gl);
          setScreenshots(screenshotMap);
          setActiveUrl(null);
          setCrawlStatus("complete");
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : String(err));
          setCrawlStatus("failed");
        }
      }

      loadFromDb();
      return () => controller.abort();
    }

    // ── Fresh crawl (no cache, no existing session) ────────────────────────
    // Reset
    setSessionId(null);
    setCrawlStatus("running");
    setStats({ visited: 0, skipped: 0, broken: 0, templates: 0 });
    setPages(new Map());
    setBrokenLinks([]);
    setTemplatePatterns([]);
    setLiveFeed([]);
    setError(null);
    setScreenshots(new Map());
    setActiveUrl(null);
    setGraphLinks([]);
    feedIdRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    async function stream() {
      try {
        const response = await fetch(`${API_URL}/crawl`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ url: targetUrl, options: options ?? {} }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }
        if (!response.body) throw new Error("No response body");

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice("data:".length).trim();
            if (!jsonStr) continue;
            try {
              handleEvent(JSON.parse(jsonStr));
            } catch {
              /* ignore malformed frames */
            }
          }
        }

        setCrawlStatus((prev) => (prev === "stopped" ? "stopped" : "complete"));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setCrawlStatus("failed");
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleEvent(ev: Record<string, any>) {
      switch (ev.type) {
        // ── session started ───────────────────────────────────────────────
        case "crawler_started":
          setSessionId(ev.session_id ?? null);
          break;

        // ── page discovered (added to frontier) ───────────────────────────
        case "page_discovered":
          if (ev.from_url) {
            setGraphLinks((prev) => [
              ...prev,
              { source: ev.from_url, target: ev.url, isBroken: false },
            ]);
          }
          setPages((prev) => {
            if (prev.has(ev.url)) return prev;
            const next = new Map(prev);
            next.set(ev.url, {
              url: ev.url,
              urlPattern: null,
              status: "discovered",
              isTemplateRepresentative: false,
              depth: ev.depth ?? 0,
              linksFound: 0,
              brokenLinksFound: 0,
            });
            return next;
          });
          break;

        // ── page visiting (Playwright loading now) ────────────────────────
        case "page_visiting":
          setActiveUrl(ev.url);
          setPages((prev) => {
            const next = new Map(prev);
            const existing = next.get(ev.url);
            next.set(ev.url, {
              url: ev.url,
              urlPattern: ev.url_pattern ?? null,
              status: "visiting",
              isTemplateRepresentative: false,
              depth: ev.depth ?? existing?.depth ?? 0,
              linksFound: existing?.linksFound ?? 0,
              brokenLinksFound: existing?.brokenLinksFound ?? 0,
            });
            return next;
          });
          pushFeed("page_visiting", ev.url);
          break;

        // ── page fully visited ────────────────────────────────────────────
        case "page_visited": {
          const existing = pages.get(ev.url);
          setPages((prev) => {
            const next = new Map(prev);
            const cur = next.get(ev.url);
            next.set(ev.url, {
              url: ev.url,
              urlPattern: ev.url_pattern ?? cur?.urlPattern ?? null,
              status: "visited",
              statusCode: ev.status_code ?? null,
              isTemplateRepresentative: ev.is_template_representative ?? false,
              depth: cur?.depth ?? existing?.depth ?? 0,
              linksFound: ev.links_found ?? 0,
              brokenLinksFound: ev.broken_links_found ?? 0,
            });
            return next;
          });
          setStats((prev) => ({ ...prev, visited: prev.visited + 1 }));
          pushFeed("page_visited", ev.url);
          break;
        }

        // ── page skipped (template duplicate, robots, etc.) ───────────────
        case "page_skipped":
          setPages((prev) => {
            const next = new Map(prev);
            const cur = next.get(ev.url);
            next.set(ev.url, {
              url: ev.url,
              urlPattern: ev.url_pattern ?? cur?.urlPattern ?? null,
              status: "skipped",
              skipReason: ev.reason ?? "",
              isTemplateRepresentative: false,
              depth: cur?.depth ?? 0,
              linksFound: cur?.linksFound ?? 0,
              brokenLinksFound: cur?.brokenLinksFound ?? 0,
            });
            return next;
          });
          setStats((prev) => ({ ...prev, skipped: prev.skipped + 1 }));
          pushFeed("page_skipped", ev.url, ev.reason ?? "");
          break;

        // ── broken link ───────────────────────────────────────────────────
        case "broken_link":          if (ev.from_url && ev.url) {
            setGraphLinks((prev) => [
              ...prev,
              { source: ev.from_url, target: ev.url, isBroken: true },
            ]);
          }          setBrokenLinks((prev) => [
            ...prev,
            {
              url: ev.url,
              fromUrl: ev.from_url ?? "",
              fromPageTitle: ev.from_page_title ?? "",
              statusCode: ev.status_code ?? null,
              errorType: ev.error_type ?? "",
            },
          ]);
          setStats((prev) => ({ ...prev, broken: prev.broken + 1 }));
          pushFeed(
            "broken_link",
            ev.url,
            `${ev.error_type ?? ""}${ev.status_code ? ` (${ev.status_code})` : ""}`,
          );
          break;

        // ── new template pattern detected ─────────────────────────────────
        case "template_detected":
          setTemplatePatterns((prev) => {
            if (prev.some((t) => t.pattern === ev.pattern)) return prev;
            return [
              ...prev,
              {
                pattern: ev.pattern,
                representativeUrl: ev.representative_url ?? "",
                estimatedTotal: ev.estimated_total ?? 0,
              },
            ];
          });
          setStats((prev) => ({ ...prev, templates: prev.templates + 1 }));
          pushFeed("template_detected", ev.pattern);
          break;

        // ── page screenshot (live browser preview) ────────────────────────
        case "page_screenshot":
          setScreenshots((prev) => {
            const next = new Map(prev);
            next.set(ev.url, `data:image/jpeg;base64,${ev.data}`);
            return next;
          });
          break;

        // ── crawl finished ────────────────────────────────────────────────
        case "crawl_complete":
          if (ev.stats) {
            setStats({
              visited:   ev.stats.visited   ?? 0,
              skipped:   ev.stats.skipped   ?? 0,
              broken:    ev.stats.broken    ?? 0,
              templates: ev.stats.templates_found ?? 0,
            });
          }
          break;

        // ── error ─────────────────────────────────────────────────────────
        case "error":
          setError(ev.message ?? "Unknown error");
          setCrawlStatus("failed");
          break;
      }
    }

    stream();
    return () => controller.abort();
    // options is intentionally excluded — we only restart when targetUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUrl, existingSessionId]);

  return {
    sessionId,
    crawlStatus,
    stats,
    pages,
    brokenLinks,
    templatePatterns,
    liveFeed,
    screenshots,
    activeUrl,
    graphLinks,
    error,
    stop,
  };
}
