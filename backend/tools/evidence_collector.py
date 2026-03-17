"""
evidence_collector.py — Captures visual evidence of audit findings.

Runs inside the Playwright browser session (before browser.close) to:
1. Query DOM for known problem element types (missing alt, unlabeled inputs, etc.)
2. Get their bounding boxes via element.bounding_box()
3. Use Pillow to draw annotation boxes on the full-page screenshot
4. Return cropped, annotated evidence images as base64 PNGs
"""
import base64
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

log = logging.getLogger("scout")

# ---------------------------------------------------------------------------
# Color palette for annotations
# ---------------------------------------------------------------------------
COLORS = {
    "red": (220, 38, 38),
    "orange": (234, 88, 12),
    "yellow": (202, 138, 4),
    "blue": (37, 99, 235),
}

CROP_PADDING = 50  # pixels of context around the annotated element


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _open_screenshot(screenshot_bytes: bytes) -> Image.Image:
    """Open the full-page screenshot as a Pillow Image."""
    return Image.open(BytesIO(screenshot_bytes)).convert("RGBA")


def _draw_rect(
    img: Image.Image,
    bbox: Dict[str, float],
    color: Tuple[int, int, int],
    label: str = "",
    line_width: int = 3,
) -> Image.Image:
    """Draw a colored rectangle + optional label on the image (mutates a copy)."""
    img = img.copy()
    draw = ImageDraw.Draw(img)
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]

    # Rectangle
    draw.rectangle(
        [x, y, x + w, y + h],
        outline=color,
        width=line_width,
    )

    # Label background + text
    if label:
        font_size = 14
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except (IOError, OSError):
            font = ImageFont.load_default()
        text_bbox = draw.textbbox((0, 0), label, font=font)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]

        label_x = x
        label_y = max(0, y - text_h - 6)
        draw.rectangle(
            [label_x, label_y, label_x + text_w + 8, label_y + text_h + 4],
            fill=color,
        )
        draw.text((label_x + 4, label_y + 2), label, fill=(255, 255, 255), font=font)

    return img


def _crop_region(
    img: Image.Image,
    bbox: Dict[str, float],
    padding: int = CROP_PADDING,
) -> Image.Image:
    """Crop a region around a bounding box with context padding."""
    x, y, w, h = bbox["x"], bbox["y"], bbox["width"], bbox["height"]
    left = max(0, int(x - padding))
    top = max(0, int(y - padding))
    right = min(img.width, int(x + w + padding))
    bottom = min(img.height, int(y + h + padding))
    return img.crop((left, top, right, bottom))


def _img_to_base64(img: Image.Image) -> str:
    """Convert a Pillow Image to a base64-encoded PNG string."""
    buf = BytesIO()
    img.convert("RGB").save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _annotate_and_crop(
    full_img: Image.Image,
    bbox: Dict[str, float],
    color: Tuple[int, int, int],
    label: str,
) -> str:
    """Draw a rect on the screenshot, crop around it, return as base64."""
    annotated = _draw_rect(full_img, bbox, color, label)
    cropped = _crop_region(annotated, bbox)
    return _img_to_base64(cropped)


# ---------------------------------------------------------------------------
# Element-level evidence capture helpers
# ---------------------------------------------------------------------------

def _collect_element_evidence(
    page,
    full_img: Image.Image,
    selector: str,
    color: Tuple[int, int, int],
    label: str,
    max_items: int = 8,
) -> List[Dict[str, Any]]:
    """
    Query for elements matching `selector`, get bounding boxes,
    annotate + crop, return evidence dicts.
    """
    evidence_list = []
    try:
        elements = page.query_selector_all(selector)
    except Exception as e:
        log.warning("[evidence] Failed to query '%s': %s", selector, e)
        return evidence_list

    for i, el in enumerate(elements[:max_items]):
        try:
            bbox = el.bounding_box()
            if not bbox or bbox["width"] < 2 or bbox["height"] < 2:
                continue  # invisible or zero-area element

            image_b64 = _annotate_and_crop(full_img, bbox, color, f"{label} #{i+1}")
            evidence_list.append({
                "check_key": label.lower().replace(" ", "_"),
                "description": f"{label} #{i+1} at ({int(bbox['x'])}, {int(bbox['y'])})",
                "image_base64": image_b64,
                "element_selector": selector,
            })
        except Exception as e:
            log.warning("[evidence] Failed to capture bbox for element %d of '%s': %s", i, selector, e)

    return evidence_list


