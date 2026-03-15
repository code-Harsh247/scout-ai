"""
BFSCrawler — async breadth-first site crawler.

Architecture:
  - _run_crawl()  background asyncio.Task: runs BFS, feeds events into _event_queue
  - crawl()       public async generator: yields SSE-shaped event dicts consumed by FastAPI

Concurrency model:
  - asyncio.Semaphore(concurrency) limits simultaneous Playwright page loads
  - httpx.AsyncClient shared across all tasks for link health-checks
  - DB writes run in thread-pool via asyncio.to_thread() (non-blocking)
"""

import asyncio
import base64
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urldefrag, urlparse

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import Browser, async_playwright

from . import db
from .broken_link_checker import check_link
from .template_detector import TemplateDetector

log = logging.getLogger("scout")

# File extensions that are never worth visiting with Playwright
_SKIP_EXT = frozenset({
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp',
    '.mp4', '.mp3', '.avi', '.mov', '.wmv', '.webm',
    '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z', '.exe', '.dmg', '.deb', '.rpm',
    '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.map', '.xml', '.csv', '.rss', '.atom',
})

_BOT_UA = 'Mozilla/5.0 (compatible; ScoutBot/1.0; +https://scout.ai)'


# ---------------------------------------------------------------------------
# URL utilities
# ---------------------------------------------------------------------------

def _normalize(url: str, base: str) -> Optional[str]:
    """Resolve relative URL against base, strip fragment. Returns None if invalid."""
    try:
        absolute = urljoin(base, url)
        defragged, _ = urldefrag(absolute)
        parsed = urlparse(defragged)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            return None
        return parsed._replace(fragment='').geturl()
    except Exception:
        return None


def _same_origin(url: str, root: str) -> bool:
    return urlparse(url).netloc.lower() == urlparse(root).netloc.lower()


def _skip_ext(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in _SKIP_EXT)


# ---------------------------------------------------------------------------
# robots.txt
# ---------------------------------------------------------------------------

async def _fetch_robots_disallowed(root_url: str) -> List[str]:
    """Parse Disallow rules from robots.txt for User-agent: *"""
    parsed = urlparse(root_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    disallowed: List[str] = []
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5.0) as c:
            resp = await c.get(robots_url, headers={'User-Agent': 'ScoutBot'})
            if resp.status_code != 200:
                return disallowed
            active = False
            for line in resp.text.splitlines():
                stripped = line.strip()
                if stripped.lower().startswith('user-agent:'):
                    ua = stripped.split(':', 1)[1].strip()
                    active = ua in ('*', 'ScoutBot', 'scoutbot')
                elif active and stripped.lower().startswith('disallow:'):
                    path_rule = stripped.split(':', 1)[1].strip()
                    if path_rule and path_rule != '/':
                        disallowed.append(path_rule)
    except Exception as e:
        log.debug("[robots] %s → %s", root_url, e)
    return disallowed


def _robots_disallows(path: str, rules: List[str]) -> bool:
    return any(path.startswith(r) for r in rules)


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

def _extract_links(html: str, base: str) -> List[Tuple[str, str]]:
    """Return (absolute_url, link_text) pairs from <a href> tags."""
    soup = BeautifulSoup(html, 'html.parser')
    seen: Set[str] = set()
    out: List[Tuple[str, str]] = []
    for a in soup.find_all('a', href=True):
        href = a['href'].strip()
        if not href or href.startswith(('javascript:', 'mailto:', 'tel:', '#')):
            continue
        url = _normalize(href, base)
        if url and url not in seen:
            seen.add(url)
            out.append((url, a.get_text(strip=True)[:200]))
    return out


def _extract_nav_links(html: str, base: str) -> Set[str]:
    """Return URLs found inside <nav> elements (always-visit set)."""
    soup = BeautifulSoup(html, 'html.parser')
    out: Set[str] = set()
    for nav in soup.find_all('nav'):
        for a in nav.find_all('a', href=True):
            url = _normalize(a['href'].strip(), base)
            if url:
                out.add(url)
    return out


