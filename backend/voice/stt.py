"""Speech-to-text via Whisper.cpp (pywhispercpp).

Records from the default microphone with ``sounddevice`` and transcribes with a
locally-run Whisper.cpp model (``base.en`` by default). Recording uses a simple
energy-based endpointing scheme: it waits for speech to start, then stops once
it hears a short stretch of silence — so the caller does not have to specify a
fixed clip length.

Everything runs offline. The heavy Whisper model is loaded lazily and cached so
the first call pays the load cost and subsequent calls are fast.
"""

from __future__ import annotations

import numpy as np
import sounddevice as sd

from backend.config import WHISPER_MODEL

# Whisper expects 16 kHz mono float32 audio.
SAMPLE_RATE = 16_000
CHANNELS = 1
_BLOCK_SECONDS = 0.1
_BLOCK_SIZE = int(SAMPLE_RATE * _BLOCK_SECONDS)

# Endpointing tuning. RMS is computed on float32 samples in [-1, 1].
_SILENCE_RMS = 0.01          # below this counts as silence
_START_TIMEOUT_S = 8.0       # give up if no speech starts within this window
_SILENCE_HANG_S = 1.0        # stop after this much trailing silence
_MAX_UTTERANCE_S = 30.0      # hard cap on a single utterance

_model = None  # lazily-initialised pywhispercpp.model.Model


def _get_model():
    """Load (once) and return the Whisper.cpp model."""
    global _model
    if _model is None:
        # Imported lazily so importing this module never forces the native lib.
        from pywhispercpp.model import Model

        _model = Model(WHISPER_MODEL, print_realtime=False, print_progress=False)
    return _model


def record_until_silence() -> np.ndarray:
    """Capture a single spoken utterance from the mic.

    Returns a float32 numpy array of mono 16 kHz samples (possibly empty if no
    speech was detected before the start timeout).
    """
    collected: list[np.ndarray] = []
    started = False
    silence_blocks = 0
    elapsed_blocks = 0

    start_timeout_blocks = int(_START_TIMEOUT_S / _BLOCK_SECONDS)
    silence_hang_blocks = int(_SILENCE_HANG_S / _BLOCK_SECONDS)
    max_blocks = int(_MAX_UTTERANCE_S / _BLOCK_SECONDS)

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        blocksize=_BLOCK_SIZE,
    ) as stream:
        while True:
            block, _overflowed = stream.read(_BLOCK_SIZE)
            samples = np.asarray(block, dtype=np.float32).reshape(-1)
            rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
            is_speech = rms >= _SILENCE_RMS

            if not started:
                elapsed_blocks += 1
                if is_speech:
                    started = True
                    collected.append(samples)
                elif elapsed_blocks >= start_timeout_blocks:
                    return np.zeros(0, dtype=np.float32)
                continue

            collected.append(samples)
            silence_blocks = silence_blocks + 1 if not is_speech else 0

            if silence_blocks >= silence_hang_blocks:
                break
            if len(collected) >= max_blocks:
                break

    if not collected:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(collected)


def transcribe(audio: np.ndarray) -> str:
    """Transcribe float32 16 kHz mono audio to text."""
    if audio.size == 0:
        return ""
    model = _get_model()
    segments = model.transcribe(audio)
    # pywhispercpp returns segment objects with a ``.text`` attribute.
    text = " ".join(seg.text.strip() for seg in segments)
    return text.strip()


def listen() -> str:
    """Convenience: record one utterance and return its transcription."""
    audio = record_until_silence()
    return transcribe(audio)
