"""SCOUT — native macOS menu-bar service + overlay (spec §5–§7, §12).

SCOUT lives on the Mac, not in the browser. This is a background menu-bar app
that talks to the same SCOUT backend (localhost:8000) as the web UI — shared
memory, models, voice, tools. It provides:

* A menu-bar item with live backend status.
* "Talk to Scout" — a native voice turn (mic → /voice → speaker), independent of
  any browser. Works while you're in VS Code, Finder, anything.
* A wake-word listener that triggers Talk hands-free.
* A small always-on-top OVERLAY showing Listening / Thinking / Speaking above the
  active app (not a browser popup, spec §7).
* Emergency Stop (spec §12) — halts recording + playback immediately.
* "Open Scout" — opens the web command center.

Run:  python3.11 macos/scout.py   (from the repo root, in the project venv)
Auto-start at login: see macos/com.scout.menubar.plist + macos/install.sh

Wake word: the listener is ON by default (say the wake phrase → Scout opens in the
browser AND starts listening). Turn it off from the menu.

Wake engines (auto-selected; override with SCOUT_WAKE_ENGINE):
* "Hey Scout" via Vosk — fully local, no account, DEFAULT when the model folder
  macos/assets/vosk-model is present (SCOUT_VOSK_MODEL to relocate).
* "Hey Scout" via Picovoice Porcupine — if PICOVOICE_ACCESS_KEY + a .ppn are set
  (Picovoice Console now needs a company email, so this is optional).
* "Hey Jarvis" via openWakeWord — fallback when neither of the above is available.
See macos/README.md.
* This is a native GUI app; it must be launched on a real Mac session (it cannot
  run headless). If a piece of the overlay fails on your macOS version, the menu
  and Talk still work — the overlay is guarded.
"""

from __future__ import annotations

import base64
import io
import os
import subprocess
import sys
import tempfile
import threading
import time
import warnings
import wave
from pathlib import Path

import httpx
import numpy as np
import rumps

# PyObjC prints a harmless ObjCPointerWarning for CGColor pointers it can't
# memory-manage (from the orb gradient). Silence it — purely cosmetic.
try:
    from objc import ObjCPointerWarning

    warnings.filterwarnings("ignore", category=ObjCPointerWarning)
except Exception:
    pass

# Force the app identity to "Scout" BEFORE AppKit builds NSApplication, so the
# Dock / app menu / ⌘-Tab all read "Scout" instead of "Python" (the launcher
# execs the framework python). Runs at import time — earliest possible.
def _force_scout_identity() -> None:
    try:
        from Foundation import NSBundle

        info = NSBundle.mainBundle().infoDictionary()
        if info is not None:
            info["CFBundleName"] = "Scout"
            info["CFBundleDisplayName"] = "Scout"
            info["CFBundleExecutable"] = "Scout"
    except Exception:
        pass
    try:
        from Foundation import NSProcessInfo

        NSProcessInfo.processInfo().setProcessName_("Scout")
    except Exception:
        pass


_force_scout_identity()

# Make the backend package importable (reuse STT recording helpers, config).
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

# Asset + state directories. When frozen by py2app they live in the .app's
# Resources; otherwise in the repo. State (the onboarding marker) must be writable,
# so it goes to Application Support when frozen.
if getattr(sys, "frozen", False):
    _ASSETS = Path(sys.executable).resolve().parent.parent / "Resources" / "assets"
    _STATE_DIR = Path.home() / "Library" / "Application Support" / "Scout"
else:
    _ASSETS = _ROOT / "macos" / "assets"
    _STATE_DIR = _ROOT / "config"

BACKEND = os.environ.get("SCOUT_BACKEND", "http://localhost:8000")
WEB_URL = os.environ.get("SCOUT_URL", "http://localhost:3000")
WAKE_MODEL = os.environ.get("SCOUT_WAKE_MODEL", "hey_jarvis")  # openWakeWord pretrained

# Real "Hey Scout" via Picovoice Porcupine (custom keyword). Set both to enable it;
# otherwise Scout falls back to the openWakeWord "hey_jarvis" model above.
#   PICOVOICE_ACCESS_KEY — free key from https://console.picovoice.ai
#   SCOUT_PPN            — path to a "Hey Scout" .ppn generated there for macOS
# If SCOUT_PPN is unset we also look for macos/assets/hey_scout.ppn.
PICOVOICE_KEY = os.environ.get("PICOVOICE_ACCESS_KEY", "").strip()
_ppn_env = os.environ.get("SCOUT_PPN", "").strip()
_ppn_default = str(_ASSETS / "hey_scout.ppn")
SCOUT_PPN = _ppn_env or (_ppn_default if os.path.exists(_ppn_default) else "")

# Fully-local "Hey Scout" via Vosk (offline speech recogniser used as a keyword
# spotter). No account or key needed — just the model folder. This is the default
# "Hey Scout" engine; download the small model into macos/assets/vosk-model.
SCOUT_VOSK_MODEL = os.environ.get("SCOUT_VOSK_MODEL", str(_ASSETS / "vosk-model"))
# Optional hard override: "vosk" | "porcupine" | "openwakeword" | "" (auto).
SCOUT_WAKE_ENGINE = os.environ.get("SCOUT_WAKE_ENGINE", "").strip().lower()

SAMPLE_RATE = 16_000
FRAME = 1280  # openWakeWord 80ms frames
# VAD thresholds (RMS on float32 in [-1,1])
START_RMS = 0.02
SILENCE_RMS = 0.012
SILENCE_HANG_S = 1.0
MAX_UTTERANCE_S = 15.0
NO_SPEECH_S = 8.0


