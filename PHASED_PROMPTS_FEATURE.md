# Feature Plan: Phased AI Fix Prompts

## Overview

After a site audit (single-page `/audit` or multi-page `/audit/site`), Scout.ai generates a **series of prioritised, copy-paste-ready prompts** that the vibe coder can feed directly to their AI coding agent (Cursor, Copilot, etc.) to fix every detected issue — phase by phase.

---

## Why Phased Prompts (not a Master Prompt)

| Master Prompt | Phased Prompts |
|---|---|
| Agent loses focus across too many domains at once | Each prompt is single-domain → clean execution |
| No natural checkpoint to verify fixes | Coder can test/commit after each phase |
| Context window bloat on large sites | Each prompt stays concise |
| Fixing SEO may break UI simultaneously | Phases are sequenced to avoid conflicts |

---

## Phase Structure

| Phase | Domain | Source Agent(s) | Priority |
|---|---|---|---|
| **1 — Critical Fixes** | Broken links, missing meta, security headers | All agents (critical/high severity only) | Highest |
| **2 — Security** | XSS, CSP, insecure cookies, exposed secrets | `security_agent` | Critical |
| **3 — Compliance** | GDPR, CCPA, WCAG, cookie consent, privacy policy | `compliance_agent` | High |
| **4 — SEO** | Titles, descriptions, structured data, crawlability | `seo_agent` | High |
| **5 — UX** | Navigation, accessibility, friction points | `ux_agent` | Medium |
| **6 — UI Polish** | Layout, typography, colour coherence, responsiveness | `ui_agent` | Low |

> Phase 1 is a **cross-agent triage pass** — it pulls critical/high-severity items from every report so the coder fixes showstoppers first regardless of domain.

---

## Data Already Available (No New Scraping Needed)

Each agent already returns structured data that maps directly to prompt generation:

```
ui_report       → overall_score, layout_spacing, responsiveness, typography,
                  color_coherence, recommendations[]
ux_report       → overall_score, accessibility, ux_friction, navigation_ia,
                  inclusivity, recommendations[]
seo_report      → overall_score, universal_factors{}, intent_alignment,
                  recommendations[]
compliance_report → overall_risk_score, data_privacy, legal_transparency,
                   accessibility_compliance, critical_violations[]
security_report → overall_score, findings[]{severity, title, description,
                  recommendation, category}
```

For **multi-page audits** (`/audit/site`), each page returns the same structure.  
The prompt generator must **aggregate across pages** — grouping identical or similar issues so the prompt says "fix this pattern across all pages" rather than repeating per-URL.

---

## Backend Implementation

### 1. New Module: `backend/prompt_generator.py`

```python
def generate_phased_prompts(
    audit_results: dict,          # single-page: one result dict
    multi_page: bool = False,     # True when called from /audit/site
    site_url: str = "",
) -> list[dict]:
    """
    Returns a list of phase objects:
    [
      {
        "phase": 1,
        "title": "Critical Fixes",
        "issue_count": <int>,
        "prompt": "<ready-to-paste prompt string>"
      },
      ...
    ]
    Phases with zero issues are omitted from the output.
    """
```

**Aggregation logic for multi-page:**
- Collect all `recommendations[]` and `critical_violations[]` across every page result
- Deduplicate by semantic similarity (simple: exact string dedup first, then prefix dedup)
- Group by domain (UI / UX / SEO / Compliance / Security)
- Tag recurring issues with `"Affects N pages"` in the prompt

### 2. Prompt Template per Phase

Each generated prompt follows this structure:

```
You are fixing a website at {site_url}.

## Issues to fix ({N} issues found)

### [Category]
- {issue description}   [Affects {n} pages]
- ...

## Instructions
- Fix each issue listed above.
- Do NOT change any functionality or content that isn't listed.
- After all fixes, run a quick manual check on mobile viewport.
- Commit as: "fix: phase {N} — {title}"
```

**Key constraint in the prompt:** explicitly tells the agent what NOT to touch — prevents cascading breakage between phases.

### 3. New API Endpoint: `POST /audit/prompts`

```python
class PromptsRequest(BaseModel):
    # For single-page audits
    ui_report:          Optional[dict] = None
    ux_report:          Optional[dict] = None
    seo_report:         Optional[dict] = None
    compliance_report:  Optional[dict] = None
    security_report:    Optional[dict] = None
    # For multi-page audits
    pages:              Optional[list[dict]] = None   # list of per-page audit results
    site_url:           str = ""

@app.post("/audit/prompts")
async def generate_prompts(req: PromptsRequest):
    """
    Accepts either a single-page audit result or a list of page audit
    results (from /audit/site) and returns phased prompts.
    Non-streaming — fast, pure computation.
    """
```

