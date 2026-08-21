"""News integration (Phase 4) — Hacker News (free, no API key, no signup).

Fetches the current top-story headlines from the official Hacker News Firebase
API. Needs internet (Phase 4 features are online by design).
"""

from __future__ import annotations

import asyncio

import httpx

_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
_ITEM = "https://hacker-news.firebaseio.com/v0/item/{id}.json"
_TIMEOUT = httpx.Timeout(8.0)


async def _fetch_item(client: httpx.AsyncClient, item_id: int) -> dict[str, str] | None:
    try:
        resp = await client.get(_ITEM.format(id=item_id))
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None
    title = data.get("title")
    if not title:
        return None
    return {"title": title, "url": data.get("url", "")}


async def get_news(limit: int = 5) -> list[dict[str, str]]:
    """Return the top `limit` Hacker News headlines."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(_TOP)
        resp.raise_for_status()
        ids = resp.json()[: max(0, limit)]
        items = await asyncio.gather(*(_fetch_item(client, i) for i in ids))
    return [item for item in items if item is not None]
