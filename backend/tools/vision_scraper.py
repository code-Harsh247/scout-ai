import base64
import logging
import time
from html.parser import HTMLParser
from typing import Any, Dict, List

import httpx
from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from tools.evidence_collector import collect_evidence

log = logging.getLogger("scout")


# ---------------------------------------------------------------------------
# Accessibility Checker (lightweight, tag-level pass)
# ---------------------------------------------------------------------------

class _AccessibilityChecker(HTMLParser):
    """Lightweight HTML parser to extract accessibility signals from rendered DOM."""

    def __init__(self):
        super().__init__()
        self.img_total = 0
        self.img_missing_alt = 0
        self.headings: List[str] = []
        self.total_inputs = 0
        self.labeled_inputs = 0
        self.aria_roles: List[str] = []
        self.has_viewport_meta = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == "img":
            self.img_total += 1
            alt = attrs_dict.get("alt")
            if alt is None or alt.strip() == "":
                self.img_missing_alt += 1

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.headings.append(tag)

        if tag == "meta" and attrs_dict.get("name", "").lower() == "viewport":
            self.has_viewport_meta = True

        if tag == "input" and attrs_dict.get("type", "text") not in (
            "hidden",
            "submit",
            "button",
            "image",
        ):
            self.total_inputs += 1
            if (
                "aria-label" in attrs_dict
                or "aria-labelledby" in attrs_dict
                or "id" in attrs_dict
            ):
                self.labeled_inputs += 1

        role = attrs_dict.get("role")
        if role:
            self.aria_roles.append(role)


# ---------------------------------------------------------------------------
# Rich Content Extractor (semantic, BeautifulSoup-based)
# ---------------------------------------------------------------------------

def _extract_rich_context(html: str) -> Dict[str, Any]:
    """
    Uses BeautifulSoup to extract high-signal semantic content from rendered HTML.
    Returns a dict of enriched fields to be merged into the page context.
    """
    if not html:
        return {}

    soup = BeautifulSoup(html, "html.parser")

    # --- 1. Visible Text (scripts + styles stripped) ---
    for tag in soup(["script", "style", "noscript", "svg", "path"]):
        tag.decompose()
    raw_text = soup.get_text(separator=" ", strip=True)
    # Collapse whitespace
    visible_text = " ".join(raw_text.split())[:8000]

    # --- 2. Structured Headings (tag + actual text) ---
    headings: List[Dict[str, str]] = []
    for h_tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        text = h_tag.get_text(separator=" ", strip=True)
        if text:
            headings.append({"tag": h_tag.name, "text": text[:200]})

    # --- 3. All Links (text + href, deduplicated, capped at 100) ---
    seen_hrefs = set()
    all_links: List[Dict[str, str]] = []
    for a_tag in soup.find_all("a", href=True):
        href = a_tag.get("href", "").strip()
        link_text = a_tag.get_text(separator=" ", strip=True)[:120]
        if href and href not in seen_hrefs:
            seen_hrefs.add(href)
            all_links.append({"text": link_text, "href": href})
        if len(all_links) >= 100:
            break

    # --- 4. Meta Tags (name/property → content dictionary) ---
    meta_tags: Dict[str, str] = {}
    for meta in soup.find_all("meta"):
        key = meta.get("name") or meta.get("property")
        content = meta.get("content", "").strip()
        if key and content:
            meta_tags[key.lower()] = content[:300]

    return {
        "visible_text": visible_text,
        "headings": headings,
        "all_links": all_links,
        "meta_tags": meta_tags,
    }


# ---------------------------------------------------------------------------
# Main Scraper Entry Point
# ---------------------------------------------------------------------------

