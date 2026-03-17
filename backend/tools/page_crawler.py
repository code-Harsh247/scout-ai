"""
page_crawler.py — Recursive BFS site crawler for Scout.ai multi-page analysis.

Features:
  - BFS up to `max_depth` hops from the root URL
  - `visited` set (normalised URLs) prevents revisiting the same page
  - `seen_templates` set deduplicates same-template pages
    (e.g. /products/keyboard-1 and /products/keyboard-2 → one representative)
  - Classifies each discovered page by type using URL pattern heuristics
"""

import logging
import re
from collections import deque
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("scout")

# ---------------------------------------------------------------------------
# Page type classifier — ordered by specificity (most specific first)
# ---------------------------------------------------------------------------

_PAGE_TYPE_PATTERNS: list[tuple[str, str]] = [
    (r"/login|/signin|/sign-in|/auth(?!/or)",       "Login Page"),
    (r"/signup|/register|/sign-up|/join|/create-account", "Sign-up Page"),
    (r"/checkout|/cart|/payment|/order",             "Checkout Page"),
    (r"/pricing|/plans|/subscription|/upgrade",      "Pricing Page"),
    (r"/dashboard|/account|/profile|/settings",      "App / Dashboard"),
    (r"/product|/shop|/store|/item|/catalog|/catalogue", "Product Page"),
    (r"/blog|/news|/articles|/posts|/insights",      "Blog / Content"),
    (r"/about|/about-us|/team|/story|/mission",      "About Page"),
    (r"/contact|/support|/help|/faq",                "Contact Page"),
    (r"/terms|/privacy|/legal|/cookie",              "Legal Page"),
    (r"^/?$|/home/?$|/index",                        "Landing Page"),
]

_SKIP_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".zip", ".tar", ".gz", ".exe", ".dmg",
    ".xml", ".json", ".csv", ".txt", ".rss",
    ".mp4", ".mp3", ".webm", ".ogg",
    ".woff", ".woff2", ".ttf", ".eot",
    ".js", ".css",
}

_SLUG_RE = re.compile(
    r"^(?:"
    r"[a-z0-9][-a-z0-9_]*\d[-a-z0-9_]*"   # contains a digit (e.g. keyboard-1)
    r"|[a-z0-9]+(?:-[a-z0-9]+){2,}"         # 3+ hyphen-separated words (e.g. my-blog-post)
    r"|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"  # UUID
    r"|[0-9]+"                               # pure numeric ID
    r")$",
    re.IGNORECASE,
)

_TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term",
                    "utm_content", "ref", "referrer", "fbclid", "gclid",
                    "_ga", "source"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def classify_page_type(path: str) -> str:
    """Return a human-readable page type label for a URL path."""
    p = path.lower()
    for pattern, label in _PAGE_TYPE_PATTERNS:
        if re.search(pattern, p):
            return label
    return "Other"


def normalise_url(url: str) -> str:
    """
    Normalise a URL for deduplication:
    - lowercase scheme and host
    - strip fragment
    - strip tracking query params
    - remove trailing slash from path (except bare root)
    """
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        # Strip tracking params, sort remainder for stable key
        from urllib.parse import parse_qs, urlencode
        qs = parse_qs(parsed.query, keep_blank_values=False)
        clean_qs = {k: v for k, v in qs.items() if k.lower() not in _TRACKING_PARAMS}
        clean_query = urlencode(sorted((k, v[0]) for k, v in clean_qs.items()))
        normed = urlunparse((
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            "",             # params
            clean_query,
            "",             # fragment stripped
        ))
        return normed
    except Exception:
        return url.lower()


def url_template(url: str) -> str:
    """
    Replace dynamic slug-like path segments with {slug} so that
    /products/keyboard-1 and /products/keyboard-2 share the same template key.
    """
    try:
        parsed = urlparse(url)
        path = parsed.path
        segments = path.split("/")
        templated = []
        for seg in segments:
            if seg and _SLUG_RE.match(seg):
                templated.append("{slug}")
            else:
                templated.append(seg)
        tmpl_path = "/".join(templated)
        return f"{parsed.scheme}://{parsed.netloc.lower()}{tmpl_path}"
    except Exception:
        return url.lower()


def _is_same_domain(link_url: str, root_netloc: str) -> bool:
    try:
        return urlparse(link_url).netloc.lower() == root_netloc.lower()
    except Exception:
        return False


def _has_skipped_extension(path: str) -> bool:
    lower = path.lower()
    return any(lower.endswith(ext) for ext in _SKIP_EXTENSIONS)


