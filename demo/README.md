# Scout AI — Demo Site

A simple multi-page static website designed to test the Scout AI crawler and audit pipeline. The site has a realistic structure with **intentional flaws** spread across every page.

---

## Quick Start

```bash
cd demo
python server.py
```

Then open Scout AI and enter:
```
http://localhost:8080
```

The crawler should discover **14 pages** across 5 sections, detect **2 template patterns**, and flag **5 broken links**.

---

## Site Map

```
/                          — Home
/about/                    — About Us
/pricing/                  — Pricing
/contact/                  — Contact
/blog/                     — Blog listing
/blog/my-first-post/       — Blog post 1  ─┐ template: /blog/:slug/
/blog/second-post-about-things/            ─┤
/blog/third-post-tips-tricks/              ─┘
/products/                 — Products listing
/products/widget-pro-edition/    ─┐ template: /products/:slug/
/products/widget-lite-edition/   ─┤
/products/widget-ultra-edition/  ─┘
/docs/getting-started/     — Documentation
```

---

## Intentional Flaws

### Broken Links (HTTP 404)
| Link target | Found on |
|---|---|
| `/team/` | Home nav, About page |
| `/signup/` | Pricing page (all CTA buttons), Product pages |
| `/careers/` | Widget Ultra product page |
| `/press/` | About page, Home footer |
| `/docs/advanced-configuration/` | Docs getting-started page |

### SEO Issues
| Page | Issue |
|---|---|
| `/about/` | No `<h1>` tag (uses `<h2>` instead) |
| `/about/` | Missing `<meta name="description">` |
| `/pricing/` | Missing `<meta name="description">` |
| `/contact/` | Missing `<meta name="description">` |
| `/contact/` | No `<h1>` tag |
| `/blog/my-first-post/` | Missing `<meta name="description">` |
| `/blog/second-post-about-things/` | Missing `<meta name="description">` + duplicate `<title>` |
| `/blog/third-post-tips-tricks/` | Missing `<meta name="description">` + duplicate `<title>` + thin content |
| `/products/widget-pro-edition/` | Missing `<meta name="description">` |
| `/products/widget-lite-edition/` | Duplicate `<title>` + missing meta desc |
| `/products/widget-ultra-edition/` | Duplicate `<title>` + missing meta desc |

### Accessibility Issues
| Page | Issue |
|---|---|
| `/` | Feature icon `<img>` missing `alt` attribute |
| `/contact/` | All form `<input>` fields missing associated `<label>` elements |
| `/products/widget-pro-edition/` | Product hero `<img>` missing `alt` attribute |
| `/products/widget-lite-edition/` | Product hero `<img>` missing `alt` attribute |
| `/products/widget-ultra-edition/` | Product hero `<img>` missing `alt` attribute |

### Compliance Issues
| Issue | Affects |
|---|---|
| No cookie consent banner | Entire site |
| No privacy policy link | Entire site |
| Contact form has no GDPR / data processing notice | `/contact/` |
| Contact form `<button>` missing `type="submit"` | `/contact/` |

### Technical / UX Issues
| Page | Issue |
|---|---|
| `/contact/` | Missing `lang` attribute on `<html>` |
| `/contact/` | Missing `<meta name="viewport">` |
| `/products/widget-pro-edition/` | No breadcrumb navigation |
| `/products/widget-lite-edition/` | No breadcrumb navigation |
| `/products/widget-ultra-edition/` | No breadcrumb navigation |
| `/docs/getting-started/` | No breadcrumb navigation |
| `/about/` | Inconsistent nav item order |
| `/blog/third-post-tips-tricks/` | Extremely thin content (< 100 words, mostly a list) |
| `/pricing/` | Low-contrast "special offer" button (white text on yellow) |

---

## Expected Crawler Behaviour

| Metric | Expected value |
|---|---|
| Total pages discovered | 14 |
| Pages visited (non-template) | ~9 |
| Pages skipped (template dedup) | ~5 (2 per group after first) |
| Template patterns detected | 2 (`/blog/:slug/`, `/products/:slug/`) |
| Broken links flagged | 5 unique targets |

> **Note**: Template detection triggers once ≥ 2 pages share the same URL pattern. The first page in each group is marked `is_template_representative = TRUE` and queued for auditing. Subsequent pages in the same group are skipped to avoid duplicate analysis.

---

## Stopping the Server

Press `Ctrl+C` in the terminal running `server.py`.