# --------------------------------------------------------------------------- #
# Spotlight — a floating assistant panel (blurred, rounded, centred), with a
# live text field and inline answers. Everything is guarded so any AppKit
# failure degrades gracefully to a no-op rather than crashing the app. All UI
# calls hop onto the main thread via AppHelper.callAfter.
# --------------------------------------------------------------------------- #
class Spotlight:
    def __init__(self, on_submit=None) -> None:
        self._ok = False
        self._on_submit = on_submit
        try:
            import math as _math

            import objc as _objc
            from AppKit import (
                NSBackingStoreBuffered,
                NSBezierPath,
                NSColor,
                NSCompositingOperationSourceOver,
                NSFont,
                NSImage,
                NSImageView,
                NSMakeRect,
                NSPanel,
                NSScreen,
                NSTextField,
                NSView,
                NSWindowStyleMaskBorderless,
                NSZeroRect,
            )
            from Foundation import NSObject

            W, H = 440.0, 132.0
            RADIUS = 26.0
            screen = NSScreen.mainScreen().frame()
            x = (screen.size.width - W) / 2.0         # top-CENTRE — Scout's own spot
            y = screen.size.height - H - 40.0         # just under the menu bar

            # Borderless panels can't become key by default — subclass to allow
            # the text field to receive keystrokes.
            class _KeyPanel(NSPanel):
                def canBecomeKeyWindow(self):
                    return True

            panel = _KeyPanel.alloc().initWithContentRect_styleMask_backing_defer_(
                NSMakeRect(x, y, W, H), NSWindowStyleMaskBorderless, NSBackingStoreBuffered, False
            )
            panel.setLevel_(1000)
            panel.setOpaque_(False)
            panel.setBackgroundColor_(NSColor.clearColor())
            panel.setHasShadow_(True)
            panel.setMovableByWindowBackground_(True)
            # Show above every Space / full-screen app and don't vanish when the
            # menu-bar app "deactivates" — this is why an accessory app's panel can
            # otherwise seem to never appear.
            try:
                panel.setCollectionBehavior_((1 << 0) | (1 << 8))  # canJoinAllSpaces | fullScreenAuxiliary
                panel.setHidesOnDeactivate_(False)
            except Exception:
                pass

            # Layer-backed dark-glass card — a deep vertical gradient with a hairline
            # rim, guaranteed to render on any macOS/wallpaper. (The old
            # NSVisualEffectView could come out fully transparent on newer macOS.)
            content = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, W, H))
            content.setWantsLayer_(True)
            try:
                layer = content.layer()
                layer.setCornerRadius_(RADIUS)
                layer.setMasksToBounds_(True)
                layer.setBackgroundColor_(
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(0.05, 0.05, 0.09, 0.97).CGColor()
                )
                layer.setBorderWidth_(1.0)
                layer.setBorderColor_(
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(1, 1, 1, 0.12).CGColor()
                )
                # Premium touch: a subtle deep-violet→black gradient wash.
                try:
                    from Quartz import CAGradientLayer

                    grad = CAGradientLayer.layer()
                    grad.setFrame_(NSMakeRect(0, 0, W, H))
                    grad.setCornerRadius_(RADIUS)
                    grad.setColors_([
                        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.13, 0.10, 0.22, 0.96).CGColor(),
                        NSColor.colorWithCalibratedRed_green_blue_alpha_(0.03, 0.03, 0.06, 0.98).CGColor(),
                    ])
                    grad.setStartPoint_((0.15, 1.0))
                    grad.setEndPoint_((0.6, 0.0))
                    layer.insertSublayer_atIndex_(grad, 0)
                except Exception:
                    pass
            except Exception:
                pass
            blur = content  # keep the rest of the layout code unchanged
            panel.setContentView_(content)

            # Scout Halo — a small teal core wrapped in a ring of thin bars that
            # dance with the REAL signal (mic while listening, TTS envelope while
            # speaking). Restrained: thin bars, teal with a sparing gold accent —
            # Scout's own look, not a Siri blob. Falls back to a static orb view.
            ORB = 116.0
            orb_left = 14.0
            text_left = orb_left
            self._frames = []
            self._orb = None      # legacy image-view fallback
            self._ring = None     # the reactive Halo ring (preferred)

            class _HaloRing(NSView):
                def initWithFrame_core_(self, frame, core):
                    self = _objc.super(_HaloRing, self).initWithFrame_(frame)
                    if self is None:
                        return None
                    self._level = 0.0
                    self._phase = 0.0
                    self._core = core
                    return self

                def setLevel_(self, lv):
                    self._level = float(lv)

                def advance_(self, dp):
                    self._phase += float(dp)

                def drawRect_(self, rect):
                    try:
                        b = self.bounds()  # draw in the view's own coords (not the dirty rect)
                        w, h = b.size.width, b.size.height
                        if not getattr(self, "_dbg", False):
                            self._dbg = True
                            print(f"[scout] halo ring: {w:.0f}x{h:.0f} @ frame_x={self.frame().origin.x:.0f}", flush=True)
                        cx, cy = w / 2.0, h / 2.0
                        size = min(w, h)
                        coreR = size * 0.27
                        ringR = size * 0.33
                        maxBar = size * 0.14
                        if self._core is not None:
                            d = coreR * 2
                            self._core.drawInRect_fromRect_operation_fraction_(
                                NSMakeRect(cx - coreR, cy - coreR, d, d),
                                NSZeroRect, NSCompositingOperationSourceOver, 1.0,
                            )
                        teal = NSColor.colorWithCalibratedRed_green_blue_alpha_(0.24, 0.87, 0.80, 0.92)
                        gold = NSColor.colorWithCalibratedRed_green_blue_alpha_(1.0, 0.77, 0.36, 0.92)
                        n = 44
                        lv = max(0.0, min(1.0, self._level))
                        for i in range(n):
                            a = (i / float(n)) * 2 * _math.pi + self._phase
                            var = 0.35 + 0.65 * abs(_math.sin(i * 0.7 + self._phase * 2.0))
                            length = maxBar * (0.22 + lv * var * 1.35 + 0.12 * var)
                            x1 = cx + _math.cos(a) * ringR
                            y1 = cy + _math.sin(a) * ringR
                            x2 = cx + _math.cos(a) * (ringR + length)
                            y2 = cy + _math.sin(a) * (ringR + length)
                            path = NSBezierPath.bezierPath()
                            path.setLineWidth_(2.0)
                            path.setLineCapStyle_(1)
                            (gold if i % 9 == 0 else teal).set()
                            path.moveToPoint_((x1, y1))
                            path.lineToPoint_((x2, y2))
                            path.stroke()
                    except Exception:
                        pass

            try:
                frames_dir = _ASSETS / "orb_frames"
                core_img = None
                if os.path.exists(_ORB_ICON):
                    core_img = NSImage.alloc().initByReferencingFile_(_ORB_ICON)
                self._ring = _HaloRing.alloc().initWithFrame_core_(
                    NSMakeRect(orb_left, (H - ORB) / 2.0, ORB, ORB), core_img
                )
                self._ring.setWantsLayer_(True)
                self._ring.setFrame_(NSMakeRect(orb_left, (H - ORB) / 2.0, ORB, ORB))
                self._ring.setAutoresizingMask_(0)  # NSViewNotSizable — pin it (don't drift on reposition)
                blur.addSubview_(self._ring)
                text_left = orb_left + ORB + 8
            except Exception as exc:
                print(f"[scout] halo ring unavailable ({exc}); using static orb", flush=True)
                self._ring = None
                if os.path.exists(_ORB_ICON):
                    self._orb = NSImageView.alloc().initWithFrame_(
                        NSMakeRect(orb_left, (H - ORB) / 2.0, ORB, ORB)
                    )
                    self._orb.setImage_(NSImage.alloc().initByReferencingFile_(_ORB_ICON))
                    self._orb.setImageScaling_(3)
                    blur.addSubview_(self._orb)
                    text_left = orb_left + ORB + 8

            # "What you said" / status line (also the input field for typed asks)
            field = NSTextField.alloc().initWithFrame_(NSMakeRect(text_left, H - 52, W - text_left - 20, 26))
            field.setBezeled_(False)
            field.setDrawsBackground_(False)
            field.setEditable_(False)      # display-only for voice (kills grey selection);
            field.setSelectable_(False)    # prompt() flips these on for typed asks
            field.setFont_(NSFont.systemFontOfSize_(13.5))
            field.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.42, 0.86, 0.80, 0.85))  # Scout teal
            field.setPlaceholderString_("Ask Scout…")
            try:
                field.setFocusRingType_(1)  # none
            except Exception:
                pass
            try:
                field.setAutoresizingMask_(0)
            except Exception:
                pass
            blur.addSubview_(field)

            # Wrapping answer / status area — the prominent line (Scout's reply)
            answer = NSTextField.alloc().initWithFrame_(NSMakeRect(text_left, 18, W - text_left - 20, H - 74))
            answer.setBezeled_(False)
            answer.setDrawsBackground_(False)
            answer.setEditable_(False)
            answer.setSelectable_(False)
            answer.setFont_(NSFont.systemFontOfSize_(16))
            answer.setTextColor_(NSColor.colorWithCalibratedRed_green_blue_alpha_(0.94, 0.96, 0.96, 0.95))  # soft off-white
            answer.setStringValue_("")
            try:
                answer.setUsesSingleLineMode_(False)
                answer.cell().setWraps_(True)
                answer.cell().setScrollable_(False)
            except Exception:
                pass
            try:
                answer.setAutoresizingMask_(0)
            except Exception:
                pass
            blur.addSubview_(answer)

            outer = self

            class _FieldDelegate(NSObject):
                def control_textView_doCommandBySelector_(self, control, textView, sel):
                    name = str(sel)
                    if name == "insertNewline:":
                        outer._submit()
                        return True
                    if name == "cancelOperation:":
                        outer.hide()
                        return True
                    return False

            self._delegate = _FieldDelegate.alloc().init()
            field.setDelegate_(self._delegate)

            self._panel = panel
            self._field = field
            self._answer = answer
            self._W, self._H = W, H
            self._anim_on = False
            self._anim_thread = None
            self._anim_idx = 0
            self._anim_interval = 0.05
            self._ok = True
        except Exception as exc:  # pragma: no cover - platform dependent
            print(f"[scout] spotlight unavailable: {exc}")

    # -- Halo ring animation ------------------------------------------------
    def _start_anim(self) -> None:
        """Idle motion: slowly rotate the ring bars (redraw on a timer). The bar
        LENGTHS come from set_level (real mic / TTS amplitude)."""
        if not self._ok or self._anim_on:
            return
        target = self._ring or self._orb
        if target is None:
            return
        self._anim_on = True

        def _loop() -> None:
            from PyObjCTools import AppHelper

            while self._anim_on:
                if self._ring is not None:
                    def _do() -> None:
                        self._ring.advance_(0.06)
                        self._ring.setNeedsDisplay_(True)
                    AppHelper.callAfter(_do)
                elif self._orb is not None and self._frames:
                    self._anim_idx = (self._anim_idx + 1) % len(self._frames)
                    AppHelper.callAfter(self._orb.setImage_, self._frames[self._anim_idx])
                time.sleep(self._anim_interval)

        self._anim_thread = threading.Thread(target=_loop, daemon=True)
        self._anim_thread.start()

    def _stop_anim(self) -> None:
        self._anim_on = False

    def set_level(self, level: float) -> None:
        """Feed the ring the live amplitude (0..1) — mic while listening, Scout's
        real TTS envelope while speaking. Drives the bar lengths."""
        if not self._ok or self._ring is None:
            return
        from PyObjCTools import AppHelper

        lv = max(0.0, min(1.0, level))

        def _do() -> None:
            self._ring.setLevel_(lv)
            self._ring.setNeedsDisplay_(True)

        AppHelper.callAfter(_do)

    def _reset_orb(self) -> None:
        if not self._ok or self._ring is None:
            return
        from PyObjCTools import AppHelper

        def _do() -> None:
            self._ring.setLevel_(0.0)
            self._ring.setNeedsDisplay_(True)

        AppHelper.callAfter(_do)

    # -- public API ---------------------------------------------------------
    def prompt(self) -> None:
        """Summon the panel focused for typing (menu / hotkey / wake)."""
        if not self._ok:
            return
        from PyObjCTools import AppHelper

        def _do() -> None:
            self._reposition()
            self._field.setEditable_(True)     # typed-ask mode
            self._field.setSelectable_(True)
            self._field.setStringValue_("")
            self._answer.setStringValue_("")
            self._panel.makeKeyAndOrderFront_(None)
            try:
                from AppKit import NSApp

                NSApp.activateIgnoringOtherApps_(True)
            except Exception:
                pass
            self._panel.makeFirstResponder_(self._field)

        self._start_anim()
        AppHelper.callAfter(_do)

    def _reposition(self) -> None:
        """Move the Halo to the top-centre of whatever screen the cursor is on, so
        it travels with you across displays / Spaces."""
        try:
            from AppKit import NSEvent, NSMakeRect, NSScreen

            m = NSEvent.mouseLocation()
            target = None
            for sc in NSScreen.screens():
                f = sc.frame()
                if f.origin.x <= m.x <= f.origin.x + f.size.width and f.origin.y <= m.y <= f.origin.y + f.size.height:
                    target = f
                    break
            if target is None:
                target = NSScreen.mainScreen().frame()
            x = target.origin.x + (target.size.width - self._W) / 2.0
            y = target.origin.y + target.size.height - self._H - 40.0
            self._panel.setFrame_display_(NSMakeRect(x, y, self._W, self._H), True)
        except Exception:
            pass

    def show(self, text: str) -> None:
        """Pop the orb with a status on the top line (Listening… / Thinking… …)."""
        if not self._ok:
            print("[scout] ⚠ overlay panel unavailable — nothing to show on screen", flush=True)
            return
        from PyObjCTools import AppHelper

        # Motion by state: calm while listening, quick while thinking, lively speaking.
        low = text.lower()
        if "listening" in low:
            self._anim_interval = 0.06
        elif "thinking" in low:
            self._anim_interval = 0.028
        else:
            self._anim_interval = 0.045

        def _do() -> None:
            self._reposition()                   # follow the user to the active screen
            self._answer.setStringValue_(text)   # prominent line = current status
            self._field.setStringValue_("")
            self._panel.orderFrontRegardless()

        print(f"[scout] overlay → {text}", flush=True)
        self._reset_orb()
        self._start_anim()
        AppHelper.callAfter(_do)

    def set_heard(self, text: str) -> None:
        """Show what the user said on the top line (like Siri)."""
        if not self._ok:
            return
        from PyObjCTools import AppHelper

        AppHelper.callAfter(self._field.setStringValue_, text)

    def set_answer(self, text: str) -> None:
        if not self._ok:
            return
        from PyObjCTools import AppHelper

        AppHelper.callAfter(lambda: self._answer.setStringValue_(text))

    # -- Halo state machine -------------------------------------------------
    _STATE_LABELS = {
        "activating": "…",
        "listening": "Listening…",
        "thinking": "Thinking…",
        "speaking": "Speaking…",
        "vision": "Looking at your screen…",
        "executing": "Working…",
        "complete": "Done ✓",
    }

    def set_state(self, state: str, text: str | None = None) -> None:
        """Drive the Halo through its interaction states. ``standby`` hides it;
        every other state pops it with the right label + motion (show() picks the
        animation speed from the label keyword)."""
        if state == "standby":
            self.hide()
            return
        label = text if text is not None else self._STATE_LABELS.get(state, "")
        self.show(label)

    def hide(self) -> None:
        if not self._ok:
            return
        from PyObjCTools import AppHelper

        self._stop_anim()

        def _do() -> None:
            self._field.setEditable_(False)     # back to display-only
            self._field.setSelectable_(False)
            self._field.setStringValue_("")
            self._answer.setStringValue_("")
            self._panel.orderOut_(None)

        AppHelper.callAfter(_do)

    def _submit(self) -> None:
        text = str(self._field.stringValue()).strip()
        if not text:
            return
        self._answer.setStringValue_("Thinking…")
        if self._on_submit:
            self._on_submit(text)