def _page_title(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    t = soup.find('title')
    return t.get_text(strip=True)[:200] if t else ''


# ---------------------------------------------------------------------------
# Per-URL visit result (passed back from task to main loop)
# ---------------------------------------------------------------------------

@dataclass
class _VisitResult:
    events: List[dict] = field(default_factory=list)
    # (url, depth, from_url) — new internal URLs to enqueue
    new_urls: List[Tuple[str, int, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Main crawler
# ---------------------------------------------------------------------------

class BFSCrawler:
    def __init__(
        self,
        root_url: str,
        session_id: str,
        depth_limit: int = 4,
        page_limit: int = 150,
        max_samples: int = 3,
        concurrency: int = 3,
    ):
        self.root_url = root_url.rstrip('/')
        self.session_id = session_id
        self.depth_limit = depth_limit
        self.page_limit = page_limit
        self.concurrency = concurrency
        self.detector = TemplateDetector(max_samples=max_samples)

        # Frontier
        self._frontier: deque = deque()
        self._queued: Set[str] = set()   # ever-enqueued (prevents re-queuing)
        self._visited: Set[str] = set()  # actually processed

        # Stats
        self._pages_visited = 0
        self._pages_skipped = 0
        self._broken_found = 0

        # robots.txt disallow rules & nav URLs from homepage
        self._disallowed: List[str] = []
        self._nav_urls: Set[str] = set()

        # Event queue connecting background task → public generator
        self._event_queue: asyncio.Queue = asyncio.Queue()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _emit(self, event: dict):
        """Put an event into the queue (called from any coroutine)."""
        self._event_queue.put_nowait(event)

    def _enqueue(self, url: str, depth: int) -> bool:
        """Add URL to frontier if not already queued and within depth limit."""
        if url not in self._queued and depth <= self.depth_limit:
            self._queued.add(url)
            self._frontier.append((url, depth))
            return True
        return False

    # ------------------------------------------------------------------
    # Per-URL visit coroutine
    # ------------------------------------------------------------------

    async def _visit(
        self,
        url: str,
        depth: int,
        browser: Browser,
        page_sem: asyncio.Semaphore,
        link_client: httpx.AsyncClient,
    ) -> _VisitResult:
        result = _VisitResult()
        parsed = urlparse(url)
        path = parsed.path or '/'

        # robots.txt guard
        if _robots_disallows(path, self._disallowed):
            self._pages_skipped += 1
            result.events.append({
                'type': 'page_skipped', 'url': url,
                'url_pattern': None, 'reason': 'robots_txt',
            })
            return result

        # Extension guard
        if _skip_ext(url):
            return result

        # Page limit guard
        if self._pages_visited >= self.page_limit:
            return result

        url_pattern = self.detector.normalize_url_pattern(path)

        # Emit visiting immediately (visible in live feed before load finishes)
        self._emit({'type': 'page_visiting', 'url': url, 'depth': depth, 'url_pattern': url_pattern})

        # Pre-fetch template duplicate check (no DOM hash yet)
        if url not in self._nav_urls and self.detector.should_skip(url, path):
            self._pages_skipped += 1
            result.events.append({
                'type': 'page_skipped', 'url': url,
                'url_pattern': url_pattern, 'reason': 'template_duplicate',
            })
            asyncio.create_task(asyncio.to_thread(
                db.insert_page, self.session_id, url, url_pattern,
                False, None, '', '', depth,
            ))
            return result

        # ── Playwright fetch ────────────────────────────────────────────────
        html = ''
        status_code: Optional[int] = None
        screenshot_b64: Optional[str] = None

        async with page_sem:
            ctx = await browser.new_context(
                viewport={'width': 1280, 'height': 800},
                user_agent=_BOT_UA,
            )
            pg = await ctx.new_page()
            try:
                resp = await pg.goto(url, timeout=20_000, wait_until='domcontentloaded')
                status_code = resp.status if resp else None
                try:
                    await pg.wait_for_load_state('networkidle', timeout=8_000)
                except Exception:
                    pass  # networkidle timeout is acceptable
                html = await pg.content()
                # ── Live preview screenshot ─────────────────────────────
                try:
                    shot = await pg.screenshot(
                        type='jpeg',
                        quality=45,
                        clip={'x': 0, 'y': 0, 'width': 1280, 'height': 720},
                    )
                    screenshot_b64 = base64.b64encode(shot).decode()
                    self._emit({
                        'type': 'page_screenshot',
                        'url': url,
                        'data': screenshot_b64,
                    })
                except Exception as se:
                    log.debug('[crawler] screenshot %s: %s', url, se)
            except Exception as e:
                log.warning("[crawler] load error %s: %s", url, e)
            finally:
                try:
                    await pg.close()
                    await ctx.close()
                except Exception:
                    pass

        if not html:
            self._pages_skipped += 1
            result.events.append({
                'type': 'page_skipped', 'url': url,
                'url_pattern': url_pattern, 'reason': 'load_error',
            })
            return result

        # ── Template detection (post-fetch, with DOM hash) ──────────────────
        dom_hash = self.detector.dom_fingerprint(html)
        if url not in self._nav_urls and self.detector.should_skip(url, path, dom_hash):
            self._pages_skipped += 1
            result.events.append({
                'type': 'page_skipped', 'url': url,
                'url_pattern': url_pattern, 'reason': 'template_duplicate',
            })
            asyncio.create_task(asyncio.to_thread(
                db.insert_page, self.session_id, url, url_pattern,
                False, status_code, _page_title(html), dom_hash, depth,
            ))
            return result

        # ── Register this page ──────────────────────────────────────────────
        is_template_rep = ':' in url_pattern
        new_pattern = self.detector.register(url, path, dom_hash)
        page_title = _page_title(html)

        page_id = await asyncio.to_thread(
            db.insert_page, self.session_id, url, url_pattern,
            is_template_rep, status_code, page_title, dom_hash, depth,
            screenshot_b64,
        )

        if new_pattern:
            group = self.detector.get_registry().get(new_pattern, {})
            result.events.append({
                'type': 'template_detected',
                'pattern': new_pattern,
                'representative_url': url,
                'estimated_total': group.get('estimated_total', 1),
            })
            if page_id:
                asyncio.create_task(asyncio.to_thread(
                    db.upsert_template_pattern,
                    self.session_id, new_pattern, page_id,
                    group.get('sample_count', 1),
                    group.get('estimated_total', 1),
                    dom_hash,
                ))

        # ── Link extraction & health-checks ─────────────────────────────────
        links = _extract_links(html, url)
        broken_count = 0

        if links:
            check_results = await asyncio.gather(
                *[check_link(link_client, lu) for lu, _ in links],
                return_exceptions=True,
            )

            db_link_tasks = []
            for (link_url, link_text), cr in zip(links, check_results):
                if isinstance(cr, Exception):
                    cr = {
                        'status_code': None,
                        'link_status': 'unreachable',
                        'final_url': link_url,
                        'error': str(cr),
                    }

                is_internal = _same_origin(link_url, self.root_url)
                link_status = cr.get('link_status', 'unreachable')

                db_link_tasks.append(asyncio.to_thread(
                    db.insert_link,
                    self.session_id, page_id or '',
                    link_url, link_text,
                    cr.get('status_code'), link_status,
                    is_internal, cr.get('final_url', link_url),
                ))

                if link_status not in ('ok', 'redirect'):
                    broken_count += 1
                    self._broken_found += 1
                    result.events.append({
                        'type': 'broken_link',
                        'url': link_url,
                        'from_url': url,
                        'from_page_title': page_title,
                        'status_code': cr.get('status_code'),
                        'error_type': link_status,
                    })

                # Queue new internal URLs
                if is_internal and not _skip_ext(link_url):
                    norm = _normalize(link_url, self.root_url)
                    if norm:
                        norm_path = urlparse(norm).path or '/'
                        if not _robots_disallows(norm_path, self._disallowed):
                            result.new_urls.append((norm, depth + 1, url))

            # Fire-and-forget DB link inserts
            asyncio.ensure_future(asyncio.gather(*db_link_tasks, return_exceptions=True))

        self._pages_visited += 1
        result.events.append({
            'type': 'page_visited',
            'url': url,
            'url_pattern': url_pattern,
            'status_code': status_code,
            'is_template_representative': is_template_rep,
            'links_found': len(links),
            'broken_links_found': broken_count,
        })

        return result

    # ------------------------------------------------------------------
    # Background crawl task
    # ------------------------------------------------------------------

    async def _run_crawl(self):
        """Runs the BFS loop in a background asyncio.Task.  Always emits sentinel None."""
        t_start = time.perf_counter()
        try:
            self._disallowed = await _fetch_robots_disallowed(self.root_url)

            async with httpx.AsyncClient(
                headers={'User-Agent': _BOT_UA},
                follow_redirects=True,
                timeout=10.0,
            ) as link_client:
                async with async_playwright() as pw:
                    browser = await pw.chromium.launch(headless=True)
                    page_sem = asyncio.Semaphore(self.concurrency)

                    # ── Pre-fetch homepage to collect <nav> URLs ────────────
                    try:
                        ctx0 = await browser.new_context(
                            viewport={'width': 1280, 'height': 800},
                            user_agent=_BOT_UA,
                        )
                        pg0 = await ctx0.new_page()
                        await pg0.goto(self.root_url, timeout=20_000, wait_until='domcontentloaded')
                        try:
                            await pg0.wait_for_load_state('networkidle', timeout=8_000)
                        except Exception:
                            pass
                        home_html = await pg0.content()
                        await pg0.close()
                        await ctx0.close()
                        self._nav_urls = {
                            u for u in _extract_nav_links(home_html, self.root_url)
                            if _same_origin(u, self.root_url)
                        }
                    except Exception as e:
                        log.warning("[crawler] homepage pre-fetch failed: %s", e)

                    # ── Seed frontier ───────────────────────────────────────
                    self._enqueue(self.root_url, 0)

                    # ── Main BFS loop ───────────────────────────────────────
                    pending: Set[asyncio.Task] = set()

                    while self._frontier or pending:
                        # Fill task pool up to concurrency * 2
                        while (
                            self._frontier
                            and len(pending) < self.concurrency * 2
                            and self._pages_visited < self.page_limit
                        ):
                            url, depth = self._frontier.popleft()
                            if url in self._visited:
                                continue
                            self._visited.add(url)
                            t = asyncio.create_task(
                                self._visit(url, depth, browser, page_sem, link_client)
                            )
                            pending.add(t)

                        if not pending:
                            break

                        done, pending = await asyncio.wait(
                            pending, return_when=asyncio.FIRST_COMPLETED
                        )

                        for task in done:
                            try:
                                visit_result: _VisitResult = await task
                            except Exception as e:
                                log.error("[crawler] task error: %s", e)
                                self._emit({'type': 'error', 'message': str(e)})
                                continue

                            # Emit non-visiting events from this visit
                            for event in visit_result.events:
                                self._emit(event)

                            # Enqueue new URLs (deduplication in _enqueue)
                            for new_url, new_depth, from_url in visit_result.new_urls:
                                if self._enqueue(new_url, new_depth):
                                    self._emit({
                                        'type': 'page_discovered',
                                        'url': new_url,
                                        'depth': new_depth,
                                        'from_url': from_url,
                                    })

                    await browser.close()

            elapsed_ms = int((time.perf_counter() - t_start) * 1000)
            self._emit({
                'type': 'crawl_complete',
                'session_id': self.session_id,
                'stats': {
                    'visited': self._pages_visited,
                    'skipped': self._pages_skipped,
                    'broken': self._broken_found,
                    'templates_found': len(self.detector.get_registry()),
                    'duration_ms': elapsed_ms,
                },
            })
            asyncio.create_task(asyncio.to_thread(
                db.update_session,
                self.session_id,
                status='complete',
                pages_visited=self._pages_visited,
                pages_skipped=self._pages_skipped,
                broken_links_found=self._broken_found,
            ))

        except asyncio.CancelledError:
            log.info("[crawler] crawl cancelled  session=%s", self.session_id)
        except Exception as e:
            log.exception("[crawler] unhandled error: %s", e)
            self._emit({'type': 'error', 'message': str(e)})
        finally:
            self._emit(None)  # sentinel — always sent

    # ------------------------------------------------------------------
    # Public async generator
    # ------------------------------------------------------------------

    async def crawl(self) -> AsyncIterator[dict]:
        """
        Start the crawl and yield SSE event dicts as they arrive.
        Properly cleans up the background task when the generator is closed
        (e.g. client disconnect).
        """
        task = asyncio.create_task(self._run_crawl())
        try:
            while True:
                event = await self._event_queue.get()
                if event is None:   # sentinel from _run_crawl
                    break
                yield event
        finally:
            if not task.done():
                task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
