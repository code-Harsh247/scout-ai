# Phase 4 — UX Revamp Plan

## Overview

Three distinct work items:

1. **Landing page revamp** — remove URL input, replace with a "Get Started" CTA
2. **Re-crawl on back-navigation bug fix** — prevent crawl restarting when returning to the crawl page
3. **Audit report UI revamp** — match the aesthetic of the crawl screens

---

## 4a — Landing Page Revamp

### Current behaviour
The landing page has a URL input field that directly starts a crawl.

### Target behaviour
- Landing page is a **marketing/hero page** — no URL input
- Single **"Get Started"** CTA button
  - If user is **not logged in** → redirect to `/login`
  - If user **is logged in** → redirect to `/dashboard`
- `/dashboard` becomes the true entry point for logged-in users
  - Shows the user's previously crawled websites (projects)
  - If no projects yet → shows an empty state with a **"New Project"** button
  - Clicking "New Project" opens a **modal** with a URL input field
  - Submitting the modal URL starts the crawl → navigates to `/crawl?url=<url>`

### Files to change
| File | Change |
|---|---|
| `frontend/app/page.tsx` | Replace `LandingInput` with hero + "Get Started" button wired to auth state |
| `frontend/components/nonprimitive/LandingInput.tsx` | Can be deleted or repurposed |
| `frontend/app/dashboard/page.tsx` | Add project list, "New Project" button, `NewProjectModal` component |
| `frontend/components/nonprimitive/NewProjectModal.tsx` | New: modal with URL input + validation, routes to `/crawl` |

### Notes
- "Get Started" button should use `useSupabaseSession` — if `loading` is true show a spinner, then redirect appropriately once resolved
- The modal URL input should reuse the same validation logic as the old `LandingInput` (normalise protocol, trim whitespace)
- Dashboard project list = `crawl_sessions` rows from Supabase (group by `root_url`, show most recent)

---

## 4b — Re-crawl on Back Navigation Bug

### Root cause
When the user presses back from the audit report to `/crawl`, the crawl page re-mounts and `useCrawlStream` fires a new `POST /crawl` request unconditionally.

### Fix
The crawl page already stores completed crawl data in `sessionStorage`. The hook needs to detect that a session for this URL already exists in `sessionStorage` and **skip** the SSE fetch — rendering the cached result immediately instead.

### Files to change
| File | Change |
|---|---|
| `frontend/hooks/useCrawlStream.ts` | On mount, check `sessionStorage` for an existing completed session matching `targetUrl`; if found, return cached data immediately and set `isDone = true` without opening an SSE connection |
| `frontend/app/crawl/page.tsx` (or `CrawlerDashboard`) | Ensure the "Audit" button still works after cache restore |

### Notes
- Cache key: `crawl_<normalised_url>` (same key already used today)
- Only skip fetch if cached session has `status === "complete"` — a `running` session should still reconnect
- The back-navigation fix for the **audit page** (re-running audit when pressing back) is already handled via `sessionStorage` caching added in Phase 2 — verify this is working; if not, apply the same pattern to `useAuditStream`

---

## 4c — Audit Report UI Revamp

### Current problems
- Layout doesn't match the crawl screen aesthetic (dark glass cards, purple accents, animated rows)
- Tabs feel flat / out of place
- Score circles are inconsistent with the rest of the design

### Target aesthetic (match crawl screens)
- Same `bg-grid` background with radial purple glow at top
- Glass cards (`glass-card` / `glass-card-hi`) for each section
- Consistent typography: `text-text` / `text-text-sub` / `text-accent`
- Agent status rows with animated shimmer while processing (match the live crawl table rows)
- Score displayed as a large circular badge with colour coding (green ≥ 70, amber ≥ 40, red < 40) — consistent with crawl stats
- Tab bar styled like the crawl page's node-graph toggle (pill tabs with `bg-white/8` track)
- Check items rendered as styled rows with pass/fail icons, not plain `<li>` elements
- Smooth `animate-fade-in` entrance on results reveal

### Files to change
| File | Change |
|---|---|
| `frontend/components/nonprimitive/AnalysisDashboard.tsx` | Full UI rewrite of the results section; keep all data/hook logic unchanged |
| `frontend/app/globals.css` | Add any missing utility classes (e.g. shimmer animation if not present) |

### Key sections to redesign
1. **Header** — breadcrumb + back button (already done), URL displayed as subtitle
2. **Overall score card** — large circular score, summary text, 4 agent sub-scores in a 2×2 grid
3. **Agent tabs** — pill tab bar (UI / UX / Compliance / SEO)
4. **Active tab content**
   - Summary paragraph in a `glass-card`
   - Checks list: each check is a card row with coloured pass/warn/fail dot, check title, description
   - Action items: numbered list in a distinct `glass-card-hi` block
5. **Processing state** — skeleton shimmer rows while agents are running (same style as crawl live table)

---

## Implementation Order

```
4b (bug fix)  →  4a (landing + dashboard)  →  4c (audit UI)
```

Fix the back-navigation bug first (lowest risk, unblocks clean testing of the new flow),
then build the new landing/dashboard flow, then polish the audit UI last.
