"""Giphy v1 GIF search — the working alternative after Tenor closed to new
API clients (Jan 2026).

Public API:
    search(query, limit)   → list[dict] of {url, preview, title, width, height}
    trending(limit)        → same shape, popular GIFs when the user hasn't typed
    is_configured()        → True if GIPHY_API_KEY is set

Get a free key: https://developers.giphy.com → Create App → API key
Then add ``GIPHY_API_KEY=…`` to .env and restart the backend.

Falls back cleanly when the key is missing — callers get an empty list plus a
``configured=False`` signal so the UI can prompt for setup instead of exploding.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

BASE = "https://api.giphy.com/v1"
DEFAULT_TIMEOUT = 6.0
# g / pg / pg-13 / r — Scout stays PG by default. Overridable via env.
DEFAULT_RATING = os.environ.get("GIPHY_RATING", "pg-13").strip().lower() or "pg-13"


def is_configured() -> bool:
    return bool(os.environ.get("GIPHY_API_KEY", "").strip())


def _pick_media(item: dict) -> dict | None:
    """Giphy returns an `images` dict of many renditions. Pick the best full
    GIF and a small preview, tolerating any renditions being absent."""
    images = item.get("images") or {}
    full = images.get("original") or images.get("downsized_medium") or images.get("downsized")
    preview = (
        images.get("preview_gif")
        or images.get("fixed_width_small")
        or images.get("fixed_height_small")
        or full
    )
    if not full or not full.get("url"):
        return None
    try:
        w = int(full.get("width") or 0)
        h = int(full.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    return {
        "url": full["url"],
        "preview": (preview or full).get("url", full["url"]),
        "title": item.get("title") or "",
        "width": w,
        "height": h,
    }


async def _fetch(endpoint: str, params: dict[str, Any]) -> dict:
    key = os.environ.get("GIPHY_API_KEY", "").strip()
    if not key:
        return {"data": []}
    q = {"api_key": key, "rating": DEFAULT_RATING, **params}
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(f"{BASE}/{endpoint}", params=q)
        r.raise_for_status()
        return r.json()


async def search(query: str, limit: int = 20) -> list[dict]:
    if not is_configured():
        return []
    data = await _fetch("gifs/search", {"q": query, "limit": max(1, min(50, limit))})
    return [m for m in (_pick_media(item) for item in data.get("data", [])) if m]


async def trending(limit: int = 20) -> list[dict]:
    if not is_configured():
        return []
    data = await _fetch("gifs/trending", {"limit": max(1, min(50, limit))})
    return [m for m in (_pick_media(item) for item in data.get("data", [])) if m]
