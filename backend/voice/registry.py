"""Voice registry (spec §11/§12/§16) — the ACTUAL Kokoro voices, presented well.

Voice ids come straight from ``voices.bin`` (no invented voices). The id encodes
real attributes: first letter = accent (a=American, b=British), second = gender
(f=Female, m=Male), suffix = the voice's given name. We surface those factual
attributes plus a curated one-line personality descriptor so each voice feels
like a person — without misrepresenting what the provider actually is.

The selected default is persisted to ``config/scout_settings.json`` so both the
message "Speak" action and Talk use it.
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.config import ROOT_DIR, TTS_VOICE

_VOICES_PATH = Path(__file__).resolve().parent / "models" / "voices.bin"
_SETTINGS_PATH = ROOT_DIR / "config" / "scout_settings.json"

_ACCENT = {"a": ("American", "en-us"), "b": ("British", "en-gb")}
_GENDER = {"f": "Female", "m": "Male"}

# Curated presentation layer: a memorable name + a short personality line. The
# names are the voices' own; descriptors are a light editorial touch. Accent and
# gender below are derived factually from the id, never guessed.
_CURATED: dict[str, tuple[str, str]] = {
    "af": ("Aria", "Balanced · Neutral · Clear"),
    "af_bella": ("Bella", "Warm · Expressive"),
    "af_nicole": ("Nicole", "Soft · Gentle"),
    "af_sarah": ("Sarah", "Bright · Friendly"),
    "af_sky": ("Sky", "Light · Youthful"),
    "am_adam": ("Adam", "Deep · Steady"),
    "am_michael": ("Michael", "Confident · Professional"),
    "bf_emma": ("Emma", "Refined · Warm"),
    "bf_isabella": ("Isabella", "Elegant · Composed"),
    "bm_george": ("George", "Mature · Authoritative"),
    "bm_lewis": ("Lewis", "Calm · Distinguished"),
}

_ids_cache: list[str] | None = None


def _load_ids() -> list[str]:
    global _ids_cache
    if _ids_cache is not None:
        return _ids_cache
    try:
        import numpy as np

        data = np.load(str(_VOICES_PATH))
        _ids_cache = list(data.files)
    except Exception:
        _ids_cache = []
    return _ids_cache


def _describe(vid: str) -> dict:
    accent, lang = _ACCENT.get(vid[:1], ("American", "en-us"))
    gender = _GENDER.get(vid[1:2], "Female")
    name, personality = _CURATED.get(vid, (vid.split("_")[-1].capitalize() or vid, f"{accent} · {gender}"))
    return {
        "id": vid,
        "name": name,
        "description": personality,
        "accent": accent,
        "gender": gender,
        "language": lang,
        "provider": "kokoro",
    }


def list_voices() -> list[dict]:
    """Every voice actually available, with real attributes + curated names.

    Kokoro voices come from ``voices.bin``; custom voices (e.g. the user's own
    cloned voice served by the local Chatterbox micro-service) are appended
    from ``chatterbox_client.list_custom_voices()``.
    """
    kokoro = [_describe(v) for v in _load_ids()]
    try:
        from backend.voice import chatterbox_client as _cb

        return kokoro + _cb.list_custom_voices()
    except Exception:
        return kokoro


def is_valid(voice: str) -> bool:
    if voice in _load_ids():
        return True
    try:
        from backend.voice import chatterbox_client as _cb

        return _cb.is_custom_voice(voice)
    except Exception:
        return False


def get_default_voice() -> str:
    try:
        cfg = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
        v = cfg.get("voice")
        if v and is_valid(v):
            return v
    except Exception:
        pass
    return TTS_VOICE


def set_default_voice(voice: str) -> dict:
    if not is_valid(voice):
        return {"ok": False, "voice": get_default_voice(), "reason": f"unknown voice {voice!r}"}
    try:
        cfg = {}
        if _SETTINGS_PATH.exists():
            cfg = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
        cfg["voice"] = voice
        _SETTINGS_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except Exception as exc:
        return {"ok": False, "voice": get_default_voice(), "reason": str(exc)}
    return {"ok": True, "voice": voice}
