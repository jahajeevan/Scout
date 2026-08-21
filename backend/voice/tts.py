"""Text-to-speech via Kokoro (kokoro-onnx).

Synthesises speech locally with the Kokoro ONNX model and plays it through the
default output device with ``sounddevice``. Voice defaults to ``af_bella`` from
config. Fully offline once the model files are present.

Kokoro-onnx (0.3.5) needs two model assets alongside the code:
  * ``kokoro-v0_19.onnx``   (the ONNX model)
  * ``voices.bin``          (the voice/style table, an ``np.load``-able .npz)
By default we look for them in ``<repo>/backend/voice/models``; override with the
``KOKORO_MODEL_PATH`` / ``KOKORO_VOICES_PATH`` environment variables. Both are
published on the official kokoro-onnx "model-files" GitHub release.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd

from backend.config import TTS_VOICE

_MODELS_DIR = Path(__file__).resolve().parent / "models"
_MODEL_PATH = Path(os.environ.get("KOKORO_MODEL_PATH", _MODELS_DIR / "kokoro-v0_19.onnx"))
_VOICES_PATH = Path(os.environ.get("KOKORO_VOICES_PATH", _MODELS_DIR / "voices.bin"))

_kokoro = None  # lazily-initialised kokoro_onnx.Kokoro


def _get_kokoro():
    """Load (once) and return the Kokoro synthesiser."""
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro

        _kokoro = Kokoro(str(_MODEL_PATH), str(_VOICES_PATH))
    return _kokoro


def preload() -> None:
    """Eagerly load the Kokoro model so the first ``speak`` isn't delayed.

    Loading the ~310 MB ONNX model takes several seconds; calling this at startup
    moves that cost off the first spoken reply.
    """
    _get_kokoro()


def synthesize(text: str, voice: str = TTS_VOICE) -> tuple[np.ndarray, int]:
    """Synthesise ``text`` and return ``(samples_float32, sample_rate)``.

    Routes custom voices (e.g. the user's cloned voice) to the local Chatterbox
    micro-service; everything else uses Kokoro. If Chatterbox is unreachable or
    errors, we transparently fall back to Kokoro's default voice so the reply is
    still spoken.
    """
    from backend.voice import chatterbox_client as _cb

    if _cb.is_custom_voice(voice):
        try:
            return _cb.synthesize(text, voice)
        except _cb.ChatterboxUnavailable as exc:
            print(f"[tts] chatterbox unavailable ({exc}); falling back to Kokoro")
            voice = TTS_VOICE  # fall through to Kokoro path

    kokoro = _get_kokoro()
    samples, sample_rate = kokoro.create(text, voice=voice, speed=1.0, lang="en-us")
    return np.asarray(samples, dtype=np.float32), int(sample_rate)


def _play_afplay(samples: np.ndarray, sample_rate: int) -> None:
    """Play audio via macOS's native ``afplay`` (routes to the real default output)."""
    import subprocess
    import tempfile
    import wave

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        path = fh.name
    try:
        pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(int(sample_rate))
            w.writeframes(pcm16.tobytes())
        subprocess.run(["afplay", path], check=True)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _play_sounddevice(samples: np.ndarray, sample_rate: int) -> None:
    """Play audio via the sounddevice/PortAudio stack (the listed dependency)."""
    sd.play(samples, sample_rate)
    sd.wait()


def play(samples: np.ndarray, sample_rate: int) -> None:
    """Play synthesised audio, blocking until done.

    On macOS ``afplay`` is preferred because it reliably reaches the speakers the
    user actually hears; ``sounddevice`` is used as the fallback (and as the
    primary path on other platforms).
    """
    if sys.platform == "darwin":
        try:
            _play_afplay(samples, sample_rate)
            return
        except Exception as exc:  # pragma: no cover - hardware dependent
            print(f"[tts] afplay failed ({exc!r}); falling back to sounddevice")
    _play_sounddevice(samples, sample_rate)


def speak(text: str, voice: str = TTS_VOICE) -> None:
    """Synthesise ``text`` and play it, blocking until playback completes."""
    text = text.strip()
    if not text:
        return
    samples, sample_rate = synthesize(text, voice=voice)
    play(samples, sample_rate)
