"""
TemplateDetector — identifies repeated page templates to avoid over-crawling.

Two-layer approach:
  1. URL pattern normalization (dynamic segments → :id, :slug, etc.)
  2. DOM structural fingerprinting (SHA-256 of sorted tag.class pairs)
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from bs4 import BeautifulSoup

# Applied in order — first match wins
_SEGMENT_RULES = [
    (re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I), ':uuid'),
    (re.compile(r'^\d+$'), ':id'),
    (re.compile(r'^[0-9a-f]{8,}$', re.I), ':hash'),
    (re.compile(r'^\d{4}-\d{2}(-\d{2})?$'), ':date'),
    (re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+){2,}$'), ':slug'),
]


@dataclass
class TemplateGroup:
    pattern: str
    representative_urls: List[str] = field(default_factory=list)
    dom_hashes: List[str] = field(default_factory=list)
    estimated_total: int = 0


class TemplateDetector:
    def __init__(self, max_samples: int = 3):
        self.max_samples = max_samples
        self._registry: Dict[str, TemplateGroup] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def normalize_url_pattern(self, path: str) -> str:
        """Convert a URL path to a normalized template pattern string."""
        path = path.split('?')[0].split('#')[0]
        parts = [p for p in path.split('/') if p]
        normalized = []
        for part in parts:
            matched = False
            for pattern, replacement in _SEGMENT_RULES:
                if pattern.match(part):
                    normalized.append(replacement)
                    matched = True
                    break
            if not matched:
                normalized.append(part)
        return '/' + '/'.join(normalized) if normalized else '/'

    def dom_fingerprint(self, html: str) -> str:
        """Compute a lightweight structural hash of rendered HTML (no text, no IDs)."""
        try:
            soup = BeautifulSoup(html, 'html.parser')
            pairs = []
            for tag in soup.find_all(True):
                cls_list = tag.get('class', [])
                prefix = cls_list[0].split('__')[0].split('--')[0] if cls_list else ''
                pairs.append(f"{tag.name}.{prefix}")
            pairs.sort()
            return hashlib.sha256('\n'.join(pairs).encode()).hexdigest()[:16]
        except Exception:
            return ''

    def should_skip(self, url: str, path: str, dom_hash: str = '') -> bool:
        """
        Return True if this URL is a confirmed template duplicate.

        Rules:
        - Depth-1 paths (e.g. /about) are NEVER skipped.
        - Patterns without dynamic segments (:id, :slug, etc.) are never skipped.
        - If the pattern exists and we haven't reached max_samples, don't skip.
        - If we're AT max_samples:
            - If dom_hash provided and it matches → skip (confirmed duplicate).
            - If dom_hash provided and it does NOT match → don't skip (distinct layout).
            - If no dom_hash yet → skip (assume duplicate until proven otherwise).
        """
        pattern = self.normalize_url_pattern(path)

        # Always visit shallow utility pages
        parts = [p for p in path.split('?')[0].split('/') if p]
        if len(parts) <= 1:
            return False

        # No dynamic segments → unique page
        if ':' not in pattern:
            return False

        if pattern not in self._registry:
            return False

        group = self._registry[pattern]
        if len(group.representative_urls) < self.max_samples:
            return False

        # At max_samples: check dom hash
        if dom_hash:
            return dom_hash in group.dom_hashes
        return True  # no hash yet, presume duplicate

    def register(self, url: str, path: str, dom_hash: str) -> Optional[str]:
        """
        Register a visited page.  Returns the pattern string the FIRST time a
        pattern is seen (i.e. template newly detected), otherwise None.
        """
        pattern = self.normalize_url_pattern(path)
        if ':' not in pattern:
            return None

        is_new = pattern not in self._registry
        if is_new:
            self._registry[pattern] = TemplateGroup(pattern=pattern)

        group = self._registry[pattern]
        group.estimated_total += 1

        if url not in group.representative_urls:
            if len(group.representative_urls) < self.max_samples:
                group.representative_urls.append(url)
                if dom_hash and dom_hash not in group.dom_hashes:
                    group.dom_hashes.append(dom_hash)

        return pattern if is_new else None

    def get_registry(self) -> Dict[str, dict]:
        return {
            pattern: {
                'pattern': group.pattern,
                'representative_urls': group.representative_urls,
                'sample_count': len(group.representative_urls),
                'estimated_total': group.estimated_total,
            }
            for pattern, group in self._registry.items()
        }