def _extract_internal_links(html: str, base_url: str, root_netloc: str) -> list[str]:
    """Parse HTML and return absolute same-domain hrefs."""
    soup = BeautifulSoup(html, "html.parser")
    links: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        abs_url = urljoin(base_url, href)
        parsed = urlparse(abs_url)
        # same domain only
        if not _is_same_domain(abs_url, root_netloc):
            continue
        # no unwanted file extensions
        if _has_skipped_extension(parsed.path):
            continue
        # http/https only
        if parsed.scheme not in ("http", "https"):
            continue
        links.append(abs_url)
    return links


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def discover_pages(
    root_url: str,
    max_pages: int = 6,
    max_depth: int = 3,
    timeout: float = 15.0,
) -> list[dict]:
    """
    BFS-crawl `root_url` and return up to `max_pages` unique page templates.

    Returns:
        [{"url": str, "page_type": str}, ...]
    """
    root_netloc = urlparse(root_url).netloc.lower()
    if not root_netloc:
        log.error("[crawler] Invalid root URL: %s", root_url)
        return [{"url": root_url, "page_type": "Landing Page"}]

    log.info("")
    log.info("=" * 70)
    log.info("[crawler] BFS CRAWL START")
    log.info("[crawler]   root_url   : %s", root_url)
    log.info("[crawler]   root_domain: %s", root_netloc)
    log.info("[crawler]   max_pages  : %d", max_pages)
    log.info("[crawler]   max_depth  : %d", max_depth)
    log.info("=" * 70)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    visited: set[str] = set()           # normalised URL → already crawled
    seen_templates: set[str] = set()    # url_template → representative already picked
    results: list[dict] = []

    # BFS queue: (absolute_url, depth)
    queue: deque[tuple[str, int]] = deque()

    norm_root = normalise_url(root_url)
    tmpl_root = url_template(root_url)
    visited.add(norm_root)
    seen_templates.add(tmpl_root)
    queue.append((root_url, 0))

    log.info("[crawler] INIT  visited={%s}  template={%s}", norm_root, tmpl_root)
    log.info("[crawler] Queue: [%s (depth 0)]", root_url)
    log.info("")

    step = 0
    while queue and len(results) < max_pages:
        current_url, depth = queue.popleft()
        step += 1

        log.info("─" * 70)
        log.info("[crawler] STEP %d  depth=%d/%d  results=%d/%d  queue_remaining=%d",
                 step, depth, max_depth, len(results), max_pages, len(queue))
        log.info("[crawler] ▶ Processing: %s", current_url)

        # Fetch the page
        try:
            resp = httpx.get(current_url, headers=headers,
                             follow_redirects=True, timeout=timeout)
            html = resp.text
            final_url = str(resp.url)
            log.info("[crawler]   HTTP %d  size=%.1f KB  final_url=%s",
                     resp.status_code, len(html) / 1024, final_url)
        except Exception as exc:
            log.warning("[crawler]   ✗ FETCH FAILED: %s", exc)
            continue

        # Classify and record
        path = urlparse(final_url).path
        page_type = classify_page_type(path)
        results.append({"url": final_url, "page_type": page_type})
        log.info("[crawler]   ✓ ACCEPTED — type='%s'  path='%s'", page_type, path)
        log.info("[crawler]   Results so far: %s",
                 [(r["page_type"], r["url"]) for r in results])

        # Don't recurse past max_depth
        if depth >= max_depth:
            log.info("[crawler]   ⚑ Max depth reached (%d) — not following links from this page", max_depth)
            continue

        # Extract links and enqueue unseen templates
        child_links = _extract_internal_links(html, final_url, root_netloc)
        log.info("[crawler]   Found %d same-domain links on this page:", len(child_links))

        enqueued_count = 0
        for link in child_links:
            norm = normalise_url(link)
            tmpl = url_template(link)

            if norm in visited:
                log.info("[crawler]     SKIP (already visited)  %s", link)
                continue
            if tmpl in seen_templates:
                log.info("[crawler]     SKIP (duplicate template '%s')  %s", tmpl, link)
                continue

            visited.add(norm)
            seen_templates.add(tmpl)
            queue.append((link, depth + 1))
            enqueued_count += 1
            log.info("[crawler]     ✚ ENQUEUE depth=%d  template='%s'  url=%s",
                     depth + 1, tmpl, link)

        log.info("[crawler]   Enqueued %d new URLs  |  visited=%d  templates=%d  queue=%d",
                 enqueued_count, len(visited), len(seen_templates), len(queue))

    log.info("")
    log.info("=" * 70)
    log.info("[crawler] BFS CRAWL COMPLETE")
    log.info("[crawler]   Reason stopped: %s",
             "max_pages reached" if len(results) >= max_pages else "queue exhausted")
    log.info("[crawler]   Pages discovered: %d", len(results))
    log.info("[crawler]   Total URLs visited (set size): %d", len(visited))
    log.info("[crawler]   Unique templates seen: %d", len(seen_templates))
    log.info("[crawler]   Final results:")
    for i, r in enumerate(results):
        log.info("[crawler]     %d. [%s] %s", i + 1, r["page_type"], r["url"])
    log.info("=" * 70)
    log.info("")

    if not results:
        results = [{"url": root_url, "page_type": "Landing Page"}]

    return results
