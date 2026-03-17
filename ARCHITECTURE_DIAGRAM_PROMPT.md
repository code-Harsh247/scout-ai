# Scout.ai — Architecture Diagram

Generate a clean, high-level architecture diagram using **labeled colored boxes** and **labeled arrows**. No code or endpoint detail needed — just the flow between major components.

**Color guide:**
- Blue → Next.js Frontend
- Dark Purple → FastAPI + LangGraph
- **Bright Teal → DigitalOcean Gradient AI ★ (make this the most visually prominent box)**
- Orange → Google Gemini
- Green → BFS Crawler
- Charcoal → Supabase

---

## Components

**[User]**
Enters a website URL into the browser.

**[Next.js Frontend]** — Blue
Displays live crawl graph, screenshots, audit scores, and a 6-phase fix roadmap.
Consumes real-time SSE streams from the backend.

**[FastAPI Backend]** — Dark Purple
Validates JWT auth via Supabase. Orchestrates all pipelines. Streams results back to the frontend via SSE.

**[LangGraph Orchestrator]** — Dark Purple
Typed AI workflow. First runs the Scrape Node, then fans out to 5 agents in parallel:

```
[Scrape Node — Playwright + BeautifulSoup]
  (captures screenshot + DOM)
        │
        ├──► [UI Auditor]          ──► [Google Gemini 2.5 Flash]          (Orange)
        │
        ├──► [UX Auditor]          ──► ┐
        ├──► [Compliance Auditor]  ──► ┼──► [DigitalOcean Gradient AI ★]  (Teal)
        ├──► [SEO Auditor]         ──► ┘    Llama 3.3 70B Instruct
        │
        └──► [Security Auditor]    ──► Passive scanner (no AI)
```

**[DigitalOcean Gradient AI ★]** — Bright Teal — PRIMARY AI PROVIDER
Hosts Llama 3.3 70B Instruct. Powers UX, Compliance, and SEO agents via the `gradient-adk` SDK.

**[Google Gemini 2.5 Flash]** — Orange
Vision model. Analyzes the Playwright screenshot visually for the UI audit.

**[BFS Crawler]** — Green
Async breadth-first site crawler using Playwright. Contains:
- **Template Detector** — deduplicates similar page layouts (e.g. `/blog/:slug`)
- **Broken Link Checker** — HEAD-checks every discovered link

**[Prompt Generator]**
No AI. Takes all audit results and deterministically produces a 6-phase fix roadmap:
Critical → Security → Compliance → SEO → UX → UI Polish

**[Supabase]** — Charcoal
PostgreSQL database (crawl history, audit results) + JWT Auth.

---

## Flow Diagram

```
[User]
  │  enters URL
  ▼
[Next.js Frontend] ◄─────────── SSE live stream (results) ────────────────────┐
  │  request + JWT token                                                       │
  ▼                                                                            │
[FastAPI Backend] ──── validates JWT ────► [Supabase Auth]                    │
  │                                                                            │
  ├──► [BFS Crawler]                                                           │
  │       ├── [Template Detector]                                              │
  │       ├── [Broken Link Checker]                                            │
  │       └── saves data ──► [Supabase DB]                                     │
  │                                                                            │
  └──► [LangGraph Orchestrator]                                                │
            │                                                                  │
            ▼                                                                  │
       [Scrape Node — Playwright]                                              │
       (screenshot + DOM)                                                      │
            │                                                                  │
            ├──► [UI Auditor] ──────────────► [Google Gemini 2.5 Flash]       │
            │                                                                  │
            ├──► [UX Auditor]  ─────────────► ┐                               │
            ├──► [Compliance Auditor] ────────►┼──► [DigitalOcean Gradient AI ★]
            ├──► [SEO Auditor] ───────────────►┘    Llama 3.3 70B             │
            │                                                                  │
            └──► [Security Auditor — Passive Scanner]                         │
                                                                               │
            All results ──► [Prompt Generator] ──► 6-phase fix roadmap ───────┘
```
