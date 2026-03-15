"""
BrokenLinkChecker — async HTTP health-check for discovered links.

Uses HEAD with GET fallback, follows redirects, classifies the final response.
"""

import logging
from typing import Dict

import httpx

log = logging.getLogger("scout")

_TIMEOUT = 10.0
_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; ScoutBot/1.0; +https://scout.ai)',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
}


async def check_link(client: httpx.AsyncClient, url: str) -> Dict:
    """
    Issue HEAD (GET fallback) on *url* and return a classification dict:
      { status_code, link_status, final_url, error }

    link_status values:
      ok | redirect | broken | client_error | server_error | unreachable
    """
    try:
        try:
            resp = await client.head(url, timeout=_TIMEOUT, follow_redirects=True, headers=_HEADERS)
        except (httpx.HTTPStatusError, httpx.RemoteProtocolError):
            resp = await client.get(url, timeout=_TIMEOUT, follow_redirects=True, headers=_HEADERS)

        code = resp.status_code
        final_url = str(resp.url)

        if code < 300:
            status = 'ok'
        elif code < 400:
            status = 'redirect'
        elif code == 404:
            status = 'broken'
        elif code < 500:
            status = 'client_error'
        else:
            status = 'server_error'

        return {'status_code': code, 'link_status': status, 'final_url': final_url, 'error': None}

    except httpx.TimeoutException:
        return {'status_code': None, 'link_status': 'unreachable', 'final_url': url, 'error': 'timeout'}
    except httpx.ConnectError:
        return {'status_code': None, 'link_status': 'unreachable', 'final_url': url, 'error': 'connect_error'}
    except Exception as e:
        log.debug("[link_check] %s → %s", url, e)
        return {'status_code': None, 'link_status': 'unreachable', 'final_url': url, 'error': str(e)}