# --------------------------------------------------------------------------- #
# Audio helpers
# --------------------------------------------------------------------------- #
def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0


_stt_model = None


def _stream_recognizer():
    """A Vosk recognizer for LIVE partial transcripts (reuses the wake model, full
    vocabulary). Loaded once; returns None if Vosk/model isn't available."""
    global _stt_model
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel

        if _stt_model is None:
            SetLogLevel(-1)
            _stt_model = Model(SCOUT_VOSK_MODEL)
        return KaldiRecognizer(_stt_model, SAMPLE_RATE)
    except Exception:
        return None


def record_utterance(stop_flag: threading.Event, on_level=None, on_partial=None) -> np.ndarray | None:
    """Record from the mic until a pause (energy VAD). Returns 16k mono float32.

    ``on_level`` (if given) is called each frame with a normalised 0..1 amplitude
    (voice-reactive Halo). ``on_partial`` (if given) is called with a live partial
    transcript as you speak (Vosk) so the words appear in realtime; the accurate
    final still comes from Whisper on the returned audio."""
    import json as _json
    import sounddevice as sd

    rec = _stream_recognizer() if on_partial else None
    last_partial = ""
    chunks: list[np.ndarray] = []
    started = False
    last_loud = time.time()
    start = time.time()
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=FRAME) as stream:
        while not stop_flag.is_set():
            data, _ = stream.read(FRAME)
            mono = data[:, 0].copy()
            level = _rms(mono)
            if on_level is not None:
                on_level(min(1.0, level * 5.0))
            if rec is not None:
                try:
                    pcm = (np.clip(mono, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
                    if rec.AcceptWaveform(pcm):
                        txt = _json.loads(rec.Result()).get("text", "")
                    else:
                        txt = _json.loads(rec.PartialResult()).get("partial", "")
                    if txt and txt != last_partial:
                        last_partial = txt
                        on_partial(txt)
                except Exception:
                    pass
            now = time.time()
            if started:
                chunks.append(mono)
            if level > START_RMS:
                started = True
                last_loud = now
                if not chunks:
                    chunks.append(mono)
            if started and now - last_loud > SILENCE_HANG_S:
                break
            if not started and now - start > NO_SPEECH_S:
                return None
            if now - start > MAX_UTTERANCE_S:
                break
    if not chunks:
        return None
    return np.concatenate(chunks).astype(np.float32)


def _to_wav_bytes(samples: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16.tobytes())
    return buf.getvalue()


def _play_wav_b64(b64: str, stop_flag: threading.Event) -> None:
    data = base64.b64decode(b64)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(data)
        path = fh.name
    try:
        proc = subprocess.Popen(["afplay", path])
        while proc.poll() is None:
            if stop_flag.is_set():
                proc.terminate()
                break
            time.sleep(0.05)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _play_wav_b64_reactive(b64: str, on_level, stop_flag: threading.Event) -> None:
    """Play a base64 WAV via afplay AND drive ``on_level`` from the clip's REAL
    amplitude envelope, stepped in sync with playback — so the Halo reacts to the
    actual spoken audio (not a fake loop). Falls back to plain playback on any error.
    """
    data = base64.b64decode(b64)
    env: list[float] = []
    win = 0.05  # 50 ms windows
    try:
        import io as _io

        with wave.open(_io.BytesIO(data), "rb") as w:
            sr = w.getframerate()
            ch = w.getnchannels()
            raw = w.readframes(w.getnframes())
        s = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if ch > 1:
            s = s[::ch]
        step = max(1, int(sr * win))
        for i in range(0, len(s), step):
            seg = s[i : i + step]
            env.append(min(1.0, float(np.sqrt(np.mean(seg * seg))) * 6.0) if seg.size else 0.0)
    except Exception:
        env = []

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(data)
        path = fh.name
    try:
        proc = subprocess.Popen(["afplay", path])
        start = time.time()
        while proc.poll() is None:
            if stop_flag.is_set():
                proc.terminate()
                break
            if env and on_level:
                idx = int((time.time() - start) / win)
                if idx < len(env):
                    on_level(env[idx])
            time.sleep(0.03)
    finally:
        if on_level:
            try:
                on_level(0.0)  # settle the Halo when the clip ends
            except Exception:
                pass
        try:
            os.remove(path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Permissions (Phase 4) — real status where macOS exposes it + deep links to the
# exact System Settings panes. Never bypasses macOS security; only reads status
# and opens the pane so the user can grant it themselves.
# --------------------------------------------------------------------------- #
_PANES = {
    "Microphone": "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    "Screen Recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "Accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "Automation": "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    "Notifications": "x-apple.systempreferences:com.apple.preference.notifications",
}


def _perm_mic() -> bool | None:
    try:
        from AVFoundation import AVCaptureDevice
        # 3 == AVAuthorizationStatusAuthorized
        return AVCaptureDevice.authorizationStatusForMediaType_("soun") == 3
    except Exception:
        return None


def _perm_screen() -> bool | None:
    try:
        from Quartz import CGPreflightScreenCaptureAccess
        return bool(CGPreflightScreenCaptureAccess())
    except Exception:
        return None


def _perm_accessibility() -> bool | None:
    try:
        from ApplicationServices import AXIsProcessTrusted
        return bool(AXIsProcessTrusted())
    except Exception:
        return None


def _perm_status() -> dict[str, bool | None]:
    """Current status for the permissions we can read (None = unknown)."""
    return {
        "Microphone": _perm_mic(),
        "Screen Recording": _perm_screen(),
        "Accessibility": _perm_accessibility(),
        "Automation": None,      # TCC doesn't expose a readable status
        "Notifications": None,
    }


def _open_pane(name: str) -> None:
    url = _PANES.get(name)
    if url:
        subprocess.run(["open", url])


# --------------------------------------------------------------------------- #
# Scout workspace window — a native window hosting the Scout web app (chat / code
# / web / vision) via WKWebView. This is the "ChatGPT-desktop" surface; the
# menu-bar Halo handles voice. Guarded: if WebKit is unavailable it degrades to
# opening the workspace in the browser.
# --------------------------------------------------------------------------- #
class ScoutWindow:
    def __init__(self, url: str) -> None:
        self._ok = False
        self._url = url
        try:
            from AppKit import (
                NSBackingStoreBuffered,
                NSMakeRect,
                NSScreen,
                NSWindow,
                NSWindowStyleMaskClosable,
                NSWindowStyleMaskMiniaturizable,
                NSWindowStyleMaskResizable,
                NSWindowStyleMaskTitled,
            )
            from WebKit import WKWebView, WKWebViewConfiguration

            style = (
                NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                | NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
            )
            scr = NSScreen.mainScreen().frame()
            W, H = 1240.0, 840.0
            x = (scr.size.width - W) / 2.0
            y = (scr.size.height - H) / 2.0
            win = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
                NSMakeRect(x, y, W, H), style, NSBackingStoreBuffered, False
            )
            win.setTitle_("Scout")
            win.setReleasedWhenClosed_(False)  # closing hides; we reopen the same window
            cfg = WKWebViewConfiguration.alloc().init()
            web = WKWebView.alloc().initWithFrame_configuration_(NSMakeRect(0, 0, W, H), cfg)
            web.setAutoresizingMask_((1 << 1) | (1 << 4))  # width + height sizable

            # WKWebView suppresses JS alert/confirm/prompt unless a UI delegate
            # handles them — without this, window.confirm() (e.g. Delete chat)
            # silently returns false. Bridge them to native NSAlert.
            from AppKit import NSAlert, NSAlertFirstButtonReturn
            from Foundation import NSObject

            from AppKit import NSImage as _NSImage

            _scout_png = str(_ASSETS / "Scout.png")

            def _brand(alert):
                try:
                    if os.path.exists(_scout_png):
                        alert.setIcon_(_NSImage.alloc().initByReferencingFile_(_scout_png))
                except Exception:
                    pass

            class _UIDelegate(NSObject):
                def webView_runJavaScriptAlertPanelWithMessage_initiatedByFrame_completionHandler_(
                    self, wv, message, frame, handler
                ):
                    a = NSAlert.alloc().init()
                    a.setMessageText_(str(message))
                    a.addButtonWithTitle_("OK")
                    _brand(a)
                    a.runModal()
                    handler()

                def webView_runJavaScriptConfirmPanelWithMessage_initiatedByFrame_completionHandler_(
                    self, wv, message, frame, handler
                ):
                    a = NSAlert.alloc().init()
                    a.setMessageText_(str(message))
                    a.addButtonWithTitle_("OK")
                    a.addButtonWithTitle_("Cancel")
                    _brand(a)
                    handler(a.runModal() == NSAlertFirstButtonReturn)

                def webView_runJavaScriptTextInputPanelWithPrompt_defaultText_initiatedByFrame_completionHandler_(
                    self, wv, prompt, default_text, frame, handler
                ):
                    handler(default_text or "")

                # Grant camera + mic to our own local web UI (Arc Forge AR uses
                # getUserMedia). Without this delegate, WKWebView refuses
                # capture, which on some macOS versions crashes the WebContent
                # process — and if the crash isn't caught (see NavDelegate
                # below), it takes Scout.app down with it. WKPermissionDecision:
                # 0=prompt (unavailable here), 1=grant, 2=deny.
                def webView_requestMediaCapturePermissionForOrigin_initiatedByFrame_type_decisionHandler_(
                    self, wv, origin, frame, media_type, handler
                ):
                    handler(1)  # WKPermissionDecisionGrant

            class _NavDelegate(NSObject):
                # Crash guard: if the WebContent process dies (e.g. mediapipe
                # OOM in Arc Forge, or an unhandled JS crash) reload the page
                # in place instead of letting the whole native app die.
                def webViewWebContentProcessDidTerminate_(self, wv):
                    try:
                        wv.reload()
                    except Exception:
                        pass

            self._uidelegate = _UIDelegate.alloc().init()
            self._navdelegate = _NavDelegate.alloc().init()
            web.setUIDelegate_(self._uidelegate)
            web.setNavigationDelegate_(self._navdelegate)
            win.setContentView_(web)
            self._win = win
            self._web = web
            self._ok = True
        except Exception as exc:
            print(f"[scout] workspace window unavailable ({exc}); will use the browser", flush=True)

    def load(self, path: str = "") -> None:
        if not self._ok:
            return
        from Foundation import NSURL, NSURLRequest
        from PyObjCTools import AppHelper

        url = self._url + path
        req = NSURLRequest.requestWithURL_(NSURL.URLWithString_(url))
        AppHelper.callAfter(self._web.loadRequest_, req)

    def show(self, path: str | None = None) -> None:
        if not self._ok:
            subprocess.run(["open", self._url + (path or "")])
            return
        if path is not None:
            self.load(path)
        from PyObjCTools import AppHelper

        def _do() -> None:
            from AppKit import NSApp

            NSApp.activateIgnoringOtherApps_(True)
            self._win.makeKeyAndOrderFront_(None)

        AppHelper.callAfter(_do)

    def reload(self, hard: bool = False) -> None:
        """Reload the current page. Hard reload bypasses the WKWebView cache — use
        after a frontend rebuild so stale CSS/JS chunk URLs get flushed."""
        if not self._ok or self._web is None:
            return
        from PyObjCTools import AppHelper

        def _do() -> None:
            try:
                if hard:
                    self._web.reloadFromOrigin()
                else:
                    self._web.reload()
            except Exception:
                pass

        AppHelper.callAfter(_do)


# --------------------------------------------------------------------------- #
# The menu-bar app
# --------------------------------------------------------------------------- #
_ORB_ICON = str(_ASSETS / "menubar.png")
if not os.path.exists(_ORB_ICON):  # drop a transparent mark at assets/menubar.png to customise
    _ORB_ICON = str(_ASSETS / "orb.png")

_STATUS_ITEMS: list = []  # keep strong refs to NSStatusItems so macOS doesn't drop them


class ScoutApp(rumps.App):
    def __init__(self) -> None:
        # Siri-style orb in the menu bar (falls back to a glyph if the asset is
        # missing — run `python3.11 macos/make_orb_icon.py` to (re)generate it).
        _icon = _ORB_ICON if os.path.exists(_ORB_ICON) else None
        super().__init__("Scout", title=None if _icon else "◆", icon=_icon, template=False, quit_button=None)
        # Force the app identity to "Scout" (not "Python"): the launcher execs the
        # framework python, so we override the main bundle's name at runtime AND set
        # the Dock icon + Regular activation policy. Result: a real "Scout" Dock app.
        try:
            from Foundation import NSBundle

            _b = NSBundle.mainBundle()
            _info = _b.localizedInfoDictionary() or _b.infoDictionary()
            if _info is not None:
                _info["CFBundleName"] = "Scout"
                _info["CFBundleDisplayName"] = "Scout"
        except Exception:
            pass
        # NOTE: do NOT touch NSApplication here — creating/configuring the shared
        # app before rumps.run() prevents rumps from creating its menu-bar item in
        # applicationDidFinishLaunching (that's why the orb disappeared). The Dock
        # icon / Regular policy / app menu are applied in _finish_launch() AFTER the
        # status item exists.
        self.overlay = Spotlight(on_submit=self._ask_async)
        self.stop_flag = threading.Event()
        self.busy = threading.Lock()
        self.wake_on = False
        self._wake_thread: threading.Thread | None = None

        self.status_item = rumps.MenuItem("Checking backend…")
        self.status_item.set_callback(None)
        # Wake word is OPT-IN now (privacy): the mic only turns on when you press
        # Listen. Enable this to also allow hands-free "Hey Scout".
        self.wake_item = rumps.MenuItem("Always listen for “Hey Scout”", callback=self.toggle_wake)
        self.wake_item.state = 0  # off by default — mic on only on demand

        # Permissions submenu (Phase 4) — one item per permission; clicking opens
        # the exact System Settings pane. Titles show live ✓ / ⚠ status.
        self.perm_items = {}
        perm_menu = rumps.MenuItem("Permissions")
        for name in ("Microphone", "Screen Recording", "Accessibility", "Automation", "Notifications"):
            item = rumps.MenuItem(name, callback=lambda _s, n=name: _open_pane(n))
            self.perm_items[name] = item
            perm_menu.add(item)

        # Model submenu — pick which brain Scout's voice uses. Populated from the
        # backend /models once it's reachable (see _poll_status). A tool-capable
        # model lets voice open apps / act; a vision model is best for screen Q&A.
        self.chosen_model = os.environ.get("SCOUT_VOICE_MODEL") or None
        self.model_items = {}
        self.model_menu = rumps.MenuItem("Model")

        self.menu = [
            self.status_item,
            None,
            rumps.MenuItem("🎤 Listen", callback=self.on_talk),  # push-to-talk: mic on for one turn
            rumps.MenuItem("Ask Scout…", callback=self.on_quick_ask),
            rumps.MenuItem("Add reminder…", callback=self.on_add_reminder),
            self.wake_item,
            rumps.MenuItem("Stop", callback=self.on_stop),
            None,
            self.model_menu,
            perm_menu,
            rumps.MenuItem("Open Scout", callback=self.on_open),
            rumps.MenuItem("Open Code", callback=self.on_open_code),
            rumps.MenuItem("Quit Scout", callback=self.on_quit, key="q"),  # ⌘Q
        ]
        self._refresh_permissions()
        self._install_hotkey()
        self._onboard_permissions()  # first launch: request mic/screen/accessibility once
        # Apply Dock icon / Regular policy / app menu AFTER rumps has launched and
        # created the menu-bar item (doing it earlier suppresses the status item).
        threading.Timer(1.2, self._schedule_finish_launch).start()
        # Native Scout workspace window (chat / code / web / vision). Opens once the
        # web app is reachable so it never shows a connection error on first launch.
        # Create the window AFTER launch (in _finish_launch). Creating an NSWindow
        # here in __init__ corrupts the launch sequence and suppresses the menu-bar
        # item — that was the whole bug.
        self.window = None
        # Mic stays OFF until you press Listen (or turn on "Always listen for Hey
        # Scout" from the menu). Respects privacy — no always-on mic by default.
        if os.environ.get("SCOUT_WAKE_ON_LAUNCH", "0") == "1":
            self._start_wake()

    def _open_window_when_ready(self) -> None:
        for _ in range(60):
            try:
                if httpx.get(WEB_URL, timeout=1.5).status_code < 500:
                    break
            except Exception:
                pass
            time.sleep(1)
        # Pre-load the workspace; open it unless launched at login (SCOUT_NO_WINDOW=1).
        if self.window is not None:
            self.window.load()
            if os.environ.get("SCOUT_NO_WINDOW", "0") != "1":
                self.window.show()

    # ---- deferred launch setup (runs AFTER the menu-bar item exists) ------
    def _schedule_finish_launch(self) -> None:
        try:
            from PyObjCTools import AppHelper

            AppHelper.callAfter(self._finish_launch)
        except Exception:
            pass

    def _finish_launch(self) -> None:
        """Give Scout a real Dock icon + name + ⌘Q — done now (post-launch) so it
        doesn't suppress the rumps menu-bar orb."""
        try:
            from AppKit import NSApplication, NSImage

            app = NSApplication.sharedApplication()
            app.setActivationPolicy_(0)  # Regular — Dock icon + window
            icon = str(_ASSETS / "Scout.png")
            if not os.path.exists(icon):
                icon = str(_ASSETS / "app_icon_1024.png")
            if os.path.exists(icon):
                app.setApplicationIconImage_(NSImage.alloc().initByReferencingFile_(icon))
        except Exception as exc:
            print(f"[scout] dock setup skipped: {exc}", flush=True)
        self._install_app_menu()
        # Create the workspace window NOW (post-launch) so it doesn't suppress the
        # rumps menu-bar item created during applicationDidFinishLaunching.
        try:
            self.window = ScoutWindow(WEB_URL)
            threading.Thread(target=self._open_window_when_ready, daemon=True).start()
            print("[scout] workspace window scheduled", flush=True)
        except Exception as exc:
            print(f"[scout] window setup failed: {exc}", flush=True)

    def _install_menubar_item(self) -> None:
        """Create our OWN NSStatusItem so the menu-bar orb is GUARANTEED to appear.
        (rumps' own item gets suppressed because we create a window/panel before its
        launch finishes — so we don't rely on it.)"""
        try:
            from AppKit import NSImage, NSMenu, NSMenuItem, NSStatusBar
            from Foundation import NSObject

            outer = self

            class _MBResponder(NSObject):
                def listen_(self, _s):
                    outer.on_talk(None)

                def openScout_(self, _s):
                    outer.on_open(None)

                def openCode_(self, _s):
                    outer.on_open_code(None)

                def stop_(self, _s):
                    outer.on_stop(None)

                def toggleWake_(self, _s):
                    outer.toggle_wake(outer.wake_item)

                def quitScout_(self, _s):
                    outer.on_quit(None)

            self._mb_responder = _MBResponder.alloc().init()

            item = NSStatusBar.systemStatusBar().statusItemWithLength_(-1.0)  # variable length
            _STATUS_ITEMS.append(item)  # module-global strong ref (belt & suspenders)
            btn = item.button()
            if btn is not None:
                btn.setTitle_("◆ Scout")  # text guarantees visible width
                img = NSImage.alloc().initWithContentsOfFile_(_ORB_ICON) if os.path.exists(_ORB_ICON) else None
                if img is not None:
                    img.setSize_((18.0, 18.0))
                    try:
                        img.setTemplate_(False)
                        from AppKit import NSImageLeft

                        btn.setImagePosition_(NSImageLeft)
                    except Exception:
                        pass
                    btn.setImage_(img)
            else:
                item.setTitle_("◆ Scout")  # fallback for older API

            menu = NSMenu.alloc().init()

            def add(title, sel, key=""):
                mi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, sel, key)
                mi.setTarget_(self._mb_responder)
                menu.addItem_(mi)

            add("🎤 Listen", "listen:")
            add("Open Scout", "openScout:")
            add("Open Code", "openCode:")
            menu.addItem_(NSMenuItem.separatorItem())
            add("Always listen for “Hey Scout”", "toggleWake:")
            add("Stop", "stop:")
            menu.addItem_(NSMenuItem.separatorItem())
            add("Quit Scout", "quitScout:", "q")
            item.setMenu_(menu)
            self._status_item = item  # STRONG ref — without this it gets GC'd and vanishes
            print("[scout] explicit menu-bar item created ✅", flush=True)
        except Exception as exc:
            print(f"[scout] menu-bar item failed: {exc}", flush=True)

    # ---- app menu (gives ⌘Q a handler — a rumps app has none by default) --
    def _install_app_menu(self) -> None:
        try:
            from AppKit import NSApplication, NSMenu, NSMenuItem
            from Foundation import NSObject

            outer = self

            class _AppResponder(NSObject):
                def quitScout_(self, _s):
                    outer.on_quit(None)

                def openScout_(self, _s):
                    outer.on_open(None)

                def reloadScout_(self, _s):
                    outer.on_reload(None)

                def hardReloadScout_(self, _s):
                    outer.on_reload(None, hard=True)

            self._app_responder = _AppResponder.alloc().init()
            main = NSMenu.alloc().init()

            # --- Scout menu (application) -----------------------------------
            app_item = NSMenuItem.alloc().init()
            main.addItem_(app_item)
            submenu = NSMenu.alloc().init()
            oi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Open Scout", "openScout:", "o")
            oi.setTarget_(self._app_responder)
            submenu.addItem_(oi)
            submenu.addItem_(NSMenuItem.separatorItem())
            ri = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Reload", "reloadScout:", "r")
            ri.setTarget_(self._app_responder)
            submenu.addItem_(ri)
            from AppKit import NSShiftKeyMask
            hri = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Reload (Bypass Cache)", "hardReloadScout:", "R")
            hri.setKeyEquivalentModifierMask_(NSShiftKeyMask | (1 << 20))  # ⌘⇧R
            hri.setTarget_(self._app_responder)
            submenu.addItem_(hri)
            submenu.addItem_(NSMenuItem.separatorItem())
            qi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Quit Scout", "quitScout:", "q")
            qi.setTarget_(self._app_responder)
            submenu.addItem_(qi)
            app_item.setSubmenu_(submenu)

            # --- Edit menu (Cut / Copy / Paste / Select All / Undo / Redo) --
            # WKWebView already implements these selectors; we just have to
            # publish an Edit menu so ⌘C / ⌘V / ⌘X / ⌘A / ⌘Z / ⌘⇧Z reach it
            # through the responder chain. Without this, typing works but
            # copy-paste silently no-ops (which was the bug).
            edit_item = NSMenuItem.alloc().init()
            edit_item.setTitle_("Edit")
            main.addItem_(edit_item)
            edit_menu = NSMenu.alloc().initWithTitle_("Edit")

            def _e(title, sel, key, mods=(1 << 20)):
                mi = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, sel, key)
                mi.setKeyEquivalentModifierMask_(mods)
                edit_menu.addItem_(mi)

            CMD = 1 << 20
            SHIFT = NSShiftKeyMask
            _e("Undo", "undo:", "z", CMD)
            _e("Redo", "redo:", "Z", CMD | SHIFT)
            edit_menu.addItem_(NSMenuItem.separatorItem())
            _e("Cut", "cut:", "x", CMD)
            _e("Copy", "copy:", "c", CMD)
            _e("Paste", "paste:", "v", CMD)
            _e("Paste and Match Style", "pasteAsPlainText:", "V", CMD | SHIFT)
            _e("Delete", "delete:", "", 0)
            _e("Select All", "selectAll:", "a", CMD)
            edit_item.setSubmenu_(edit_menu)

            NSApplication.sharedApplication().setMainMenu_(main)
            print("[scout] app menu installed (Scout ⌘Q ⌘R ⌘⇧R + full Edit menu)", flush=True)
        except Exception as exc:
            print(f"[scout] app menu unavailable: {exc}", flush=True)

    # ---- global summon hotkey (⌘⌥-Space) ----------------------------------
    def _install_hotkey(self) -> None:
        """Summon the Spotlight panel from anywhere. Needs Accessibility permission.

        IMPORTANT: on macOS Sequoia and later, calling
        ``NSEvent.addGlobalMonitorForEventsMatchingMask_`` when the process does
        NOT have Accessibility permission triggers the system's permission
        dialog *every launch* — even if we already prompted once. To avoid
        that, we probe the current TCC state FIRST with the non-prompting
        ``AXIsProcessTrusted()`` and only install the monitor when we're
        already trusted. Menu-bar controls still work without hotkeys.
        """
        acc = _perm_accessibility()
        if acc is not True:
            print("[scout] global hotkey skipped — Accessibility not granted (grant it in System Settings, then relaunch)", flush=True)
            return
        try:
            from AppKit import NSEvent, NSEventMaskKeyDown

            OPTION = 1 << 19
            COMMAND = 1 << 20
            SPACE = 49
            PERIOD = 47
            KEY_L = 37  # ⌘⌥L — talk to Scout (Siri from anywhere)

            def handler(event) -> None:
                try:
                    flags = int(event.modifierFlags())
                    if not ((flags & OPTION) and (flags & COMMAND)):
                        return
                    if event.keyCode() == SPACE:
                        self.overlay.prompt()          # ⌘⌥Space — summon (type)
                    elif event.keyCode() == KEY_L:
                        self.on_talk(None)             # ⌘⌥L     — listen (voice turn)
                    elif event.keyCode() == PERIOD:
                        self.on_stop(None)             # ⌘⌥.     — interrupt Scout
                except Exception:
                    pass

            NSEvent.addGlobalMonitorForEventsMatchingMask_handler_(NSEventMaskKeyDown, handler)
            print("[scout] global hotkey installed (⌘⌥Space / ⌘⌥L / ⌘⌥.)", flush=True)
        except Exception as exc:
            print(f"[scout] global hotkey unavailable: {exc}", flush=True)

    # ---- backend status ---------------------------------------------------
    @rumps.timer(5)
    def _poll_status(self, _) -> None:
        try:
            r = httpx.get(f"{BACKEND}/health", timeout=2.0)
            ok = r.status_code == 200
            model = r.json().get("model", "") if ok else ""
        except Exception:
            ok, model = False, ""
        # Keep the orb icon; reflect status in the menu text (and a glyph only if
        # the orb asset wasn't available at launch).
        if not os.path.exists(_ORB_ICON):
            self.title = "◆" if ok else "◇"
        self.status_item.title = f"Scout online · {model}" if ok else "Scout backend offline"
        self._refresh_permissions()
        if ok and not self.model_items:
            try:
                data = httpx.get(f"{BACKEND}/models", timeout=3.0).json()
                models = data.get("models", data) if isinstance(data, dict) else data
                self._populate_models(models or [])
            except Exception:
                pass

    def _populate_models(self, models: list) -> None:
        for m in models:
            mid = m.get("id")
            if not mid:
                continue
            title = m.get("label", mid)
            if m.get("vision"):
                title += "  (vision)"
            elif m.get("tools"):
                title += "  (tools)"
            item = rumps.MenuItem(title, callback=lambda _s, i=mid: self._select_model(i))
            self.model_items[mid] = item
            self.model_menu.add(item)
        if not self.chosen_model:
            for m in models:
                if m.get("default"):
                    self.chosen_model = m.get("id")
                    break
        self._mark_model()

    def _select_model(self, mid: str) -> None:
        self.chosen_model = mid
        print(f"[scout] voice model → {mid}", flush=True)
        self._mark_model()

    def _mark_model(self) -> None:
        for mid, item in self.model_items.items():
            item.state = 1 if mid == self.chosen_model else 0

    def _onboard_permissions(self) -> None:
        """Onboarding — request each permission ONCE per install, and never again.

        The bug we're fixing: previously this method unconditionally called
        `AXIsProcessTrustedWithOptions({"AXTrustedCheckOptionPrompt": True})` on
        every launch, which re-triggered the macOS Accessibility dialog forever
        even though permission was already granted.

        The macOS TCC ground truth (`AXIsProcessTrusted`, `AVCaptureDevice`
        auth status, `CGPreflightScreenCaptureAccess`) is now the authoritative
        source. A permission is only prompted when BOTH are true:
          (a) macOS reports the permission is not yet granted, AND
          (b) we haven't already asked Scout to prompt for it (marker file).

        Once granted at the OS level, no re-prompt ever fires — even on a
        clean marker-less state — because we short-circuit on the live check.
        """
        marker = _STATE_DIR / ".scout_onboarded"
        already_onboarded = marker.exists()

        # --- Microphone ------------------------------------------------------
        mic_state = _perm_mic()  # True | False | None (unknown)
        if mic_state is not True and not already_onboarded:
            try:
                from AVFoundation import AVCaptureDevice
                AVCaptureDevice.requestAccessForMediaType_completionHandler_("soun", lambda granted: None)
            except Exception:
                pass

        # --- Screen Recording ------------------------------------------------
        screen_state = _perm_screen()
        if screen_state is not True and not already_onboarded:
            try:
                from Quartz import CGRequestScreenCaptureAccess
                CGRequestScreenCaptureAccess()
            except Exception:
                pass

        # --- Accessibility (the loud offender) -------------------------------
        # AXIsProcessTrusted() is the live OS truth. Only prompt when the OS
        # says we're NOT trusted AND we've never asked before. Once granted,
        # even if the marker gets wiped, this branch never fires again.
        acc_state = _perm_accessibility()
        if acc_state is False and not already_onboarded:
            try:
                from ApplicationServices import AXIsProcessTrustedWithOptions
                AXIsProcessTrustedWithOptions({"AXTrustedCheckOptionPrompt": True})
            except Exception:
                pass

        # First-launch guidance banner (once).
        if not already_onboarded:
            try:
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text("1")
            except Exception:
                pass
            self._notify(
                "Scout is ready",
                "Grant access when prompted",
                "Allow Microphone / Screen Recording / Accessibility when the "
                "system asks. macOS remembers the grants — Scout never re-prompts.",
            )
            # Only open the Screen Recording pane on the very first launch if
            # still ungranted — never on subsequent runs.
            if screen_state is False:
                _open_pane("Screen Recording")

    def _refresh_permissions(self) -> None:
        """Update the Permissions submenu titles with live ✓ / ⚠ / — status."""
        status = _perm_status()
        for name, item in getattr(self, "perm_items", {}).items():
            st = status.get(name)
            mark = "✓" if st is True else ("⚠" if st is False else "›")
            item.title = f"{name}   {mark}"

    # ---- "open window" trigger (Scout.app touches this file to open the window
    # of the already-running LaunchAgent instance) ---------------------------
    @rumps.timer(1)
    def _poll_open_trigger(self, _) -> None:
        try:
            trig = "/tmp/scout_open_window"
            if os.path.exists(trig):
                os.remove(trig)
                self.on_open(None)
        except Exception:
            pass

    # ---- scheduled reminders → native notifications (spec §31) ------------
    @rumps.timer(30)
    def _poll_reminders(self, _) -> None:
        """Poll the backend for reminders that just came due and notify natively."""
        try:
            r = httpx.get(f"{BACKEND}/reminders/due", timeout=4.0)
            due = r.json().get("due", []) if r.status_code == 200 else []
        except Exception:
            return
        for item in due:
            self._notify("Scout — Reminder", "", item.get("text", ""))
        # Routine results too (recurring proactive tasks, spec §31).
        try:
            rr = httpx.get(f"{BACKEND}/routines/notifications", timeout=4.0)
            for n in (rr.json().get("notifications", []) if rr.status_code == 200 else []):
                self._notify(f"Scout · {n.get('title','Routine')}", "", (n.get("result", "") or "")[:200])
        except Exception:
            pass

    # ---- native Talk turn -------------------------------------------------
    def _backend_up(self) -> bool:
        try:
            return httpx.get(f"{BACKEND}/health", timeout=2.0).status_code == 200
        except Exception:
            return False

    def _voice_turn(self) -> None:
        if not self.busy.acquire(blocking=False):
            return
        self.stop_flag.clear()
        try:
            # Fail kindly if the servers aren't running (this was "Connection refused").
            if not self._backend_up():
                self.overlay.set_state("error", "Scout servers are off — run ./run.sh")
                time.sleep(2.8)
                return

            print("[scout] listening…", flush=True)
            self.overlay.set_state("listening")      # Halo reacts to real mic level
            samples = record_utterance(
                self.stop_flag, on_level=self.overlay.set_level, on_partial=self.overlay.set_heard,
            )  # live partial transcript (Vosk) → Whisper finalises accurately
            if self.stop_flag.is_set() or samples is None:
                print("[scout] no speech captured", flush=True)
                return
            self.overlay.set_state("thinking")
            wav = _to_wav_bytes(samples)
            try:
                self._stream_turn(wav)               # realtime /ws/voice
            except Exception as exc:
                print(f"[scout] streaming turn failed ({str(exc)[:120]}); using batch /voice", flush=True)
                self._batch_turn(wav)
        finally:
            self.overlay.set_state("standby")
            self.busy.release()

    def _stream_turn(self, wav: bytes) -> None:
        """Realtime turn over /ws/voice: transcript → streamed reply tokens →
        per-sentence audio that plays (envelope-reactive) the moment it's ready."""
        import json as _json
        from websockets.sync.client import connect

        url = BACKEND.replace("https://", "wss://").replace("http://", "ws://") + "/ws/voice"
        if self.chosen_model:
            from urllib.parse import quote

            url += f"?model={quote(self.chosen_model)}"
        reply = ""
        with connect(url, max_size=None, open_timeout=10) as ws:
            ws.send(wav)
            while not self.stop_flag.is_set():
                try:
                    msg = ws.recv(timeout=90)
                except TimeoutError:
                    break
                ev = _json.loads(msg)
                t = ev.get("type")
                if t == "transcript":
                    txt = (ev.get("text") or "").strip()
                    if not txt:
                        self.overlay.set_state("thinking", "Didn't catch that")
                        time.sleep(1.4)
                        return
                    print(f"[scout] you said: {txt!r}", flush=True)
                    self.overlay.set_heard(txt)
                elif t == "state":
                    # Phase 2 — backend tells the Halo what it's doing (vision/executing).
                    # Update only the status line so the transcript line is preserved.
                    st = ev.get("state") or "thinking"
                    label = ev.get("label") or Spotlight._STATE_LABELS.get(st, "")
                    print(f"[scout] state → {st}", flush=True)
                    self.overlay.set_answer(label)
                elif t == "text":
                    reply += ev.get("text") or ""
                    self.overlay.set_answer(reply.strip()[:400])
                elif t == "audio":
                    audio = ev.get("audio")
                    if audio and not self.stop_flag.is_set():
                        _play_wav_b64_reactive(audio, self.overlay.set_level, self.stop_flag)
                elif t == "done":
                    print(f"[scout] reply: {((ev.get('reply') or reply)[:80])!r}", flush=True)
                    break
        if reply.strip():
            time.sleep(0.8)  # let the last line linger a moment

    def _batch_turn(self, wav: bytes) -> None:
        """Fallback: single-shot /voice (used if the streaming WS errors)."""
        try:
            resp = httpx.post(f"{BACKEND}/voice", files={"file": ("speech.wav", wav, "audio/wav")}, timeout=120.0)
            data = resp.json()
        except Exception as exc:
            print(f"[scout] voice request failed: {exc}", flush=True)
            self.overlay.set_state("error", "Couldn't reach Scout server")
            time.sleep(2.2)
            return
        transcript = (data.get("transcript") or "").strip()
        reply = (data.get("reply") or "").strip()
        if not transcript:
            self.overlay.set_state("thinking", "Didn't catch that")
            time.sleep(1.6)
            return
        self.overlay.set_heard(transcript)
        if reply:
            self.overlay.set_answer(reply)
        audio = data.get("audio")
        if audio and not self.stop_flag.is_set():
            _play_wav_b64_reactive(audio, self.overlay.set_level, self.stop_flag)
        else:
            time.sleep(2.5)

    def on_talk(self, _) -> None:
        threading.Thread(target=self._voice_turn, daemon=True).start()

    # ---- quick ask (Spotlight panel: type → inline answer) ----------------
    def on_quick_ask(self, _) -> None:
        # If the Spotlight panel is available, summon it; else fall back to a dialog.
        if getattr(self.overlay, "_ok", False):
            self.overlay.prompt()
            return
        win = rumps.Window(title="Ask Scout", message="Type your question.", ok="Ask", cancel="Cancel", dimensions=(360, 90))
        resp = win.run()
        if resp.clicked and resp.text.strip():
            self._ask_async(resp.text.strip())

    def _ask_async(self, question: str) -> None:
        threading.Thread(target=self._quick_ask, args=(question,), daemon=True).start()

    def _quick_ask(self, question: str) -> None:
        try:
            r = httpx.post(f"{BACKEND}/chat", json={"message": question}, timeout=120.0)
            reply = r.json().get("reply", "") if r.status_code == 200 else "Scout couldn't answer that."
        except Exception as exc:
            reply = f"Couldn't reach Scout ({str(exc)[:60]})."
        if getattr(self.overlay, "_ok", False):
            self.overlay.set_answer(reply[:600])
        else:
            self._notify("Scout", question[:60], reply[:230])

    # ---- quick reminder ---------------------------------------------------
    def on_add_reminder(self, _) -> None:
        win = rumps.Window(
            title="Add reminder",
            message="e.g. “Submit the lab report” — or add a time in chat to be notified.",
            ok="Add",
            cancel="Cancel",
            dimensions=(360, 90),
        )
        resp = win.run()
        text = resp.text.strip() if resp.clicked else ""
        if not text:
            return
        try:
            httpx.post(f"{BACKEND}/reminders", json={"text": text}, timeout=6.0)
            self._notify("Scout", "Reminder added", text[:120])
        except Exception:
            pass

    def _notify(self, title: str, subtitle: str, message: str) -> None:
        try:
            rumps.notification(title, subtitle, message, sound=False)
        except Exception:
            subprocess.run(["osascript", "-e", f'display notification {message!r} with title {title!r}'])

    # ---- wake word --------------------------------------------------------
    def _on_wake(self) -> None:
        """What happens when the wake phrase is heard: pop the floating orb and do
        a hands-free voice turn — native, like Siri (no browser jump). Set
        SCOUT_OPEN_ON_WAKE=1 if you also want the web app brought to the front."""
        print("[scout] ✦ wake word detected → opening orb", flush=True)
        if os.environ.get("SCOUT_OPEN_ON_WAKE", "0") == "1":
            try:
                subprocess.run(["open", WEB_URL], timeout=5)
            except Exception:
                pass
        self._voice_turn()

    def _wake_loop(self) -> None:
        """Pick the wake engine (auto, or SCOUT_WAKE_ENGINE override):
          * Vosk        — fully-local "Hey Scout" (default when the model is present)
          * Porcupine   — "Hey Scout" via Picovoice (if a key + .ppn are configured)
          * openWakeWord — "Hey Jarvis" fallback
        Each returns False if it can't start, so we fall through to the next."""
        eng = SCOUT_WAKE_ENGINE
        use_porcupine = eng == "porcupine" or (not eng and PICOVOICE_KEY and SCOUT_PPN and os.path.exists(SCOUT_PPN))
        use_vosk = eng == "vosk" or (not eng and os.path.isdir(SCOUT_VOSK_MODEL))

        if use_porcupine and self._wake_loop_porcupine():
            return
        if use_vosk and self._wake_loop_vosk():
            return
        self._wake_loop_openwakeword()

    def _wake_loop_vosk(self) -> bool:
        """Fully-local 'Hey Scout' via Vosk keyword spotting. Returns False if it
        couldn't start (so the caller can fall back)."""
        try:
            import json as _json
            from vosk import KaldiRecognizer, Model, SetLogLevel

            SetLogLevel(-1)  # keep the console quiet
            model = Model(SCOUT_VOSK_MODEL)
            # Restrict the vocabulary to the wake phrase (+[unk]) so ordinary speech
            # maps to [unk] and won't false-trigger.
            rec = KaldiRecognizer(model, 16000, '["hey scout", "scout", "hey", "[unk]"]')
        except Exception as exc:
            print(f"[scout] Vosk unavailable ({str(exc)[:160]}); trying next engine.")
            return False
        print("[scout] wake engine: Vosk · say 'Hey Scout'")

        import sounddevice as sd

        # Common mishears of "scout" from the small model — accept them all.
        hits = ("scout", "scott", "skout", "scoot", "scowt")

        def heard(txt: str) -> bool:
            return any(h in txt for h in hits)

        with sd.InputStream(samplerate=16000, channels=1, dtype="int16", blocksize=4000) as stream:
            while self.wake_on:
                data, _ = stream.read(4000)
                buf = data[:, 0].tobytes()
                fired = False
                if rec.AcceptWaveform(buf):
                    txt = _json.loads(rec.Result()).get("text", "")
                    fired = heard(txt)
                else:
                    txt = _json.loads(rec.PartialResult()).get("partial", "")
                    fired = heard(txt)
                if fired:
                    print(f"[scout] vosk matched: {txt!r}", flush=True)
                    rec.Reset()
                    if self.busy.acquire(blocking=False):
                        self.busy.release()
                        threading.Thread(target=self._on_wake, daemon=True).start()
                    time.sleep(1.2)  # debounce
        return True

    def _wake_loop_porcupine(self) -> bool:
        """Real 'Hey Scout' via Picovoice. Returns False if it couldn't start (so
        the caller can fall back), True after it runs to completion."""
        try:
            import pvporcupine
            import sounddevice as sd

            porcupine = pvporcupine.create(access_key=PICOVOICE_KEY, keyword_paths=[SCOUT_PPN])
        except Exception as exc:
            print(f"[scout] Porcupine unavailable ({str(exc)[:160]}); using openWakeWord.")
            return False
        print(f"[scout] wake engine: Porcupine · phrase from {os.path.basename(SCOUT_PPN)}")
        try:
            with sd.InputStream(
                samplerate=porcupine.sample_rate, channels=1, dtype="int16",
                blocksize=porcupine.frame_length,
            ) as stream:
                while self.wake_on:
                    data, _ = stream.read(porcupine.frame_length)
                    if porcupine.process(data[:, 0]) >= 0:
                        if self.busy.acquire(blocking=False):
                            self.busy.release()
                            threading.Thread(target=self._on_wake, daemon=True).start()
                        time.sleep(1.0)  # debounce
        finally:
            porcupine.delete()
        return True

    def _wake_loop_openwakeword(self) -> None:
        try:
            import openwakeword
            from openwakeword.model import Model
            import sounddevice as sd

            try:
                openwakeword.utils.download_models()
            except Exception:
                pass
            model = Model(wakeword_models=[WAKE_MODEL], inference_framework="onnx")
        except Exception as exc:
            print(f"[scout] wake model unavailable: {exc}")
            self.wake_on = False
            self.wake_item.state = 0
            return
        print(f"[scout] wake engine: openWakeWord · '{WAKE_MODEL}' (say 'Hey Jarvis')")
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME) as stream:
            while self.wake_on:
                data, _ = stream.read(FRAME)
                scores = model.predict(data[:, 0])
                if any(v > 0.5 for v in scores.values()):
                    if self.busy.acquire(blocking=False):
                        self.busy.release()
                        threading.Thread(target=self._on_wake, daemon=True).start()
                    time.sleep(1.0)  # debounce

    def _start_wake(self) -> None:
        """Begin the wake listener if it isn't already running."""
        if self._wake_thread and self._wake_thread.is_alive():
            return
        self.wake_on = True
        self.wake_item.state = 1
        self._wake_thread = threading.Thread(target=self._wake_loop, daemon=True)
        self._wake_thread.start()

    def toggle_wake(self, sender) -> None:
        self.wake_on = not self.wake_on
        sender.state = 1 if self.wake_on else 0
        if self.wake_on:
            self._start_wake()

    # ---- controls ---------------------------------------------------------
    def on_stop(self, _) -> None:
        self.stop_flag.set()
        self.overlay.hide()

    def on_open(self, _) -> None:
        if self.window is None:
            self.window = ScoutWindow(WEB_URL)
        self.window.show("")

    def on_open_code(self, _) -> None:
        if self.window is None:
            self.window = ScoutWindow(WEB_URL)
        self.window.show("/code")

    def on_reload(self, _, hard: bool = False) -> None:
        """⌘R (soft) / ⌘⇧R (hard, bypass cache) — reload the Scout window.
        Hard reload is essential after a frontend rebuild changes chunk URLs."""
        if self.window is None:
            self.window = ScoutWindow(WEB_URL)
            self.window.show(None)
            return
        self.window.reload(hard=hard)

    def on_quit(self, _) -> None:
        """⌘Q / Quit Scout — stop the mic, the backend + web, then quit fully."""
        self.wake_on = False
        self.stop_flag.set()
        if os.environ.get("SCOUT_QUIT_STOPS_SERVERS", "1") == "1":
            for port in ("8000", "3000"):
                try:
                    out = subprocess.run(["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True, timeout=5)
                    for pid in out.stdout.split():
                        subprocess.run(["kill", "-9", pid], timeout=3)
                except Exception:
                    pass
        rumps.quit_application()


if __name__ == "__main__":
    ScoutApp().run()
