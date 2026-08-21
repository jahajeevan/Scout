"""Web search + page extraction (spec §13/§25).

Real results from DuckDuckGo's HTML endpoint — no API key required. Honest: if
the provider blocks or returns nothing, we return an empty list and the caller
says so rather than fabricating sources (spec §49). httpx is already a backend
dependency; no new packages.
"""

from __future__ import annotations

import html
import re
import urllib.parse

import httpx

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)
_TIMEOUT = httpx.Timeout(15.0)
_ENDPOINTS = [
    "https://html.duckduckgo.com/html/",
    "https://lite.duckduckgo.com/lite/",
]

_A_RE = re.compile(r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SNIP_RE = re.compile(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', re.S)
_TAG_RE = re.compile(r"<[^>]+>")
# lite.duckduckgo.com fallback layout
_LITE_RE = re.compile(r'<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text)).strip()


def _decode_ddg(href: str) -> str:
    if href.startswith("//"):
        href = "https:" + href
    if "duckduckgo.com/l/" in href or href.startswith("/l/"):
        q = urllib.parse.urlparse(href).query
        params = urllib.parse.parse_qs(q)
        if "uddg" in params:
            return params["uddg"][0]
    return href


async def search(query: str, max_results: int = 6) -> list[dict]:
    """Return [{title, url, snippet}] for a query. Empty list if unavailable."""
    query = (query or "").strip()
    if not query:
        return []
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _UA}, follow_redirects=True) as client:
        for endpoint in _ENDPOINTS:
            try:
                resp = await client.post(endpoint, data={"q": query})
                text = resp.text
            except Exception:
                continue
            hrefs = _A_RE.findall(text) or _LITE_RE.findall(text)
            if not hrefs:
                continue
            snippets = _SNIP_RE.findall(text)
            results: list[dict] = []
            for i, (href, title) in enumerate(hrefs):
                url = _decode_ddg(href)
                if not url.startswith("http"):
                    continue
                results.append(
                    {
                        "title": _clean(title) or url,
                        "url": url,
                        "snippet": _clean(snippets[i]) if i < len(snippets) else "",
                    }
                )
                if len(results) >= max_results:
                    break
            if results:
                return results
    return []


async def fetch_page(url: str, max_chars: int = 4000) -> str:
    """Fetch a page and return its readable text (tags stripped), truncated."""
    if not url.startswith("http"):
        return ""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": _UA}, follow_redirects=True) as client:
            resp = await client.get(url)
            body = resp.text
    except Exception:
        return ""
    body = re.sub(r"(?is)<(script|style|nav|footer|header|noscript).*?</\1>", " ", body)
    text = html.unescape(_TAG_RE.sub(" ", body))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]
