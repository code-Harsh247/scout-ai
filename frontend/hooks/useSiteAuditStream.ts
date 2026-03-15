"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditStatus = "idle" | "running" | "complete" | "failed";

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
  error:            string | null;
  index:            number;
}

export interface SiteAuditStreamResult {
  auditStatus:     AuditStatus;
  pageAudits:      Map<string, PageAuditResult>;
  currentAuditUrl: string | null;
  auditProgress:   { completed: number; total: number };
  auditError:      string | null;
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
  const [auditStatus,     setAuditStatus]     = useState<AuditStatus>("idle");
  const [pageAudits,      setPageAudits]      = useState<Map<string, PageAuditResult>>(new Map());
  const [currentAuditUrl, setCurrentAuditUrl] = useState<string | null>(null);
  const [auditProgress,   setAuditProgress]   = useState({ completed: 0, total: 0 });
  const [auditError,      setAuditError]      = useState<string | null>(null);

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
        };
        setPageAudits(new Map(data.pageAudits));
        setAuditProgress(data.progress);
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
              error: null,
              index: idx + 1,
            });
          });

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
              uiReport: null, uxReport: null, seoReport: null, complianceReport: null,
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
              uiReport: null, uxReport: null, seoReport: null, complianceReport: null,
              error: ev.error ?? "Unknown error",
              index: ev.index ?? 0,
            });
            return next;
          });
          setAuditProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
          break;

        case "site_audit_complete":
          setCurrentAuditUrl(null);
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
          pageAudits: [...pageAudits.entries()],
          progress:   auditProgress,
        }),
      );
    } catch { /* quota exceeded — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditStatus]);

  return { auditStatus, pageAudits, currentAuditUrl, auditProgress, auditError };
}
