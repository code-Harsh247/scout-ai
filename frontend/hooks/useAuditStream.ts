"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the backend JSON schemas exactly
// ---------------------------------------------------------------------------

export interface AuditCategory {
  score: number;       // 1–10
  findings: string;
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
  findings: string;
}

export interface ComplianceReport {
  overall_risk_score: number; // 1-10 where lower is better
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
  overall_score: number; // 1-10
  universal_factors: Record<string, SeoFactor>;
  search_intent: {
    primary_intent: string;
    top_entities: string[];
    target_keyword_suggestion: string;
  };
  intent_alignment: {
    status: string;
    explanation: string;
  };
  competitor_gap: {
    missing_crucial_entities: string[];
  };
  recommendations: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// SSE event shapes from backend
// ---------------------------------------------------------------------------

type SseUiResultEvent  = { type: "ui_result"; ui_report: UiReport };
type SseUxResultEvent  = { type: "ux_result"; ux_report: UxReport };
type SseComplianceResultEvent = { type: "compliance_result"; compliance_report: ComplianceReport };
type SseSeoResultEvent = { type: "seo_result"; seo_report: SeoReport };
type SseResultEvent    = {
  type: "result";
  ui_report?: UiReport;
  ux_report?: UxReport;
  compliance_report?: ComplianceReport;
  seo_report?: SeoReport;
};
type SseErrorEvent     = { type: "error"; message: string };

type SseEvent =
  | { type: "status"; [key: string]: unknown }  // ignored
  | SseUiResultEvent
  | SseUxResultEvent
  | SseComplianceResultEvent
  | SseSeoResultEvent
  | SseResultEvent
  | SseErrorEvent;

// ---------------------------------------------------------------------------
// Public hook return type
// ---------------------------------------------------------------------------

export interface AuditStreamResult {
  uiReport: UiReport | null;
  uxReport: UxReport | null;
  complianceReport: ComplianceReport | null;
  seoReport: SeoReport | null;
  isLoading: boolean;
  /** Final `type: "result"` received */
  isDone: boolean;
  error: string | null;
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
  const [isLoading, setIsLoading] = useState(false);
  const [isDone, setIsDone]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

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
        };
        setUiReport(data.uiReport ?? null);
        setUxReport(data.uxReport ?? null);
        setComplianceReport(data.complianceReport ?? null);
        setSeoReport(data.seoReport ?? null);
        setIsLoading(false);
        setIsDone(true);
        setError(null);
        return; // no cleanup needed — no AbortController was created
      }
    } catch { /* sessionStorage unavailable or corrupt — fall through */ }

    // Reset state so a re-run (e.g. React Strict Mode double-invoke) starts clean
    setUiReport(null);
    setUxReport(null);
    setComplianceReport(null);
    setSeoReport(null);
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

        if (!response.body) {
          throw new Error("No response body — streaming not supported");
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE messages are separated by double newlines
          const parts = buffer.split("\n\n");
          // Keep the last incomplete chunk in the buffer
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
        case "status":
          // Agent card animations are fully mocked — ignore status events
          break;

        case "ui_result":
          setUiReport(event.ui_report);
          break;

        case "ux_result":
          setUxReport(event.ux_report);
          break;

        case "compliance_result":
          setComplianceReport(event.compliance_report);
          break;

        case "seo_result":
          setSeoReport(event.seo_report);
          break;

        case "result":
          if (event.ui_report) setUiReport(event.ui_report);
          if (event.ux_report) setUxReport(event.ux_report);
          if (event.compliance_report) setComplianceReport(event.compliance_report);
          if (event.seo_report) setSeoReport(event.seo_report);
          setIsLoading(false);
          setIsDone(true);
          break;

        case "error":
          setError(event.message);
          setIsLoading(false);
          break;
      }
    }

    stream();

    return () => {
      abortController.abort();
    };
  }, [targetUrl]);

  return { uiReport, uxReport, complianceReport, seoReport, isLoading, isDone, error };
}
