import base64
import logging
import time
from html.parser import HTMLParser

import httpx
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

log = logging.getLogger("scout")


class _AccessibilityChecker(HTMLParser):
    """Lightweight HTML parser to extract accessibility signals from rendered DOM."""

    def __init__(self):
        super().__init__()
        self.img_total = 0
        self.img_missing_alt = 0
        self.headings = []
        self.total_inputs = 0
        self.labeled_inputs = 0
        self.aria_roles = []
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


def capture_website_context(url: str, viewport_width: int = 1280, viewport_height: int = 800) -> dict:
    """Use a headless Chromium browser to render a page and return its context.

    Returns a dict with keys:
        url, dom, screenshot_base64, accessibility_summary, final_url
    On error the dict will have an 'error' key instead.
    """
    html = ""
    screenshot_base64 = None
    final_url = url

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
                log.warning("[scraper] domcontentloaded timeout after %.1fs — using partial content", time.perf_counter() - t0)

            final_url = page.url
            log.info("[scraper] final url: %s", final_url)

            log.info("[scraper] extracting DOM")
            html = page.content()
            log.info("[scraper] DOM size: %d chars", len(html))

            log.info("[scraper] taking screenshot")
            t1 = time.perf_counter()
            screenshot_bytes = page.screenshot(full_page=True)
            screenshot_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            log.info("[scraper] screenshot done  %.1fs  size=%d bytes", time.perf_counter() - t1, len(screenshot_bytes))

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
            log.info("[scraper] HTTP fallback OK  status=%d  size=%d chars", resp.status_code, len(html))
        except Exception as http_exc:
            log.error("[scraper] HTTP fallback also failed: %s", http_exc)
            return {
                "url": url,
                "error": f"Playwright: {exc} | HTTP fallback: {http_exc}",
                "dom": "",
                "screenshot_base64": None,
                "accessibility_summary": {},
            }

    checker = _AccessibilityChecker()
    checker.feed(html)

    accessibility_summary = {
        "images_total": checker.img_total,
        "images_missing_alt": checker.img_missing_alt,
        "heading_hierarchy": checker.headings,
        "has_viewport_meta": checker.has_viewport_meta,
        "total_inputs": checker.total_inputs,
        "labeled_inputs": checker.labeled_inputs,
        "aria_roles_found": list(set(checker.aria_roles)),
    }

    return {
        "url": url,
        "dom": html,
        "screenshot_base64": screenshot_base64,
        "accessibility_summary": accessibility_summary,
        "final_url": final_url,
    }
