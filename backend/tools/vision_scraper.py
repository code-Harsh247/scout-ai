import requests
from html.parser import HTMLParser


class _AccessibilityChecker(HTMLParser):
    """Lightweight HTML parser to extract accessibility signals."""

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


def capture_website_context(url: str) -> dict:
    """Fetch a website and return its DOM content and accessibility summary.

    Returns a dict with keys:
        url, dom, accessibility_summary, status_code, final_url
    On network error the dict will have an 'error' key instead.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }

    try:
        response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        response.raise_for_status()
    except requests.RequestException as exc:
        return {"url": url, "error": str(exc), "dom": "", "accessibility_summary": {}}

    html = response.text

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
        "accessibility_summary": accessibility_summary,
        "status_code": response.status_code,
        "final_url": str(response.url),
    }
