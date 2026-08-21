"""Tenor v2 GIF search — free tier, Google-issued key.

Public API:
    search(query, limit)   → list[dict] of {url, preview, title, width, height}
    trending(limit)        → same shape, popular GIFs when the user hasn't typed
    is_configured()        → True if TENOR_API_KEY is set

Get a free key: https://developers.google.com/tenor/guides/quickstart
Then add ``TENOR_API_KEY=…`` to .env and restart the backend.

Falls back cleanly when the key is missing — callers get an empty list plus a
``configured=False`` signal so the UI can prompt for setup instead of exploding.
"""
from __future__ import annotations

import os
from typing import Any

import httpx

BASE = "https://tenor.googleapis.com/v2"
CLIENT_KEY = "scout-personal-intelligence"
DEFAULT_TIMEOUT = 5.0


def is_configured() -> bool:
    return bool(os.environ.get("TENOR_API_KEY", "").strip())


def _pick_media(result: dict) -> dict | None:
    """Tenor v2 returns a media_formats dict per result — pick a reasonable
    animated + preview pair. Order of preference: gif (full), tinygif (preview)."""
    fmts = result.get("media_formats") or {}
    full = fmts.get("gif") or fmts.get("mediumgif") or fmts.get("tinygif")
    preview = fmts.get("tinygif") or fmts.get("nanogif") or full
    if not full or not full.get("url"):
        return None
    dims = full.get("dims") or [0, 0]
    return {
        "url": full["url"],
        "preview": (preview or full).get("url", full["url"]),
        "title": result.get("content_description") or result.get("title") or "",
        "width": int(dims[0]) if dims else 0,
        "height": int(dims[1]) if len(dims) > 1 else 0,
    }


async def _fetch(endpoint: str, params: dict[str, Any]) -> dict:
    key = os.environ.get("TENOR_API_KEY", "").strip()
    if not key:
        return {"results": []}
    q = {"key": key, "client_key": CLIENT_KEY, "media_filter": "gif,tinygif,nanogif", **params}
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        r = await client.get(f"{BASE}/{endpoint}", params=q)
        r.raise_for_status()
        return r.json()


async def search(query: str, limit: int = 20) -> list[dict]:
    if not is_configured():
        return []
    data = await _fetch("search", {"q": query, "limit": max(1, min(50, limit))})
    return [m for m in (_pick_media(r) for r in data.get("results", [])) if m]


async def trending(limit: int = 20) -> list[dict]:
    if not is_configured():
        return []
    data = await _fetch("featured", {"limit": max(1, min(50, limit))})
    return [m for m in (_pick_media(r) for r in data.get("results", [])) if m]
