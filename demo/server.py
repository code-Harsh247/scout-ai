#!/usr/bin/env python3
"""
Simple HTTP server for the Scout AI demo site.

Usage:
    cd demo
    python server.py

The site will be available at http://localhost:8080
Point your Scout AI crawler at: http://localhost:8080
"""

import http.server
import socketserver
import os

PORT = 8080

class Handler(http.server.SimpleHTTPRequestHandler):
    """Serve files from the demo/ directory with sensible logging."""

    def log_message(self, format, *args):
        status = args[1] if len(args) > 1 else "---"
        # Colour-code: green for 2xx, yellow for 3xx, red for 4xx/5xx
        code = str(status)
        if code.startswith("2"):
            colour = "\033[32m"
        elif code.startswith("3"):
            colour = "\033[33m"
        else:
            colour = "\033[31m"
        reset = "\033[0m"
        print(f"  {self.address_string()} {colour}{format % args}{reset}")


def main():
    # Always serve from the directory that contains this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n  Scout AI demo site")
        print(f"  Running at: http://localhost:{PORT}")
        print(f"  Serving:    {script_dir}")
        print(f"\n  Point your crawler at: http://localhost:{PORT}")
        print("  Press Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Server stopped.")


if __name__ == "__main__":
    main()
