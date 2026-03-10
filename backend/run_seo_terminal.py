import json
import sys
from pprint import pprint

from dotenv import load_dotenv
load_dotenv()

# Import the orchestrator agent and raw fetcher test dependency
from agents.seo_agent import run_seo_audit
from tools.seo_scraper import fetch_raw_html

def run_seo_terminal():
    print("=========================================")
    print(" Scout AI - SEO Agent Terminal Runner    ")
    print("=========================================")
    
    while True:
        try:
            url = input("\nEnter a URL to analyze (or 'q' to quit): ").strip()
            
            if url.lower() in ['q', 'quit', 'exit']:
                print("Exiting...")
                break
                
            if not url:
                continue
                
            if not url.startswith('http'):
                url = 'https://' + url
                
            # Optional: Ask for competitors
            comp_input = input("Enter competitor URLs (comma separated) or press Enter to skip: ").strip()
            competitors = [c.strip() for c in comp_input.split(',')] if comp_input else None
                
            print(f"\n[+] Fetching raw HTML for: {url}")
            fetch_result = fetch_raw_html(url)
            raw_html = fetch_result.get("raw_html", "")
            
            if not raw_html:
                print(f"[!] Failed to fetch raw HTML. Error: {fetch_result.get('error')}")
                continue
                
            print("[+] Running SEO Agent LLM Audit... This will take 10-20 seconds.")
            
            # SIMULATING PLAYWRIGHT: Usually the rendered DOM comes from vision_scraper.py
            # For this terminal test script, we will just pass the raw_html as the rendered_dom
            # so the crawlability delta function doesn't crash.
            report = run_seo_audit(
                url=url, 
                raw_html=raw_html, 
                rendered_dom=raw_html, 
                playwright_succeeded=True,
                competitor_urls=competitors
            )
            
            print("\n================== RESULTS ==================")
            pprint(report, width=100)
            print("=============================================\n")
            
        except KeyboardInterrupt:
            print("\nExiting...")
            break
        except Exception as e:
            print(f"\n[!] Unexpected error: {e}")

if __name__ == "__main__":
    run_seo_terminal()
