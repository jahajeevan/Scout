"""Wake-word listener (Phase 5) — openWakeWord "Hey JARVIS".

Streams the mic in 80ms frames and blocks until the pretrained "hey_jarvis"
model fires. Runs on ONNX (works with numpy 2, so it shares the voice venv with
Kokoro — no separate environment needed). The models are downloaded once via
``openwakeword.utils.download_models()`` and cached inside the package.
"""

from __future__ import annotations

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16_000
FRAME = 1280  # openWakeWord expects 1280-sample (80ms) chunks at 16kHz
THRESHOLD = 0.5

_model = None


def _get_model():
    """Load (once) the 'hey_jarvis' wake-word model, downloading if needed."""
    global _model
    if _model is None:
        import openwakeword
        from openwakeword.model import Model

        try:
            openwakeword.utils.download_models()  # no-op if already cached
        except Exception:
            pass
        _model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    return _model


def preload() -> None:
    """Eagerly load the wake model so the first detection isn't delayed."""
    _get_model()


def wait_for_wake(threshold: float = THRESHOLD) -> bool:
    """Block until 'Hey JARVIS' is heard on the mic. Returns True when detected."""
    model = _get_model()
    # Clear any stale scores so we don't instantly re-fire on the previous wake.
    try:
        for key in list(model.prediction_buffer):
            model.prediction_buffer[key].clear()
    except Exception:
        pass

    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME
    ) as stream:
        while True:
            block, _overflowed = stream.read(FRAME)
            samples = np.asarray(block, dtype=np.int16).reshape(-1)
            scores = model.predict(samples)
            if float(scores.get("hey_jarvis", 0.0)) >= threshold:
                return True