def capture_website_context(url: str, viewport_width: int = 1280, viewport_height: int = 800) -> dict:
    """Use a headless Chromium browser to render a page and return enriched context.

    Returns a dict with keys:
        url, dom, screenshot_base64, accessibility_summary, final_url,
        visible_text, headings, all_links, meta_tags,
        page_timing_ms, computed_styles
    On hard error the dict will have an 'error' key instead.
    """
    html = ""
    screenshot_base64 = None
    screenshot_bytes = b""
    final_url = url
    page_timing_ms: Dict[str, Any] = {}
    computed_styles: Dict[str, str] = {}
    evidence_blobs: Dict[str, list] = {}

    try:
        with sync_playwright() as p:
            log.info("[scraper] launching browser")
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                viewport={"width": viewport_width, "height": viewport_height},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )

            log.info("[scraper] navigating to %s", url)
            t0 = time.perf_counter()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                log.info("[scraper] page loaded in %.1fs", time.perf_counter() - t0)
            except PlaywrightTimeoutError:
                log.warning(
                    "[scraper] domcontentloaded timeout after %.1fs — using partial content",
                    time.perf_counter() - t0,
                )

            final_url = page.url
            log.info("[scraper] final url: %s", final_url)

            # --- DOM ---
            log.info("[scraper] extracting DOM")
            html = page.content()
            log.info("[scraper] DOM size: %d chars", len(html))

            # --- Screenshot ---
            log.info("[scraper] taking screenshot")
            t1 = time.perf_counter()
            screenshot_bytes = page.screenshot(full_page=True)
            screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            log.info(
                "[scraper] screenshot done  %.1fs  size=%d bytes",
                time.perf_counter() - t1,
                len(screenshot_bytes),
            )

            # --- Page Timing via JS Performance API ---
            try:
                timing = page.evaluate(
                    """() => {
                        const t = performance.timing;
                        const nav = performance.getEntriesByType('navigation')[0];
                        return {
                            dom_content_loaded: Math.round(t.domContentLoadedEventEnd - t.navigationStart),
                            load: Math.round(t.loadEventEnd - t.navigationStart),
                            ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
                            dom_interactive: Math.round(t.domInteractive - t.navigationStart)
                        };
                    }"""
                )
                page_timing_ms = timing or {}
                log.info("[scraper] page timing: %s", page_timing_ms)
            except Exception as e:
                log.warning("[scraper] Failed to extract page timing: %s", e)

            # --- Computed Styles (body font/background) ---
            try:
                styles = page.evaluate(
                    """() => {
                        const body = document.body;
                        if (!body) return {};
                        const cs = window.getComputedStyle(body);
                        return {
                            body_font_family: cs.fontFamily,
                            body_font_size: cs.fontSize,
                            body_background_color: cs.backgroundColor,
                            body_color: cs.color,
                            body_line_height: cs.lineHeight
                        };
                    }"""
                )
                computed_styles = styles or {}
                log.info("[scraper] computed styles extracted")
            except Exception as e:
                log.warning("[scraper] Failed to extract computed styles: %s", e)

            # --- Evidence Collection (must happen before browser.close) ---
            if screenshot_bytes:
                try:
                    evidence_blobs = collect_evidence(page, screenshot_bytes)
                    log.info("[scraper] evidence collection complete")
                except Exception as e:
                    log.warning("[scraper] Evidence collection failed: %s", e)

            browser.close()

    except Exception as exc:
        log.warning("[scraper] Playwright failed: %s — trying HTTP fallback", exc)
        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            }
            resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=30)
            html = resp.text
            final_url = str(resp.url)
            log.info(
                "[scraper] HTTP fallback OK  status=%d  size=%d chars",
                resp.status_code,
                len(html),
            )
        except Exception as http_exc:
            log.error("[scraper] HTTP fallback also failed: %s", http_exc)
            return {
                "url": url,
                "error": f"Playwright: {exc} | HTTP fallback: {http_exc}",
                "dom": "",
                "screenshot_base64": None,
                "accessibility_summary": {},
                "visible_text": "",
                "headings": [],
                "all_links": [],
                "meta_tags": {},
                "page_timing_ms": {},
                "computed_styles": {},
                "evidence_blobs": {},
            }

    # --- Accessibility Summary (tag-level, lightweight) ---
    checker = _AccessibilityChecker()
    checker.feed(html)

    accessibility_summary = {
        "images_total": checker.img_total,
        "images_missing_alt": checker.img_missing_alt,
        "heading_hierarchy": checker.headings,   # ["h1", "h2", ...] — tag order
        "has_viewport_meta": checker.has_viewport_meta,
        "total_inputs": checker.total_inputs,
        "labeled_inputs": checker.labeled_inputs,
        "aria_roles_found": list(set(checker.aria_roles)),
    }

    # --- Rich Semantic Context (BeautifulSoup-based) ---
    rich_ctx = _extract_rich_context(html)

    return {
        "url": url,
        "dom": html,
        "screenshot_base64": screenshot_base64,
        "accessibility_summary": accessibility_summary,
        "final_url": final_url,
        # Enriched fields
        "visible_text": rich_ctx.get("visible_text", ""),
        "headings": rich_ctx.get("headings", []),
        "all_links": rich_ctx.get("all_links", []),
        "meta_tags": rich_ctx.get("meta_tags", {}),
        "page_timing_ms": page_timing_ms,
        "computed_styles": computed_styles,
        "evidence_blobs": evidence_blobs,
    }
