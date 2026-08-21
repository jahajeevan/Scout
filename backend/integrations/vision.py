"""Screen vision (Phase 6) — capture the Mac's screen and describe it locally.

A screenshot is taken with the built-in macOS ``screencapture`` tool, downscaled
with ``sips`` (also built in — no extra Python deps), and sent to a local LLaVA
multimodal model via Ollama's ``/api/generate`` endpoint. Everything runs on the
machine: no image ever leaves the Mac, matching JARVIS's local-first design.

macOS note: the process running this backend needs **Screen Recording**
permission (System Settings → Privacy & Security → Screen Recording) or the
capture comes back blank/black. That's an OS-level grant the user makes once.
"""

from __future__ import annotations

import asyncio
import base64
import subprocess
import tempfile
from pathlib import Path

import httpx

from backend.config import OLLAMA_HOST, VISION_MODEL

# Vision inference on a 7B model is heavier than text; give it room but not forever.
_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)

# Downscale the (often Retina) screenshot so the base64 payload stays small and
# LLaVA responds quickly. 1280px on the long edge keeps text legible enough.
_MAX_EDGE = 1280

_DEFAULT_PROMPT = (
    "You are JARVIS looking at your user's computer screen. Describe what is on "
    "the screen concisely: the app(s) in focus and what the user appears to be "
    "doing. If there is readable text that matters, mention it. Be brief."
)


def _capture_screen_jpeg_b64() -> str:
    """Capture the main display to a downscaled JPEG and return base64 (blocking)."""
    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "screen.jpg"
        # -x: silent (no shutter sound). -t jpg: JPEG. Captures the main display.
        subprocess.run(
            ["screencapture", "-x", "-t", "jpg", str(shot)],
            check=True,
            timeout=15,
            capture_output=True,
        )
        # sips resizes in place; -Z fits the image within MAX_EDGE on its long side.
        subprocess.run(
            ["sips", "-Z", str(_MAX_EDGE), str(shot)],
            check=True,
            timeout=15,
            capture_output=True,
        )
        data = shot.read_bytes()
    return base64.b64encode(data).decode("ascii")


async def describe_screen(prompt: str | None = None) -> dict[str, object]:
    """Capture the screen and return LLaVA's description of it.

    Returns ``{"ok": bool, "description": str, "error": str|None}`` so the caller
    (HTTP endpoint / voice command) can degrade gracefully rather than 500.
    """
    try:
        image_b64 = await asyncio.to_thread(_capture_screen_jpeg_b64)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "replace").strip()
        return {"ok": False, "description": "", "error": f"screen capture failed: {detail or exc}"}
    except Exception as exc:  # timeout, missing tool, etc.
        return {"ok": False, "description": "", "error": f"screen capture failed: {exc}"}

    payload = {
        "model": VISION_MODEL,
        "prompt": (prompt or "").strip() or _DEFAULT_PROMPT,
        "images": [image_b64],
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_HOST}/api/generate", json=payload)
            if resp.status_code == 404:
                return {
                    "ok": False,
                    "description": "",
                    "error": f"vision model '{VISION_MODEL}' not found — run: ollama pull {VISION_MODEL}",
                }
            resp.raise_for_status()
            description = str(resp.json().get("response", "")).strip()
    except Exception as exc:
        return {"ok": False, "description": "", "error": f"vision model error: {exc}"}

    return {"ok": True, "description": description, "error": None}
