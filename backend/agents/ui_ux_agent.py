import os

from gradient import Gradient

from tools.vision_scraper import capture_website_context

_SYSTEM_PROMPT = """
You are the Lead Design Critic for Scout.ai.
Your goal is to find 'vibecoding' flaws.
1. Analyze the DOM structure and accessibility data for serious issues.
2. Evaluate responsiveness: check viewport meta tag, responsive CSS classes.
3. Check accessibility: missing alt text, ARIA labels, heading hierarchy, form labels.
4. Provide a brutal but constructive report on UX friction points.
Format your report with clear sections:
  - Accessibility Issues
  - Layout / Responsiveness
  - UX Friction Points
  - Recommendations
"""


def run_audit(url: str) -> str:
    """Capture website context and produce a UI/UX + accessibility audit."""
    context = capture_website_context(url)

    if context.get("error"):
        return f"Failed to fetch {url}: {context['error']}"

    summary = context["accessibility_summary"]
    dom_snippet = context["dom"][:8000]

    prompt = f"""Perform a full UI/UX and accessibility audit on: {url}

ACCESSIBILITY SUMMARY:
- Total images: {summary['images_total']}, missing alt text: {summary['images_missing_alt']}
- Heading hierarchy: {summary['heading_hierarchy']}
- Has viewport meta tag: {summary['has_viewport_meta']}
- Total form inputs: {summary['total_inputs']}, labeled: {summary['labeled_inputs']}
- ARIA roles present: {summary['aria_roles_found']}

DOM CONTENT (first 8 000 chars):
{dom_snippet}

Give a brutally honest but constructive audit with specific findings and actionable recommendations.
"""

    client = Gradient(
        model_access_key=os.environ.get("DIGITALOCEAN_INFERENCE_KEY")
    )
    response = client.chat.completions.create(
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        model="llama3-8b-instruct",
    )
    return response.choices[0].message.content