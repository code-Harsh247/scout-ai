"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the backend JSON schemas exactly
// ---------------------------------------------------------------------------

export interface Evidence {
  check_key: string;
  label?: string;           // Human-readable screenshot title
  description: string;
  recommended_fix?: string; // One-line fix hint shown in lightbox
  image_base64: string;
  element_selector?: string;
}

export interface AuditCategory {
  score: number;       // 1–10
  findings: string[];  // Array of concise bullet strings
  recommended_fix?: string;
  evidence?: Evidence[];
}

export interface UiReport {
  overall_score: number;
  layout_spacing: AuditCategory;
  responsiveness: AuditCategory;
  typography: AuditCategory;
  color_coherence: AuditCategory;
  recommendations: string[];
  error?: string;
}

export interface UxReport {
  overall_score: number;
  accessibility: AuditCategory;
  ux_friction: AuditCategory;
  navigation_ia: AuditCategory;
  inclusivity: AuditCategory;
  recommendations: string[];
  error?: string;
}

export interface ComplianceRiskCategory {
  risk_level: "Low" | "Medium" | "High" | string;
  findings: string[];
  recommended_fix?: string;
  evidence?: Evidence[];
}

export interface ComplianceReport {
  overall_risk_score: number;
  data_privacy: ComplianceRiskCategory;
  legal_transparency: ComplianceRiskCategory;
  accessibility_compliance: ComplianceRiskCategory;
  critical_violations: string[];
  error?: string;
}

export interface SeoFactor {
  status: "pass" | "warn" | "fail" | string;
  note: string;
}

export interface SeoReport {
  overall_score: number;
  universal_factors: Record<string, SeoFactor>;
  search_intent: {
    primary_intent: string;
    top_entities: string[];
    target_keyword_suggestion: string;
  };
  intent_alignment: { status: string; explanation: string };
  competitor_gap: { missing_crucial_entities: string[] };
  recommendations: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Multi-page types
// ---------------------------------------------------------------------------

export interface DiscoveredPage {
  url: string;
  page_type: string;
}

export interface PageAuditResult {
  url: string;
  page_type: string;
  ui_report: UiReport | null;
  ux_report: UxReport | null;
  compliance_report: ComplianceReport | null;
  seo_report: SeoReport | null;
}

export interface SiteReport {
  pages_analysed: number;
  page_urls: string[];
  ui_report: UiReport;
  ux_report: UxReport;
  compliance_report: ComplianceReport;
  seo_report: SeoReport;
}

// ---------------------------------------------------------------------------
// SSE event shapes
// ---------------------------------------------------------------------------

type SseResultEvent = {
  type: "result";
  site_report: SiteReport;
  page_results: PageAuditResult[];
};
type SsePagesDiscoveredEvent = { type: "pages_discovered"; pages: DiscoveredPage[] };
type SsePageCompleteEvent = {
  type: "page_complete";
  url: string;
  page_type: string;
  page_index: number;
  total: number;
};
type SseErrorEvent = { type: "error"; message: string };

type SseEvent =
  | SsePagesDiscoveredEvent
  | SsePageCompleteEvent
  | SseResultEvent
  | SseErrorEvent
  | { type: "status"; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Public hook return type
// ---------------------------------------------------------------------------

export interface AuditStreamResult {
  discoveredPages: DiscoveredPage[];
  completedPageUrls: Set<string>;
  siteReport: SiteReport | null;
  pageResults: PageAuditResult[];
  isLoading: boolean;
  isDone: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function useAuditStream(targetUrl: string): AuditStreamResult {
  const [discoveredPages, setDiscoveredPages] = useState<DiscoveredPage[]>([]);
  const [completedPageUrls, setCompletedPageUrls] = useState<Set<string>>(new Set());
  const [siteReport, setSiteReport] = useState<SiteReport | null>(null);
  const [pageResults, setPageResults] = useState<PageAuditResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!targetUrl) return;

    setDiscoveredPages([]);
    setCompletedPageUrls(new Set());
    setSiteReport(null);
    setPageResults([]);
    setIsLoading(false);
    setIsDone(false);
    setError(null);

    const abortController = new AbortController();

    async function stream() {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_URL}/audit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }
        if (!response.body) throw new Error("No response body — streaming not supported");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

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
            let event: SseEvent;
            try {
              event = JSON.parse(jsonStr) as SseEvent;
            } catch {
              console.warn("[useAuditStream] Failed to parse SSE chunk:", jsonStr);
              continue;
            }
            handleEvent(event);
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsLoading(false);
      }
    }

    function handleEvent(event: SseEvent) {
      switch (event.type) {
        case "pages_discovered":
          setDiscoveredPages(event.pages);
          break;
        case "page_complete":
          setCompletedPageUrls((prev) => new Set([...prev, event.url]));
          break;
        case "result":
          setSiteReport(event.site_report);
          setPageResults(event.page_results);
          setIsLoading(false);
          setIsDone(true);
          break;
        case "error":
          setError(event.message);
          setIsLoading(false);
          break;
        default:
          break;
      }
    }

    stream();
    return () => { abortController.abort(); };
  }, [targetUrl]);

  return { discoveredPages, completedPageUrls, siteReport, pageResults, isLoading, isDone, error };
}
