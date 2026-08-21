"""HTTP client for the local Chatterbox TTS micro-service.

The Chatterbox model runs in its own Python process (~/chatterbox/.venv, torch +
MPS) to avoid dragging PyTorch into Scout's backend venv and to keep the model
warm across requests. This module speaks to it over 127.0.0.1 only.

Public API:
    - is_custom_voice(voice_id)  → True if voice_id belongs to a custom
      (Chatterbox) voice registered here.
    - list_custom_voices()       → list[dict] of custom voice descriptors.
    - synthesize(text, voice_id) → (samples_float32, sample_rate). Raises
      ChatterboxUnavailable if the service isn't reachable — callers should
      catch and fall back to Kokoro so the UI never breaks.
    - stop()                     → best-effort cancel of the in-flight synth.
    - is_up()                    → cheap health probe.
"""
from __future__ import annotations

import io
import logging
import os
import wave
from pathlib import Path

import numpy as np
import urllib.request
import urllib.error
import json

log = logging.getLogger(__name__)

BASE_URL = os.environ.get("SCOUT_CHATTERBOX_URL", "http://127.0.0.1:8790")
DEFAULT_TIMEOUT = float(os.environ.get("SCOUT_CHATTERBOX_TIMEOUT", "300"))
HEALTH_TIMEOUT = 1.5


class ChatterboxUnavailable(RuntimeError):
    """Raised when the local Chatterbox service can't be reached or errored."""


# Registry of custom voices this repo knows about. Each entry maps a voice id
# (used in Scout's voice picker / settings) to a filesystem path with the
# reference audio the Chatterbox service will condition on. The path stays on
# THIS machine — never sent over any wire.
_DEFAULT_REF = Path(
    os.environ.get(
        "SCOUT_CHATTERBOX_VOICE_REF",
        str(Path.home() / "chatterbox" / "jeev.wav"),
    )
)

_CUSTOM_VOICES: dict[str, dict] = {
    "me_jeev": {
        "id": "me_jeev",
        "name": "Jeev",
        "description": "Your cloned voice · Local · Chatterbox",
        "accent": "Custom",
        "gender": "Custom",
        "language": "en-us",
        "provider": "chatterbox",
        "ref_path": str(_DEFAULT_REF),
    },
}


def is_custom_voice(voice_id: str | None) -> bool:
    return bool(voice_id) and voice_id in _CUSTOM_VOICES


def list_custom_voices() -> list[dict]:
    # Strip the local ref_path from what we expose (never leak filesystem paths
    # to any UI/API caller).
    out = []
    for v in _CUSTOM_VOICES.values():
        d = {k: val for k, val in v.items() if k != "ref_path"}
        out.append(d)
    return out


def is_up() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=HEALTH_TIMEOUT) as r:
            return r.status == 200
    except Exception:
        return False


def _decode_wav(payload: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(payload), "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
        sampwidth = w.getsampwidth()
        channels = w.getnchannels()
    if sampwidth == 2:
        arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sampwidth == 4:
        arr = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ChatterboxUnavailable(f"unexpected sample width {sampwidth}")
    if channels > 1:
        arr = arr.reshape(-1, channels).mean(axis=1)
    return arr, int(sr)


def synthesize(text: str, voice_id: str) -> tuple[np.ndarray, int]:
    """Synthesize `text` in the custom `voice_id`. Returns (float32 mono, sr)."""
    if not is_custom_voice(voice_id):
        raise ChatterboxUnavailable(f"unknown custom voice {voice_id!r}")
    ref_path = _CUSTOM_VOICES[voice_id]["ref_path"]
    body = json.dumps({"text": text, "voice_ref": ref_path}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/speak",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "audio/wav"},
    )
    try:
        with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as r:
            audio = r.read()
    except urllib.error.URLError as exc:
        raise ChatterboxUnavailable(f"cannot reach chatterbox service at {BASE_URL}: {exc}") from exc
    except Exception as exc:  # HTTPError, timeouts, etc.
        raise ChatterboxUnavailable(f"chatterbox request failed: {exc}") from exc
    if not audio:
        raise ChatterboxUnavailable("empty audio from chatterbox")
    return _decode_wav(audio)


def stop() -> None:
    try:
        req = urllib.request.Request(f"{BASE_URL}/stop", method="POST", data=b"")
        urllib.request.urlopen(req, timeout=HEALTH_TIMEOUT).read()
    except Exception:
        pass
