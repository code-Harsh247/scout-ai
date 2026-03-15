# Scout.ai — Multi-Page Crawler, Full-Site Analysis & Auth
## Technical Design Roadmap

> **Current state**: Scout.ai audits a single URL through four parallel AI agents (UI, UX, Compliance, SEO) and streams one combined result via SSE. The stack is FastAPI + LangGraph on the backend and Next.js 16 + React 19 on the frontend.
>
> **Target state**: A three-phase evolution to a full-site crawler with live visualization, multi-page agent analysis with a cross-site synthesis node, and Supabase-backed auth with persistent audit history.

---

## Table of Contents

1. [Phase 1 — Smart Site Crawler](#phase-1--smart-site-crawler)
2. [Phase 2 — Multi-Page Agent Pipeline](#phase-2--multi-page-agent-pipeline)
3. [Phase 3 — Supabase Auth & Audit History](#phase-3--supabase-auth--audit-history)
4. [Implementation Sequence](#implementation-sequence)
5. [Open Questions](#open-questions)

---

## Phase 1 — Smart Site Crawler

### Goals

- Crawl a website starting from a root URL and build a structured site map
- Intelligently deduplicate **template pages** so the same layout is not indexed for every product, post, or listing item
- Detect broken and unreachable links in a separate health-check pass
- Stream live crawl progress to the frontend with a visual site graph

---

### 1.1 Crawler Architecture

A new `backend/crawler/` package contains all crawling logic, kept completely separate from the existing audit agents.

```
POST /crawl (SSE)
  └─► CrawlOrchestrator
        ├─► BFSCrawler           (asyncio.Queue frontier, Playwright page visits)
        ├─► TemplateDetector     (URL pattern normalization + DOM hash fingerprinting)
        ├─► LinkExtractor        (parses <a href>, <button>, <form action> from rendered DOM)
        ├─► BrokenLinkChecker    (httpx HEAD requests, async, parallel)
        └─► CrawlDB              (Supabase PostgreSQL — configured in milestone 1a)
```

**BFSCrawler flow (per URL dequeued from frontier):**

1. Normalize URL — strip fragment (`#anchor`), normalize trailing slash, lowercase host.
2. Check if URL is same-origin — discard if external.
3. Check `robots.txt` disallow list — skip if disallowed.
4. Check URL against known skip patterns (binary extensions: `.pdf`, `.jpg`, `.png`, `.zip`, `.mp4`, etc.).
5. Ask `TemplateDetector` — if this URL matches a known template pattern **and** that pattern already has `≥ max_samples` representative pages, mark as `skipped` and emit `page_skipped` SSE event.
6. Otherwise: open Playwright page, await `networkidle`, extract links and page metadata.
7. Register URL + DOM hash with `TemplateDetector`.
8. Insert row into `crawled_pages`.
9. Emit `page_visited` SSE event.
10. Queue all newly discovered same-origin URLs.

**Concurrency:** three Playwright browser contexts run in parallel (configurable). The async frontier queue feeds all workers.

**Depth & page limits:** configurable per request, with sensible defaults:

| Parameter              | Default |
|------------------------|---------|
| `depth_limit`          | 4       |
| `page_limit`           | 150     |
| `max_samples_per_template` | 3   |
| `concurrency`          | 3       |

---

### 1.2 Template Detection

This is the critical intelligence layer. The goal is to recognize that `/products/iphone-15` and `/products/samsung-s24` are both instances of `/products/:slug` — and audit only one or two representative examples rather than all 847 product pages.

#### Step 1 — URL Pattern Normalization

Transform URL path segments using these replacement rules (applied in order):

| Segment matches | Replace with |
|---|---|
| UUID (`\b[0-9a-f]{8}-…\b`) | `:uuid` |
| Pure integer (`^\d+$`) | `:id` |
| Hex hash ≥ 8 chars (`^[0-9a-f]{8,}$`) | `:hash` |
| Slug: 3+ hyphenated lowercase words (`^[a-z0-9]+(-[a-z0-9]+){2,}$`) | `:slug` |
| ISO date segment (`^\d{4}-\d{2}$`, etc.) | `:date` |
| Query param `?page=N` | strip entirely |

**Examples:**
- `/blog/2024/my-first-post` → `/blog/:date/:slug`
- `/products/42/samsung-galaxy-s24` → `/products/:id/:slug`
- `/users/abc123def456` → `/users/:hash`
- `/about` → `/about` (unchanged — always visit)

#### Step 2 — DOM Structural Fingerprint (secondary check)

When a URL matches a known pattern, compare a lightweight structural hash of the rendered page:

1. Extract all tag names + BEM-style class prefixes from the DOM (no text content, no IDs).
2. Produce a sorted list of `tag.class-prefix` pairs.
3. SHA-256 hash of that list.

If the structural hash matches an existing representative page in that pattern group, it is definitively a template duplicate. If the hash differs significantly despite the URL pattern match, it may be a distinct page type — visit it and register as a new representative.

#### Template Registry (in-memory per crawl session, persisted to DB)

```json
{
  "/products/:slug": {
    "pattern": "/products/:slug",
    "representative_urls": ["https://shop.com/products/iphone-15"],
    "sample_count": 1,
    "dom_hash": "3f5a9c…",
    "estimated_total": 847
  },
  "/blog/:date/:slug": {
    "pattern": "/blog/:date/:slug",
    "representative_urls": ["https://site.com/blog/2024/first-post", "https://site.com/blog/2024/second-post"],
    "sample_count": 2,
    "dom_hash": "8b2d1e…",
    "estimated_total": 28
  }
}
```

#### Heuristics that bypass template detection (always visit)

- URL depth 1 (e.g., `/about`, `/contact`, `/pricing`) — never skipped.
- Pages with < 5 internal links and no pagination element — likely a leaf utility page.
- Pages explicitly linked from the navigation `<nav>` of the homepage.

---

### 1.3 Broken Link Detection

A separate async pass runs concurrently with crawling:

- For every outgoing `<a href>` extracted (both internal and external), issue an `httpx` `HEAD` request (with `GET` fallback for 405 responses).
- Follow redirect chains; classify the **final** response:

| Final response | Classification |
|---|---|
| 2xx | `ok` |
| 301 / 302 | `redirect` (record final URL) |
| 404 | `broken` |
| 4xx (other) | `client_error` |
| 5xx | `server_error` |
| Timeout / DNS fail | `unreachable` |

- Dead links are emitted as `broken_link` SSE events immediately.
- Internal broken links are flagged as high priority in the final audit.

---

### 1.4 Platform Database (Supabase PostgreSQL)

Supabase is used as the single database from the start — no SQLite, no later migration. The project is created and this schema is deployed as part of milestone **1a**.

> `user_id` columns reference the `profiles` table but are **nullable** until Phase 3 adds authentication. The `profiles` table is created in Phase 3 when `auth.users` becomes available; once Phase 3 lands, a migration removes the nullable constraint.

```sql
-- Core crawler tables (milestone 1a)
CREATE TABLE crawl_sessions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID,                          -- nullable until Phase 3
    root_url           TEXT NOT NULL,
    status             TEXT NOT NULL,                 -- queued | running | complete | failed
    started_at         TIMESTAMPTZ DEFAULT now(),
    completed_at       TIMESTAMPTZ,
    pages_discovered   INTEGER DEFAULT 0,
    pages_visited      INTEGER DEFAULT 0,
    pages_skipped      INTEGER DEFAULT 0,
    broken_links_found INTEGER DEFAULT 0,
    config             JSONB                          -- depth_limit, page_limit, concurrency, max_samples
);

CREATE TABLE crawled_pages (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id                 UUID NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    url                        TEXT NOT NULL,
    url_pattern                TEXT,                  -- normalized template pattern
    is_template_representative BOOLEAN DEFAULT FALSE,
    status_code                INTEGER,
    page_title                 TEXT,
    dom_hash                   TEXT,                  -- structural fingerprint
    page_context               JSONB,                 -- full ScoutState page_context; used by audit pipeline
    depth                      INTEGER,
    visited_at                 TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crawled_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    from_page_id  UUID REFERENCES crawled_pages(id),
    to_url        TEXT NOT NULL,
    link_text     TEXT,
    status_code   INTEGER,
    link_status   TEXT,   -- ok | redirect | broken | client_error | server_error | unreachable
    is_internal   BOOLEAN,
    final_url     TEXT
);

CREATE TABLE template_patterns (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             UUID NOT NULL REFERENCES crawl_sessions(id) ON DELETE CASCADE,
    pattern                TEXT NOT NULL,
    representative_page_id UUID REFERENCES crawled_pages(id),
    sample_count           INTEGER DEFAULT 1,
    estimated_total_pages  INTEGER DEFAULT 1,
    dom_hash               TEXT
);

-- Audit result tables (milestone 2a — added when Phase 2 ships)
CREATE TABLE audit_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID,                           -- nullable until Phase 3
    crawl_session_id  UUID REFERENCES crawl_sessions(id),
    root_url          TEXT NOT NULL,
    status            TEXT NOT NULL,
    started_at        TIMESTAMPTZ DEFAULT now(),
    completed_at      TIMESTAMPTZ,
    overall_score     NUMERIC(4,1),
    synthesis_report  JSONB
);

CREATE TABLE page_audits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_session_id  UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
    crawled_page_id   UUID REFERENCES crawled_pages(id),
    url               TEXT NOT NULL,
    ui_report         JSONB,
    ux_report         JSONB,
    compliance_report JSONB,
    seo_report        JSONB,
    overall_score     NUMERIC(4,1),
    audited_at        TIMESTAMPTZ DEFAULT now()
);
```

---

### 1.5 Backend API

New endpoint added to `main.py`:

```
POST /crawl
Body:  { url: string, options?: { depth_limit?, page_limit?, max_samples_per_template?, concurrency? } }
Response: SSE stream (text/event-stream)
```

**SSE event types emitted:**

| Event | Payload |
|---|---|
| `crawler_started` | `{ session_id, root_url, config }` |
| `page_discovered` | `{ url, depth, from_url }` |
| `page_visiting` | `{ url, depth, url_pattern }` |
| `page_visited` | `{ url, url_pattern, status_code, is_template_representative, links_found, broken_links_found }` |
| `page_skipped` | `{ url, url_pattern, reason: "template_duplicate" \| "depth_limit" \| "robots_txt" \| "off_domain" }` |
| `broken_link` | `{ url, from_url, from_page_title, status_code, error_type }` |
| `template_detected` | `{ pattern, representative_url, estimated_total }` |
| `crawl_complete` | `{ session_id, stats: { visited, skipped, broken, templates_found, duration_ms } }` |
| `error` | `{ message }` |

**Additional REST endpoints:**

```
GET  /crawl/{session_id}               — full crawl session summary
GET  /crawl/{session_id}/pages         — paginated list of visited pages
GET  /crawl/{session_id}/broken-links  — all broken links found
GET  /crawl/{session_id}/templates     — discovered template patterns
```

---

### 1.6 Frontend: Live Crawler UI

#### New Page: `/crawl`

A new `CrawlerDashboard` component replaces the current landing-to-analysis direct jump. The flow becomes:

```
Landing (enter URL) → /crawl?url=... (live crawl) → review → [Audit Selected Pages] → /analysis
```

#### CrawlerDashboard Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Scout  ›  Crawling: example.com                 [Pause]  [Stop] │
├──────────────────────────────────────────────────────────────────┤
│  ● Running  │  63 visited  │  24 skipped  │  5 broken            │
├───────────────────────────┬──────────────────────────────────────┤
│                           │  LIVE FEED                           │
│   SITE GRAPH              │  ─────────────────────────────────── │
│                           │  ✅  /about                          │
│   (force-directed graph   │  ✅  /pricing                        │
│    nodes colored by       │  ⏭  /products/widget-b  (template)  │
│    status; edges are      │  ❌  /old-page  →  404               │
│    links between pages)   │  🔄  /blog/post-3  (visiting…)       │
│                           │                                      │
│   Click node to inspect   │  TEMPLATE PATTERNS                   │
│                           │  /products/:slug      142 pages      │
│                           │  /blog/:year/:slug     28 pages      │
│                           │  /docs/:section/:id    19 pages      │
└───────────────────────────┴──────────────────────────────────────┘
│  [Audit All Representative Pages]   [Select Pages…]   [Cancel]   │
└──────────────────────────────────────────────────────────────────┘
```

**Site graph:**
- Implementation: plain React state + Tailwind CSS — a collapsible tree grouped by URL path depth and template pattern; no external graph library
- Each row has a colored status dot: green = visited, grey = skipped (template), red = broken, yellow = queued
- Template clusters are collapsed by default showing `pattern (N pages)` — expand to list representative URLs
- Clicking any row opens an inline detail drawer: full URL, HTTP status, template pattern, and outbound link count

**Live feed:**
- Virtualized list (`react-virtual`) — handles thousands of events without DOM bloat
- Auto-scrolls; user can pause auto-scroll by hovering
- Filter toggles: All | Visited | Skipped | Broken

**Broken links panel:**
- Separate tab listing every broken link with its source page and HTTP status

#### New Hook: `useCrawlStream(url, options)`

Mirrors the architecture of the existing `useAuditStream` — `fetch` POST, `ReadableStream` body, `TextDecoder`, SSE frame splitting on `\n\n`.

```typescript
interface CrawlState {
  sessionId: string | null;
  status: 'idle' | 'running' | 'paused' | 'complete' | 'failed';
  stats: { visited: number; skipped: number; broken: number; templates: number };
  pages: CrawledPage[];
  brokenLinks: BrokenLink[];
  templatePatterns: TemplatePattern[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
}
```

Graph node/edge arrays are derived incrementally from incoming SSE events so the force graph re-renders in real time without rebuilding the entire dataset each tick.

---

## Phase 2 — Multi-Page Agent Pipeline

### Goals

- Take the representative pages produced by the crawler and feed them through the existing audit agent graph
- Stream per-page audit progress live to the frontend
- Add a new `synthesis_node` to LangGraph that crunches findings across all pages and produces site-level insights

---

### 2.1 New Endpoint: `POST /audit/site`

Triggers a full-site audit for a completed crawl session:

```
POST /audit/site
Body:  { session_id: string, page_ids?: string[] }  ← page_ids restricts to a subset
Response: SSE stream
```

The endpoint:
1. Loads all `crawled_pages` rows where `is_template_representative = TRUE` (or the supplied `page_ids` subset) for the given `session_id`.
2. Runs the existing `scout_graph` for each page, one at a time or with controlled concurrency (default 2 pages simultaneously to avoid rate-limit collisions with the LLM APIs).
3. Stores each page's reports in `page_audits` (see Phase 3 schema).
4. After all pages finish, runs the `synthesis_node`.
5. Emits `site_audit_complete` with the synthesis report.

**New SSE event types:**

| Event | Payload |
|---|---|
| `site_audit_started` | `{ session_id, total_pages }` |
| `page_audit_started` | `{ page_index, total_pages, url }` |
| `page_audit_result` | `{ page_index, total_pages, url, reports: { ui, ux, compliance, seo } }` |
| `synthesis_started` | `{}` |
| `synthesis_complete` | `{ synthesis_report }` |
| `site_audit_complete` | `{ session_id, overall_score, duration_ms }` |

---

### 2.2 Synthesis Node

A new `synthesis_node` added to LangGraph (or executed as a sequential post-step after the per-page fan-out completes).

**New `SiteScoutState`:**

```python
class SiteScoutState(TypedDict):
    root_url:         str
    page_reports:     List[Dict]   # list of { url, ui_report, ux_report, compliance_report, seo_report }
    synthesis_report: Dict         # filled by synthesis_node
```

**What `synthesis_node` produces:**

The node sends a condensed JSON digest of all page reports to **Gemini 2.5 Flash** — its large context window handles full cross-page report digests that would overflow Llama 3.3 70B's context limit. The expected structured `synthesis_report` contains:

| Section | Content |
|---|---|
| `seo_site_health` | Average SEO score, pages missing `<h1>`, pages with duplicate `<title>`, thin-content page count, internal linking density map |
| `design_consistency` | UI issues appearing on > 50% of pages (systemic) vs one-off; dominant color/font usage; CTA consistency |
| `compliance_coverage` | Cookie banner presence on all pages; privacy policy reachability; GDPR risk pages |
| `ux_patterns` | Navigation consistency across page types; breadcrumb coverage on deep pages; CTA presence rate |
| `broken_links_summary` | Count + list of broken links grouped by source template |
| `priority_matrix` | Top 10 issues ranked by `severity × frequency` — issues affecting many pages are ranked higher even if individually minor |
| `quick_wins` | Top 3 fixes that would most improve the site-wide average score |

**Scoring:**

Site-wide scores are computed algorithmically (same approach as the per-page SEO score — no LLM hallucination risk):
- `overall_site_score = weighted_mean(per_page_scores)` — pages weighted equally regardless of template
- `consistency_penalty` — deducted when > 30% of pages share the same critical issue (signals a systemic problem that was missed at the template level)

---

### 2.3 Frontend: Multi-Page Audit UI

The multi-page audit result experience is a new page `/analysis/site?session_id=<id>` with two distinct sub-states: **live progress** (while auditing runs) and **completed report** (viewable after all pages finish). The existing single-page `AnalysisDashboard` component is reused as-is to render each page's report — it is not modified.

---

#### Sub-state A: Live Audit Progress

While `POST /audit/site` is streaming, the page shows a progress view:

```
┌──────────────────────────────────────────────────────────────────┐
│  Scout  ›  Auditing: example.com          8 / 12 pages complete  │
│  [████████████████████░░░░░░░░░░░░░░░░░░]  67%                   │
├──────────────────────────────────────────────────────────────────┤
│  Page                         Status      UI   UX   Comp  SEO   │
│  ──────────────────────────────────────────────────────────────  │
│  ● /  (home)                  ✅ done     88   76    90   72    │
│  ● /about                     ✅ done     91   82    88   68    │
│  ● /pricing                   🔄 running…                       │
│  ● /blog/2024/first-post      ⏳ queued                         │
│  ● /products/iphone-15        ⏳ queued   (↳ /products/:slug)   │
│  ● /docs/getting-started      ⏳ queued   (↳ /docs/:slug)       │
│  …                                                               │
├──────────────────────────────────────────────────────────────────┤
│  🧠  Site Synthesis  —  waiting for all pages…                   │
└──────────────────────────────────────────────────────────────────┘
```

- Rows for completed pages are **clickable** even while the audit is still running — users don't have to wait for all pages to read finished reports.
- The synthesis row at the bottom shows `waiting for all pages…` → `running…` → `complete` as its status transitions.
- Score cells are empty (`—`) until the page's `page_audit_result` SSE event arrives, then fill in with animated number counters.

---

#### Sub-state B: Completed Report (two-panel layout)

Once `site_audit_complete` is received (or the page is loaded from a stored audit session), it transitions to a persistent two-panel layout:

```
┌────────────────┬─────────────────────────────────────────────────┐
│  PAGE LIST     │  REPORT PANEL                                   │
│  ──────────    │  ─────────────────────────────────────────────  │
│                │                                                 │
│  📊 Site       │  << content of the selected panel renders here >>│
│     Overview   │                                                 │
│  ─────────     │  When "Site Overview" is selected:             │
│  /             │    → synthesis_report renders (see below)      │
│    88 / 100    │                                                 │
│  /about        │  When a page is selected:                      │
│    82 / 100    │    → full AnalysisDashboard renders for        │
│  /pricing  ◄── │      that page's stored reports                │
│    71 / 100    │    → same UI|UX|Compliance|SEO tab layout       │
│  /blog/…       │      as the existing single-page audit         │
│    79 / 100    │    → entirely read-only (no SSE, from JSON)    │
│  /products/…   │                                                 │
│    65 / 100    │                                                 │
│                │                                                 │
│  ─────────     │                                                 │
│  12 pages      │                                                 │
│  Site: 77/100  │                                                 │
└────────────────┴─────────────────────────────────────────────────┘
```

**Page list (left panel):**
- Each row shows the URL path, the page's composite overall score, and a small 4-segment color bar (one segment per agent: UI/UX/Compliance/SEO).
- The row for the page currently displayed in the right panel is highlighted.
- "Site Overview" is pinned at the top and selected by default when the audit first completes.
- Pages are sorted by overall score ascending (lowest first) so problem pages surface immediately.
- Template representative pages show a subtle `↳ /pattern/:slug` badge.

**Report panel (right panel) — Site Overview tab:**

Renders the `synthesis_report` from the `synthesis_node`:

```
SITE OVERVIEW — example.com                          Overall: 77 / 100

  🏆  Quick Wins
  ┌────────────────────────────────────────────────────────────────┐
  │  1. Add <h1> to 4 pages missing one  (+6 pts avg SEO)         │
  │  2. Fix 3 broken internal links on /pricing and /docs         │
  │  3. Cookie banner missing on 5 pages — GDPR risk              │
  └────────────────────────────────────────────────────────────────┘

  📊  Priority Matrix (top issues by severity × frequency)
       Issue                        Severity  Affects   Score impact
       ─────────────────────────────────────────────────────────────
    1  Missing H1 tag               High      4 pages   ████████
    2  Broken internal link         High      3 pages   ██████
    3  No cookie consent banner     High      5 pages   █████
    4  Images missing alt text      Medium    7 pages   ████
    5  Low word count (thin page)   Medium    3 pages   ███
    …

  🌡  Consistency Heat-map
       Page type       UI   UX   Compliance  SEO
       ─────────────────────────────────────────
       Home            🟢   🟡   🟢          🟡
       Blog posts      🟡   🟢   🔴          🟡
       Product pages   🔴   🟡   🔴          🔴
       Docs pages      🟢   🟢   🟡          🟢

  📈  Per-Agent Site Averages
       UI: 84    UX: 78    Compliance: 69    SEO: 71
```

**Report panel (right panel) — Page report tab:**

When a page row is selected, the right panel renders the existing `AnalysisDashboard` component populated from the stored `page_audits` row (no re-running agents). The component receives reports as props instead of reading SSE, so it behaves identically to the current single-page audit result view — same tabs, same score gauges, same check lists and recommendations.

A breadcrumb at the top of the right panel shows:
```
Site Overview  ›  /pricing  (71 / 100)          [← Prev page]  [Next page →]
```

Prev/Next buttons cycle through the sorted page list, allowing rapid review without returning to the left panel.

---

#### New Components & Changes

| Component / File | What changes |
|---|---|
| `app/analysis/site/page.tsx` | New page. Manages overall state: live progress view vs completed two-panel layout |
| `hooks/useSiteAuditStream.ts` | New hook. Mirrors `useAuditStream` for the `POST /audit/site` SSE stream; accumulates per-page results into a `Map<url, PageReports>` |
| `components/nonprimitive/SiteAuditProgress.tsx` | New component. Renders the live progress table (Sub-state A) |
| `components/nonprimitive/SiteReportLayout.tsx` | New component. Two-panel shell — page list on left, swappable report panel on right |
| `components/nonprimitive/PageListSidebar.tsx` | New component. Sorted page list with score bars and template badges |
| `components/nonprimitive/SiteOverviewReport.tsx` | New component. Renders the synthesis report: quick wins, priority matrix, heat-map, agent averages |
| `components/nonprimitive/AnalysisDashboard.tsx` | **No structural changes.** Accepts an optional `reports` prop (pre-loaded JSON) as an alternative to SSE; when `reports` is provided it renders immediately in read-only mode. |

The `AnalysisDashboard` prop change is minimal — a single optional prop gates whether the component subscribes to SSE or renders from passed-in data. All existing rendering logic stays untouched.

---

## Phase 3 — Supabase Auth & Audit History

### Goals

- Users can sign up and log in (email/password + Google OAuth)
- Crawl sessions, crawled pages, and audit reports are stored per-user
- Users can view a dashboard of all past audits and reload any report without re-running it

---

### 3.1 Supabase Auth Setup

The Supabase project is created and the full database schema (see Section 1.4) is deployed during milestone **1a** — not here. This milestone activates authentication on top of the existing project:

1. Enable **Email/Password + Google OAuth** in the Supabase dashboard under Authentication → Providers.
2. Add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` to `backend/.env` and `frontend/.env.local`.
3. Run the Phase 3 SQL migration: create `profiles`, make `user_id` NOT NULL, enable RLS (Section 3.2).

---

### 3.2 Auth Tables & Row Level Security

All core tables are already defined in Section 1.4. This milestone adds the `profiles` table (which requires `auth.users` to exist), enforces `NOT NULL` on previously nullable `user_id` columns, and enables Row Level Security.

```sql
-- New in Phase 3: user profiles (extends Supabase auth.users)
CREATE TABLE profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Back-fill foreign key references and enforce NOT NULL
ALTER TABLE crawl_sessions
    ADD CONSTRAINT fk_crawl_sessions_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE audit_sessions
    ADD CONSTRAINT fk_audit_sessions_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    ALTER COLUMN user_id SET NOT NULL;
```

#### Row Level Security

All tables get RLS enabled. Access is granted when the row's `user_id` (or its parent session's `user_id`) equals `auth.uid()`.

```sql
-- crawl_sessions
ALTER TABLE crawl_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their crawl sessions"
    ON crawl_sessions USING (user_id = auth.uid());

-- crawled_pages (access via parent session)
ALTER TABLE crawled_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their pages"
    ON crawled_pages
    USING (session_id IN (SELECT id FROM crawl_sessions WHERE user_id = auth.uid()));

-- Repeat the same ownership-chain pattern for:
-- crawled_links, template_patterns, audit_sessions, page_audits.
```

---

### 3.3 Backend JWT Authentication

FastAPI adds a reusable dependency that validates the Supabase-issued JWT on every protected endpoint:

```python
# backend/auth.py
import jwt
from fastapi import Header, HTTPException

async def get_current_user(authorization: str = Header(...)) -> dict:
    try:
        token = authorization.removeprefix("Bearer ")
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload  # contains sub (user_id), email, role
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

All write endpoints (`/crawl`, `/audit`, `/audit/site`) use `Depends(get_current_user)` and attach `user["sub"]` as `user_id` to every DB insert.

---

### 3.4 Frontend Auth

**New dependencies:**
- `@supabase/supabase-js`
- `@supabase/ssr` (Next.js App Router cookie handling)

**New files:**

```
frontend/
  lib/
    supabase/
      client.ts          — browser-side Supabase client (singleton)
      server.ts          — server-side client (cookie-based, for middleware)
  middleware.ts          — Next.js middleware: refresh session, protect routes
  app/
    login/
      page.tsx           — login form
    signup/
      page.tsx           — registration form
    dashboard/
      page.tsx           — audit history list
  hooks/
    useSupabaseSession.ts  — wraps getSession() + onAuthStateChange
```

**Route protection in `middleware.ts`:**

```typescript
// Protects /dashboard, /crawl, /analysis
// Redirects to /login if no active Supabase session
// Refreshes expired access tokens transparently using the refresh token cookie
```

**Auth flow:**

```
/login
  └─► supabase.auth.signInWithPassword({ email, password })
   OR supabase.auth.signInWithOAuth({ provider: 'google' })
        └─► Supabase sets httpOnly session cookies
        └─► redirect to /dashboard

All API calls to FastAPI include:
  Authorization: Bearer <supabase_access_token>
  (retrieved from supabase.auth.getSession())
```

---

### 3.5 Dashboard: Audit History

New `/dashboard` page showing all past audit sessions for the logged-in user:

```
┌──────────────────────────────────────────────────────────────────┐
│  My Audits                                    [+ New Audit]      │
├──────────────────────────────────────────────────────────────────┤
│  Site                   Audited          Score   Pages  Actions  │
│  ─────────────────────────────────────────────────────────────── │
│  example.com            Mar 12 2026       81      12    [View]   │
│  myshop.io              Mar 10 2026       67       8    [View]   │
│  landing.agency.com     Mar  8 2026       74       3    [View]   │
│                                                    [Load more]   │
└──────────────────────────────────────────────────────────────────┘
```

- Data fetched client-side from Supabase directly (no backend hop required — RLS secures the data).
- "View" navigates to `/analysis?audit_session_id=<id>` which loads stored `page_audits` rows from Supabase instead of re-running the agents.
- `AnalysisDashboard` detects the `audit_session_id` param and switches into "read-only" mode (no SSE, renders from stored JSON).

---

## Implementation Sequence

| Phase | Milestone | Key Deliverables |
|---|---|---|
| **1a** | Crawler backend | Supabase project creation, schema deployment (Section 1.4), `backend/crawler/` package, `BFSCrawler`, `TemplateDetector`, `BrokenLinkChecker`, `POST /crawl` SSE endpoint |
| **1b** | Crawler frontend | `useCrawlStream` hook, `CrawlerDashboard` component, live feed list, stats bar |
| **1c** | Site graph visualization | React collapsible tree (no extra library), template-grouped rows, color-coded status dots, inline detail drawer |
| **2a** | Multi-page audit backend | `POST /audit/site`, per-page SSE events, controlled concurrency, `page_audits` writes |
| **2b** | Synthesis node | `SiteScoutState`, `synthesis_node` LangGraph node, Llama/Gemini synthesis prompt, algorithmic site-wide scoring |
| **2c** | Multi-page audit frontend | `/analysis/site` page, `useSiteAuditStream` hook, live progress table (`SiteAuditProgress`), two-panel completed report layout (`SiteReportLayout`, `PageListSidebar`, `SiteOverviewReport`), `AnalysisDashboard` read-only prop |
| **3a** | Auth tables + RLS | Enable auth providers in Supabase dashboard, `profiles` table, `NOT NULL` migration on `user_id`, RLS policies for all tables |
| **3b** | Backend JWT auth | `backend/auth.py` dependency, `user_id` wiring in all write endpoints, replace SQLite with Supabase client |
| **3c** | Frontend auth | Supabase SSR client setup, `middleware.ts`, `/login` page, `/signup` page, `useSupabaseSession` hook |
| **3d** | Dashboard & stored reports | `/dashboard` page, Supabase direct data fetch, read-only mode in `AnalysisDashboard` |

---

## Resolved Design Decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | **Database from Phase 1** | Supabase PostgreSQL from the start — no SQLite, no migration step. Project and schema are set up in milestone 1a. `user_id` columns are nullable until Phase 3 auth ships. |
| 2 | **Site graph visualization** | Simple React collapsible tree (no extra library). Rows are grouped by template pattern and URL depth with color-coded status dots. |
| 3 | **Template sample count** | Default `max_samples_per_template = 3`. A slower, more thorough crawl is preferred — the platform prioritises depth of analysis over speed. |
| 4 | **Synthesis LLM** | Gemini 2.5 Flash. Its large context window handles full cross-page report digests; Llama 3.3 70B would overflow on sites with many representative pages. |
| 5 | **`robots.txt` compliance** | Always respected, no opt-out. Safer for users and avoids terms-of-service liability. |
| 6 | **Single-page Quick Audit** | Removed. All audits go through the full crawl flow. The existing `POST /audit` single-page endpoint is deprecated. |
| 7 | **Re-audit on existing crawl** | Not supported. Each audit requires a fresh crawl session. Stored `page_context` blobs in `crawled_pages` are consumed by the Phase 2 audit pipeline (avoiding a re-scrape), but users cannot trigger agent re-runs on a past crawl from the dashboard. |
