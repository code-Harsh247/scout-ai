"use client";

import { useEffect, useState } from "react";
import type { PhasePrompt } from "@/hooks/useSiteAuditStream";

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
  ui_report?: UiReport;
  ux_report?: UxReport;
  compliance_report?: ComplianceReport;
  seo_report?: SeoReport;
  screenshot_base64?: string | null;
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
  uiReport: UiReport | null;
  uxReport: UxReport | null;
  complianceReport: ComplianceReport | null;
  seoReport: SeoReport | null;
  screenshotUrl: string | null;
  isLoading: boolean;
  isDone: boolean;
  error: string | null;
  phasedPrompts: PhasePrompt[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function useAuditStream(targetUrl: string, accessToken?: string | null): AuditStreamResult {
  const [uiReport, setUiReport]   = useState<UiReport | null>(null);
  const [uxReport, setUxReport]   = useState<UxReport | null>(null);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [seoReport, setSeoReport] = useState<SeoReport | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [phasedPrompts, setPhasedPrompts] = useState<PhasePrompt[]>([]);

  useEffect(() => {
    if (!targetUrl) return;

    // If the caller saved results to sessionStorage (e.g. via the CrawlerDashboard
    // "View" link), restore them immediately and skip the API call entirely.
    try {
      const cached = sessionStorage.getItem(`scout_audit_v1_${targetUrl}`);
      if (cached) {
        const data = JSON.parse(cached) as {
          uiReport?: UiReport;
          uxReport?: UxReport;
          complianceReport?: ComplianceReport;
          seoReport?: SeoReport;
          screenshotUrl?: string;
        };
        setUiReport(data.uiReport ?? null);
        setUxReport(data.uxReport ?? null);
        setComplianceReport(data.complianceReport ?? null);
        setSeoReport(data.seoReport ?? null);
        setScreenshotUrl(data.screenshotUrl ?? null);
        setIsLoading(false);
        setIsDone(true);
        setError(null);
        // Fetch phased prompts for cached results
        fetchPhasedPrompts(data.uiReport ?? null, data.uxReport ?? null, data.complianceReport ?? null, data.seoReport ?? null);
        return; // no cleanup needed — no AbortController was created
      }
    } catch { /* sessionStorage unavailable or corrupt — fall through */ }

    // Reset state so a re-run (e.g. React Strict Mode double-invoke) starts clean
    setUiReport(null);
    setUxReport(null);
    setComplianceReport(null);
    setSeoReport(null);
    setScreenshotUrl(null);
    setIsLoading(false);
    setIsDone(false);
    setError(null);

    const abortController = new AbortController();

    async function stream() {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_URL}/audit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
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
          if (event.ui_report) setUiReport(event.ui_report);
          if (event.ux_report) setUxReport(event.ux_report);
          if (event.compliance_report) setComplianceReport(event.compliance_report);
          if (event.seo_report) setSeoReport(event.seo_report);
          if (event.screenshot_base64) setScreenshotUrl(`data:image/png;base64,${event.screenshot_base64}`);
          setIsLoading(false);
          setIsDone(true);
          fetchPhasedPrompts(
            event.ui_report ?? null,
            event.ux_report ?? null,
            event.compliance_report ?? null,
            event.seo_report ?? null,
          );
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

    async function fetchPhasedPrompts(
      ui: UiReport | null,
      ux: UxReport | null,
      compliance: ComplianceReport | null,
      seo: SeoReport | null,
    ) {
      try {
        const res = await fetch(`${API_URL}/audit/prompts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ui_report:         ui,
            ux_report:         ux,
            compliance_report: compliance,
            seo_report:        seo,
            site_url:          targetUrl,
          }),
        });
        if (!res.ok) return;
        const data = await res.json() as { phases?: PhasePrompt[] };
        if (Array.isArray(data.phases) && data.phases.length > 0) {
          setPhasedPrompts(data.phases);
        }
      } catch { /* non-critical — silently ignore */ }
    }

    return () => {
      abortController.abort();
    };
  }, [targetUrl]);

  return { uiReport, uxReport, complianceReport, seoReport, screenshotUrl, isLoading, isDone, error, phasedPrompts };
}