> **No new LLM call needed.** The prompt is assembled deterministically from existing structured report data — fast and free.

### 4. Wire into `/audit/site` response (optional convenience)

Add `"phased_prompts"` to the `site_audit_complete` SSE event so the frontend receives it automatically without a second request:

```python
yield _sse({
    "type":              "site_audit_complete",
    ...existing fields...,
    "phased_prompts":    generate_phased_prompts(aggregated_results, multi_page=True, site_url=root_url),
})
```

---

## Frontend Implementation

### 1. New Component: `PhasedPrompts.tsx`

Location: `frontend/components/nonprimitive/PhasedPrompts.tsx`

**UI layout:**
```
┌────────────────────────────────────────────────────┐
│  Your Fix Roadmap  (6 phases · 42 issues)          │
├────────────────────────────────────────────────────┤
│  ● Phase 1 — Critical Fixes          [8 issues]    │
│  ● Phase 2 — Security                [5 issues]    │
│  ● Phase 3 — Compliance              [3 issues]    │
│  ● Phase 4 — SEO                     [12 issues]   │
│  ● Phase 5 — UX                      [9 issues]    │
│  ● Phase 6 — UI Polish               [5 issues]    │
└────────────────────────────────────────────────────┘

[Expanded phase card]
┌──────────────────────────────────────────────────────────┐
│ Phase 4 — SEO  ·  12 issues                              │
│                                                          │
│ You are fixing a website at https://example.com...       │
│ ...                                                      │
│                               [Copy Prompt]  [Download]  │
└──────────────────────────────────────────────────────────┘
```

**Interactions:**
- Click a phase card → expands to show the full prompt
- **Copy Prompt** button → copies to clipboard with one click
- **Download** button → downloads as `.md` or `.txt` file
- Phase cards show a severity colour (red = critical, amber = medium, green = polish)

### 2. Integration points

| Existing page | Change |
|---|---|
| `frontend/app/analysis/page.tsx` | Add `<PhasedPrompts>` below the existing report cards (single-page audit) |
| `frontend/components/nonprimitive/SiteAuditResults.tsx` | Add `<PhasedPrompts>` at the bottom of the full site audit view |
| `frontend/components/nonprimitive/AnalysisDashboard.tsx` | Pass `phased_prompts` data down as prop |

### 3. Hook / data fetching

If prompts are **not** bundled in the SSE event, add a call after audit completes:

```typescript
// In useAuditStream.ts / useSiteAuditStream.ts
// After receiving "site_audit_complete" or "result" event:
const promptsRes = await fetch("/audit/prompts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pages: auditPages, site_url: rootUrl }),
});
const { phases } = await promptsRes.json();
setPhasedPrompts(phases);
```

---

## Multi-Page Specific Considerations

1. **Aggregation before prompting** — Don't list 50 URLs with the same missing `<meta description>`. Deduplicate and say: *"Add unique meta descriptions to all pages — currently missing on 47/50 pages."*

2. **Template-aware grouping** — The crawler already detects URL templates (e.g. `/blog/*`). Use the template pattern to group: *"Fix the blog post template — affects all ~30 blog pages."*

3. **Per-page vs site-wide prompts** — Some issues (e.g. missing privacy policy) are site-wide. Others (e.g. a specific broken image on `/contact`) are page-specific. The generator should split these and surface site-wide ones more prominently.

4. **Issue count cap per phase** — Cap each phase prompt at ~15 actionable items. If there are more, split into sub-phases (Phase 4a, 4b) or note "showing top 15 by severity."

---

## Implementation Order

```
Step 1  backend/prompt_generator.py         — core aggregation + prompt assembly logic
Step 2  backend/main.py                     — POST /audit/prompts endpoint
Step 3  backend/main.py                     — append phased_prompts to site_audit_complete event
Step 4  frontend/components/.../PhasedPrompts.tsx  — UI component
Step 5  frontend/app/analysis/page.tsx      — wire in for single-page audit
Step 6  frontend/components/.../SiteAuditResults.tsx — wire in for multi-page audit
Step 7  Test with demo site                  — verify prompt quality end-to-end
```

---

## Out of Scope (for this feature)

- No new LLM calls — prompts are assembled from existing structured data
- No database schema changes — prompts are generated on-the-fly, not persisted
- No changes to existing agent logic
- No changes to the crawler

