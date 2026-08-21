"""Image generation (spec §47) — text → image as a first-class capability.

Uses NVIDIA's FLUX.1-schnell (a fast, 4-step distilled model) on the genai
endpoint, which is a *different* API shape from the chat models — so it lives
behind its own small module rather than being a "random API call inside chat"
(spec §47). Returns a ready-to-render ``data:`` URI. Honest failure: if the model
is cold/overloaded on the free tier the call raises a clear, human error the UI
surfaces rather than pretending.
"""

from __future__ import annotations

import base64

import httpx

from backend.config import NVIDIA_API_KEY

# FLUX schnell is guidance-distilled → cfg_scale must be 0, 4 steps is enough.
_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell"
# Free-tier image models cold-start slowly. Cap the wait so the UI fails fast and
# honestly instead of hanging for minutes; the first call warms the model, so a
# retry a moment later often succeeds.
_TIMEOUT = httpx.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0)


def _extract_data_uri(payload: dict) -> str | None:
    """Pull a base64 image out of whatever shape the endpoint returns."""
    # Common shapes: {"artifacts":[{"base64":...}]}, {"images":["data:..."]},
    # {"data":[{"b64_json":...}]}, {"image":"<b64 or data-uri>"}.
    candidates: list = []
    for key in ("artifacts", "images", "data"):
        v = payload.get(key)
        if isinstance(v, list):
            candidates.extend(v)
    if payload.get("image"):
        candidates.append(payload["image"])

    for c in candidates:
        b64 = None
        if isinstance(c, str):
            b64 = c
        elif isinstance(c, dict):
            b64 = c.get("base64") or c.get("b64_json") or c.get("image") or c.get("url")
        if not b64:
            continue
        if b64.startswith("data:") or b64.startswith("http"):
            return b64
        return f"data:image/png;base64,{b64}"
    return None


async def generate(prompt: str, *, width: int = 1024, height: int = 1024, steps: int = 4, seed: int = 0) -> str:
    """Generate an image from ``prompt``. Returns a data: URI. Raises on failure."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise RuntimeError("An image prompt is required.")
    if not NVIDIA_API_KEY:
        raise RuntimeError("NVIDIA_API_KEY is not set — add it to .env and restart.")

    body = {
        "prompt": prompt,
        "cfg_scale": 0,
        "mode": "base",
        "width": width,
        "height": height,
        "seed": seed,
        "steps": steps,
    }
    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.post(_ENDPOINT, headers=headers, json=body)
        except httpx.TimeoutException:
            raise RuntimeError("The image model is warming up (free tier) — try again in a moment.")
        if resp.status_code >= 400:
            raise RuntimeError(f"Image generation failed ({resp.status_code}): {resp.text[:160]}")
        data = resp.json()

    uri = _extract_data_uri(data)
    if not uri:
        raise RuntimeError("The image service returned no image.")
    return uri
