import httpx
from bs4 import BeautifulSoup
import re
from typing import Dict, Any

# A basic list of stop words for English length calculation
STOP_WORDS = {
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your", "yours", 
    "yourself", "yourselves", "he", "him", "his", "himself", "she", "her", "hers", 
    "herself", "it", "its", "itself", "they", "them", "their", "theirs", "themselves", 
    "what", "which", "who", "whom", "this", "that", "these", "those", "am", "is", "are", 
    "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", 
    "did", "doing", "a", "an", "the", "and", "but", "if", "or", "because", "as", "until", 
    "while", "of", "at", "by", "for", "with", "about", "against", "between", "into", 
    "through", "during", "before", "after", "above", "below", "to", "from", "up", "down", 
    "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "here", 
    "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", 
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", 
    "than", "too", "very", "s", "t", "can", "will", "just", "don", "should", "now"
}

def fetch_raw_html(url: str) -> Dict[str, Any]:
    """
    Fetches page via httpx with browser User-Agent, returns raw HTML + status code + 
    redirect chain + whether final URL is HTTPS.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    try:
        response = httpx.get(url, headers=headers, follow_redirects=True, timeout=15.0)
        redirect_chain = [str(req.url) for req in response.history]
        final_url = str(response.url)
        is_https = final_url.startswith("https://")
        
        return {
            "status_code": response.status_code,
            "raw_html": response.text,
            "redirect_chain": redirect_chain,
            "final_url": final_url,
            "is_https": is_https,
            "error": None
        }
    except Exception as e:
        return {
            "status_code": None,
            "raw_html": "",
            "redirect_chain": [],
            "final_url": url,
            "is_https": url.startswith("https://"),
            "error": str(e)
        }

def extract_seo_elements(raw_html: str) -> Dict[str, Any]:
    """
    Parses raw HTML with BeautifulSoup to extract <title>, all <h1> tags, 
    <meta name="description">, <link rel="canonical">, all internal <a href> links, viewport meta.
    """
    if not raw_html:
        return {}
    
    soup = BeautifulSoup(raw_html, "html.parser")
    
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None
    
    h1_tags = [h1.get_text(strip=True) for h1 in soup.find_all("h1")]
    
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_description = meta_desc_tag.get("content", "").strip() if meta_desc_tag and meta_desc_tag.get("content") else None
    
    canonical_tag = soup.find("link", attrs={"rel": "canonical"})
    canonical_link = canonical_tag.get("href", "").strip() if canonical_tag and canonical_tag.get("href") else None
    
    internal_links = []
    for a_tag in soup.find_all("a", href=True):
        href = a_tag.get("href", "")
        if href.startswith("/") or not href.startswith("http"):
            internal_links.append(href)
    
    viewport_meta_tag = soup.find("meta", attrs={"name": "viewport"})
    viewport_meta = viewport_meta_tag.get("content", "").strip() if viewport_meta_tag and viewport_meta_tag.get("content") else None
    
    return {
        "title": title,
        "h1_tags": h1_tags,
        "meta_description": meta_description,
        "canonical_link": canonical_link,
        "internal_links": list(set(internal_links)),
        "viewport_meta": viewport_meta
    }

def check_https_redirect(url: str) -> Dict[str, Any]:
    """
    Makes HTTP request via httpx, checks if redirect chain lands on HTTPS, 
    flags missing redirect or mixed content.
    """
    # Force HTTP
    if url.startswith("https://"):
        url = url.replace("https://", "http://", 1)
    elif not url.startswith("http://"):
        url = "http://" + url
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    
    try:
        response = httpx.get(url, headers=headers, follow_redirects=True, timeout=15.0)
        redirect_chain = [str(req.url) for req in response.history]
        final_url = str(response.url)
        lands_on_https = final_url.startswith("https://")
        
        return {
            "initial_url": url,
            "final_url": final_url,
            "lands_on_https": lands_on_https,
            "redirect_chain": redirect_chain,
            "missing_redirect": not lands_on_https,
            "error": None
        }
    except Exception as e:
        return {
            "initial_url": url,
            "final_url": None,
            "lands_on_https": False,
            "redirect_chain": [],
            "missing_redirect": True,
            "error": str(e)
        }

def analyze_content_quality(raw_html: str) -> Dict[str, Any]:
    """
    Strips HTML -> plain text, computes word count, average sentence length, 
    stop-word ratio, flags thin content (< 300 words).
    """
    if not raw_html:
        return {}
    
    soup = BeautifulSoup(raw_html, "html.parser")
    # Remove script and style elements
    for script in soup(["script", "style"]):
        script.extract()
        
    text = soup.get_text(separator=' ')
    
    # Extract words
    words = re.findall(r'\b\w+\b', text.lower())
    word_count = len(words)
    
    # Extract sentences (basic heuristic)
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    sentence_count = len(sentences)
    
    avg_sentence_length = (word_count / sentence_count) if sentence_count > 0 else 0
    
    stop_words_count = sum(1 for word in words if word in STOP_WORDS)
    stop_word_ratio = (stop_words_count / word_count) if word_count > 0 else 0
    
    is_thin_content = word_count < 300
    
    return {
        "word_count": word_count,
        "average_sentence_length": round(avg_sentence_length, 2),
        "stop_word_ratio": round(stop_word_ratio, 2),
        "is_thin_content": is_thin_content
    }

def check_mobile_optimization(raw_html: str) -> Dict[str, Any]:
    """
    Checks viewport meta tag, counts <script src> tags (render-blocking JS), 
    checks for responsive meta tags.
    """
    if not raw_html:
        return {}
        
    soup = BeautifulSoup(raw_html, "html.parser")
    
    viewport_meta_tag = soup.find("meta", attrs={"name": "viewport"})
    has_viewport_meta = bool(viewport_meta_tag)
    
    # Naive count of <script src="...">
    script_src_tags = soup.find_all("script", src=True)
    render_blocking_js_count = len(script_src_tags)
    
    is_responsive = False
    if has_viewport_meta:
        content = viewport_meta_tag.get("content", "").lower()
        if "width=device-width" in content or "initial-scale=1" in content:
            is_responsive = True
            
    return {
        "has_viewport_meta": has_viewport_meta,
        "viewport_content": viewport_meta_tag.get("content") if has_viewport_meta else None,
        "render_blocking_js_count": render_blocking_js_count,
        "is_responsive": is_responsive
    }

def compute_critical_content_delta(raw_elements: Dict[str, Any], rendered_dom: str, has_screenshot: bool) -> Dict[str, Any]:
    """
    Compares H1s and internal links from raw HTML vs rendered DOM. 
    If has_screenshot is False (Playwright failed), returns status: "inconclusive".
    """
    if not has_screenshot:
        return {"status": "inconclusive"}
        
    if not rendered_dom:
        return {"status": "inconclusive", "error": "No rendered DOM available"}
        
    rendered_soup = BeautifulSoup(rendered_dom, "html.parser")
    
    rendered_h1s = [h1.get_text(strip=True) for h1 in rendered_soup.find_all("h1")]
    
    rendered_internal_links = []
    for a_tag in rendered_soup.find_all("a", href=True):
        href = a_tag.get("href", "")
        if href.startswith("/") or not href.startswith("http"):
            rendered_internal_links.append(href)
            
    raw_h1s = raw_elements.get("h1_tags", [])
    raw_internal_links = raw_elements.get("internal_links", [])
    
    # Delta
    h1_delta = set(rendered_h1s) != set(raw_h1s)
    links_delta = set(rendered_internal_links) != set(raw_internal_links)
    
    return {
        "status": "success",
        "h1_delta": h1_delta,
        "links_delta": links_delta,
        "raw_h1_count": len(raw_h1s),
        "rendered_h1_count": len(rendered_h1s),
        "raw_internal_links_count": len(raw_internal_links),
        "rendered_internal_links_count": len(rendered_internal_links),
    }

if __name__ == "__main__":
    import json
    import sys
    
    # Small terminal runner to check if everything works properly
    test_url = "https://example.com"
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
        
    print(f"--- Running SEO Scraper Tools on {test_url} ---")
    
    # 1. fetch_raw_html
    print("\n[1] fetch_raw_html")
    fetch_result = fetch_raw_html(test_url)
    raw_html = fetch_result.get("raw_html", "")
    print(json.dumps({k: v for k, v in fetch_result.items() if k != 'raw_html'}, indent=2))
    
    if raw_html:
        # 2. extract_seo_elements
        print("\n[2] extract_seo_elements")
        seo_elements = extract_seo_elements(raw_html)
        print(json.dumps(seo_elements, indent=2))
        
        # 3. check_https_redirect (uses original URL, forcing HTTP)
        print("\n[3] check_https_redirect")
        https_result = check_https_redirect(test_url)
        print(json.dumps(https_result, indent=2))
        
        # 4. analyze_content_quality
        print("\n[4] analyze_content_quality")
        content_quality = analyze_content_quality(raw_html)
        print(json.dumps(content_quality, indent=2))
        
        # 5. check_mobile_optimization
        print("\n[5] check_mobile_optimization")
        mobile_opt = check_mobile_optimization(raw_html)
        print(json.dumps(mobile_opt, indent=2))
        
        # 6. compute_critical_content_delta
        print("\n[6] compute_critical_content_delta (has_screenshot=True)")
        # Simulating rendered DOM with identical raw_html for a demo
        delta_true = compute_critical_content_delta(seo_elements, raw_html, True)
        print(json.dumps(delta_true, indent=2))
        
        print("\n[6] compute_critical_content_delta (has_screenshot=False)")
        delta_false = compute_critical_content_delta(seo_elements, raw_html, False)
        print(json.dumps(delta_false, indent=2))
    else:
        print("\nFailed to fetch raw HTML.")