def _collect_region_evidence(
    page,
    full_img: Image.Image,
    selector: str,
    color: Tuple[int, int, int],
    check_key: str,
    description: str,
) -> List[Dict[str, Any]]:
    """Capture a single DOM region (e.g. footer) as evidence."""
    try:
        el = page.query_selector(selector)
        if not el:
            return []
        bbox = el.bounding_box()
        if not bbox or bbox["width"] < 2 or bbox["height"] < 2:
            return []

        image_b64 = _annotate_and_crop(full_img, bbox, color, check_key)
        return [{
            "check_key": check_key,
            "description": description,
            "image_base64": image_b64,
            "element_selector": selector,
        }]
    except Exception as e:
        log.warning("[evidence] Failed to capture region '%s': %s", selector, e)
        return []


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def collect_evidence(page, screenshot_bytes: bytes) -> Dict[str, List[Dict[str, Any]]]:
    """
    Collect visual evidence for all known check types.

    Args:
        page: Active Playwright Page object (browser must still be open)
        screenshot_bytes: Raw bytes of the full-page screenshot

    Returns:
        Dict keyed by check name, values are lists of evidence dicts:
        {
            "missing_alt_text": [...],
            "unlabeled_inputs": [...],
            "footer_region": [...],
            "heading_positions": [...],
        }
    """
    log.info("[evidence] Starting evidence collection")
    evidence: Dict[str, List[Dict[str, Any]]] = {}

    try:
        full_img = _open_screenshot(screenshot_bytes)
    except Exception as e:
        log.error("[evidence] Failed to open screenshot image: %s", e)
        return evidence

    # 1. Images missing alt text
    evidence["missing_alt_text"] = _collect_element_evidence(
        page, full_img,
        selector="img:not([alt]), img[alt='']",
        color=COLORS["red"],
        label="Missing alt text",
        max_items=8,
    )
    log.info("[evidence] missing_alt_text: %d items", len(evidence["missing_alt_text"]))

    # 2. Unlabeled form inputs
    evidence["unlabeled_inputs"] = _collect_element_evidence(
        page, full_img,
        selector="input:not([type='hidden']):not([type='submit']):not([type='button']):not([aria-label]):not([aria-labelledby]):not([id])",
        color=COLORS["orange"],
        label="Unlabeled input",
        max_items=8,
    )
    log.info("[evidence] unlabeled_inputs: %d items", len(evidence["unlabeled_inputs"]))

    # 3. Heading positions (H1s and H2s for layout context)
    evidence["heading_positions"] = _collect_element_evidence(
        page, full_img,
        selector="h1, h2",
        color=COLORS["blue"],
        label="Heading",
        max_items=10,
    )
    log.info("[evidence] heading_positions: %d items", len(evidence["heading_positions"]))

    # 4. Footer region (for legal link verification)
    evidence["footer_region"] = _collect_region_evidence(
        page, full_img,
        selector="footer, [role='contentinfo']",
        color=COLORS["yellow"],
        check_key="footer_region",
        description="Footer region — check for Privacy Policy and Terms of Service links",
    )
    log.info("[evidence] footer_region: %d items", len(evidence["footer_region"]))

    # 5. Cookie consent / banner region (common selectors)
    cookie_selectors = [
        "[class*='cookie']", "[id*='cookie']",
        "[class*='consent']", "[id*='consent']",
        "[class*='gdpr']", "[id*='gdpr']",
    ]
    cookie_evidence = []
    for sel in cookie_selectors:
        result = _collect_region_evidence(
            page, full_img,
            selector=sel,
            color=COLORS["orange"],
            check_key="cookie_banner",
            description="Cookie consent / GDPR banner region",
        )
        if result:
            cookie_evidence.extend(result)
            break  # one match is enough
    evidence["cookie_banner"] = cookie_evidence
    log.info("[evidence] cookie_banner: %d items", len(evidence["cookie_banner"]))

    total = sum(len(v) for v in evidence.values())
    log.info("[evidence] Collection complete — %d total evidence items", total)
    return evidence
