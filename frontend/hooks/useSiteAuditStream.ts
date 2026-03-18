"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditStatus = "idle" | "running" | "complete" | "failed";

export interface PhasePrompt {
  phase:       number;
  title:       string;
  issue_count: number;
  prompt:      string;
}

export interface PageAuditResult {
  url:              string;
  status:           "pending" | "auditing" | "complete" | "error";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uiReport:         Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uxReport:         Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seoReport:        Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  complianceReport: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageSecurityFindings: Array<Record<string, any>> | null;
  screenshotUrl: string | null;
  error:            string | null;
  index:            number;
}

export interface SiteSecurityReport {
  overall_score: number;
  counts: { critical: number; high: number; medium: number; low: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  site_wide_findings: Array<Record<string, any>>;
}

export interface SiteAuditStreamResult {
  auditStatus:        AuditStatus;
  pageAudits:         Map<string, PageAuditResult>;
  currentAuditUrl:    string | null;
  auditProgress:      { completed: number; total: number };
  auditError:         string | null;
  siteSecurityReport: SiteSecurityReport | null;
  phasedPrompts:      PhasePrompt[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Auto-starts auditing every visited page as soon as `enabled` becomes true.
 * `urlsToAudit` and `sessionId` are captured into refs at that moment so
 * changes to the arrays after the crawl completes do not re-trigger the audit.
 */
export function useSiteAuditStream(
  urlsToAudit: string[],
  sessionId:   string | null,
  enabled:     boolean,
  accessToken?: string | null,
  existingCrawlSessionId?: string,
): SiteAuditStreamResult {
  const [auditStatus,        setAuditStatus]        = useState<AuditStatus>("idle");
  const [pageAudits,         setPageAudits]         = useState<Map<string, PageAuditResult>>(new Map());
  const [currentAuditUrl,    setCurrentAuditUrl]    = useState<string | null>(null);
  const [auditProgress,      setAuditProgress]      = useState({ completed: 0, total: 0 });
  const [auditError,         setAuditError]         = useState<string | null>(null);
  const [siteSecurityReport, setSiteSecurityReport] = useState<SiteSecurityReport | null>(null);
  const [phasedPrompts,      setPhasedPrompts]      = useState<PhasePrompt[]>([]);

  // Captured at the time `enabled` becomes true (crawl is complete)
  const urlsRef      = useRef<string[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef     = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset everything when a new crawl starts (enabled flips back to false)
    if (!enabled) {
      abortRef.current?.abort();
      setAuditStatus("idle");
      setPageAudits(new Map());
      setCurrentAuditUrl(null);
      setAuditProgress({ completed: 0, total: 0 });
      setAuditError(null);
      setSiteSecurityReport(null);
      setPhasedPrompts([]);
      return;
    }

    // Snapshot the URL list — it won't change after the crawl finishes
    urlsRef.current      = urlsToAudit;
    sessionIdRef.current = sessionId;

    if (urlsRef.current.length === 0) return;

    // ── Restore cached audit results (avoids re-auditing on back-navigation) ──
    try {
      const cacheKey = `scout_site_audit_v1_${sessionId}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached) as {
          pageAudits: [string, PageAuditResult][];
          progress:   { completed: number; total: number };
          siteSecurityReport?: SiteSecurityReport | null;
          phasedPrompts?: PhasePrompt[];
        };
        setPageAudits(new Map(data.pageAudits));
        setAuditProgress(data.progress);
        if (data.siteSecurityReport) {
          setSiteSecurityReport(data.siteSecurityReport);
        }
        if (Array.isArray(data.phasedPrompts) && data.phasedPrompts.length > 0) {
          setPhasedPrompts(data.phasedPrompts);
        }
        setAuditStatus("complete");
        setCurrentAuditUrl(null);
        setAuditError(null);
        return;  // skip SSE — data is already available
      }
    } catch { /* corrupt cache — fall through to normal audit */ }

    // ── Load existing audit results from DB (project revisit) ──────────────
    if (existingCrawlSessionId) {
      const controller = new AbortController();
      abortRef.current = controller;
      setAuditStatus("running");

      async function loadAuditFromDb() {
        try {
          const headers: Record<string, string> = {};
          if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

          const res = await fetch(
            `${API_URL}/crawl/${existingCrawlSessionId}/audit`,
            { headers, signal: controller.signal },
          );
          const data = await res.json();

          if (controller.signal.aborted) return;

          if (data.error) throw new Error(data.error);

          const auditPages = data.pages as {
            url: string; ui_report: Record<string, unknown> | null;
            ux_report: Record<string, unknown> | null;
            seo_report: Record<string, unknown> | null;
            compliance_report: Record<string, unknown> | null;
            page_security_findings?: Array<Record<string, unknown>> | null;
            screenshot_url?: string | null;
            overall_score: number | null;
          }[] ?? [];

          if (auditPages.length === 0 && !data.audit_session) {
            // No audit data in DB — will be re-audited by fresh audit
            setAuditStatus("idle");
            return;
          }

          const map = new Map<string, PageAuditResult>();
          auditPages.forEach((p, idx) => {
            map.set(p.url, {
              url: p.url,
              status: "complete",
              uiReport: (p.ui_report as Record<string, unknown>) ?? null,
              uxReport: (p.ux_report as Record<string, unknown>) ?? null,
              seoReport: (p.seo_report as Record<string, unknown>) ?? null,
              complianceReport: (p.compliance_report as Record<string, unknown>) ?? null,
              pageSecurityFindings: (p.page_security_findings as Array<Record<string, unknown>>) ?? null,
              screenshotUrl: p.screenshot_url ?? null,
              error: null,
              index: idx + 1,
            });
          });

          // Restore site-level security summary from DB response
          if (data.security_summary) {
            setSiteSecurityReport(data.security_summary as SiteSecurityReport);
          }

          // Fetch stored phased prompts from DB via audit_session_id
          const auditSessionId: string | null = data.audit_session?.id ?? null;
          if (auditSessionId) {
            try {
              const promptsRes = await fetch(
                `${API_URL}/audit/session/${auditSessionId}/prompts`,
                { headers, signal: controller.signal },
              );
              const promptsData = await promptsRes.json();
              if (Array.isArray(promptsData.phased_prompts) && promptsData.phased_prompts.length > 0) {
                setPhasedPrompts(promptsData.phased_prompts as PhasePrompt[]);
              }
            } catch { /* non-fatal — prompts just won't show on revisit */ }
          }

          setPageAudits(map);
          setAuditProgress({ completed: auditPages.length, total: auditPages.length });
          setCurrentAuditUrl(null);
          setAuditStatus("complete");
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          // Failed to load from DB — reset to idle so fresh audit can start
          setAuditStatus("idle");
        }
      }

      loadAuditFromDb();
      return () => controller.abort();
    }

    // ── Fresh audit via SSE ────────────────────────────────────────────────
    const controller  = new AbortController();
    abortRef.current  = controller;

    setAuditStatus("running");
    setPageAudits(new Map());
    setCurrentAuditUrl(null);
    setAuditProgress({ completed: 0, total: urlsRef.current.length });
    setAuditError(null);

    async function stream() {
      try {
        const response = await fetch(`${API_URL}/audit/site`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body:    JSON.stringify({
            session_id:  sessionIdRef.current,
            urls:        urlsRef.current,
            concurrency: 2,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
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
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            try { handleEvent(JSON.parse(jsonStr)); } catch { /* ignore */ }
          }
        }

        setAuditStatus((prev) => (prev === "failed" ? "failed" : "complete"));
        setCurrentAuditUrl(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setAuditError(err instanceof Error ? err.message : String(err));
        setAuditStatus("failed");
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleEvent(ev: Record<string, any>) {
      switch (ev.type) {
        case "site_audit_started":
          setAuditProgress({ completed: 0, total: ev.total ?? urlsRef.current.length });
          break;

        case "page_audit_started":
          setCurrentAuditUrl(ev.url);
          setPageAudits((prev) => {
            const next = new Map(prev);
            next.set(ev.url, {
              url: ev.url, status: "auditing",
              uiReport: null, uxReport: null, seoReport: null, complianceReport: null, pageSecurityFindings: null,
              screenshotUrl: null,
              error: null, index: ev.index ?? 0,
            });
            return next;
          });
          break;

        case "page_audit_complete":
          setPageAudits((prev) => {
            const next = new Map(prev);
            next.set(ev.url, {
              url:              ev.url,
              status:           "complete",
              uiReport:         ev.ui_report         ?? null,
              uxReport:         ev.ux_report         ?? null,
              seoReport:        ev.seo_report        ?? null,
              complianceReport: ev.compliance_report ?? null,
              pageSecurityFindings: ev.page_security_findings ?? null,
              screenshotUrl: ev.screenshot_base64 ? `data:image/png;base64,${ev.screenshot_base64}` : null,
              error:            null,
              index:            ev.index ?? 0,
            });
            return next;
          });
          setAuditProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
          break;

        case "page_audit_error":
          setPageAudits((prev) => {
            const next = new Map(prev);
            next.set(ev.url, {
              url: ev.url, status: "error",
              uiReport: null, uxReport: null, seoReport: null, complianceReport: null, pageSecurityFindings: null,
              screenshotUrl: null,
              error: ev.error ?? "Unknown error",
              index: ev.index ?? 0,
            });
            return next;
          });
          setAuditProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
          break;

        case "site_audit_complete":
          setCurrentAuditUrl(null);
          if (ev.security_overall_score != null) {
            setSiteSecurityReport({
              overall_score: ev.security_overall_score,
              counts: ev.security_counts ?? { critical: 0, high: 0, medium: 0, low: 0 },
              site_wide_findings: ev.security_site_wide_findings ?? [],
            });
          }
          if (Array.isArray(ev.phased_prompts) && ev.phased_prompts.length > 0) {
            setPhasedPrompts(ev.phased_prompts as PhasePrompt[]);
          }
          break;

        case "error":
          setAuditError(ev.message ?? "Unknown error");
          setAuditStatus("failed");
          break;
      }
    }

    stream();
    return () => controller.abort();
    // Only re-runs when `enabled` flips — urlsToAudit/sessionId captured via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, existingCrawlSessionId]);

  // Persist completed audit to sessionStorage for back-navigation restoration.
  useEffect(() => {
    if (auditStatus !== "complete" || pageAudits.size === 0) return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      sessionStorage.setItem(
        `scout_site_audit_v1_${sid}`,
        JSON.stringify({
          pageAudits:         [...pageAudits.entries()],
          progress:           auditProgress,
          siteSecurityReport: siteSecurityReport ?? null,
          phasedPrompts:      phasedPrompts,
        }),
      );
    } catch { /* quota exceeded — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditStatus, siteSecurityReport, phasedPrompts]);

  return { auditStatus, pageAudits, currentAuditUrl, auditProgress, auditError, siteSecurityReport, phasedPrompts };
}
