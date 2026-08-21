"""Phone control (Phase 7) — drive the OnePlus Nord 4 over ADB.

Route B for smart-home: instead of a dedicated Wi-Fi IR blaster, JARVIS uses the
phone's own IR blaster by *automating the OnePlus IR Remote app's UI* over ADB —
it wakes the phone, opens the app, taps the device's card, then taps the on-screen
button. There is no public API to fire arbitrary IR from the phone, so this drives
the vendor app by coordinate taps.

Honest caveats (by design, not bugs):
* The phone must be **connected** (USB or wireless ADB), **powered on**, and
  **unlocked** — taps land on the lock screen otherwise.
* Button coordinates live in ``config/ir_remote.json`` and are specific to this
  phone's screen + the app's current layout. If the app updates its layout, the
  coordinates must be re-mapped.
* Most remotes expose a single **Power toggle** (not discrete on/off), so "turn
  on" and "turn off" send the same toggle — JARVIS can't know the current state.

All adb calls are blocking subprocesses; callers should use ``asyncio.to_thread``
or the async wrappers here.
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

from backend.config import ROOT_DIR

_ADB = "adb"
_IR_MAP_PATH: Path = ROOT_DIR / "config" / "ir_remote.json"


def _run(args: list[str], timeout: float = 15.0, serial: str | None = None) -> subprocess.CompletedProcess:
    """Run an adb command, capturing output. Never raises on nonzero exit.

    When ``serial`` is given, the command is scoped to that device (``adb -s``),
    so it works even with several transports attached at once (e.g. USB + Wi-Fi).
    """
    cmd = [_ADB]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def adb_available() -> bool:
    """True if the adb binary is on PATH and runnable."""
    try:
        return _run(["version"], timeout=5).returncode == 0
    except Exception:
        return False


def _adb_address() -> str | None:
    try:
        return _load_map().get("adb_address")
    except Exception:
        return None


def _scan_device() -> dict[str, object]:
    """Scan the current adb transports for the first usable device."""
    try:
        out = _run(["devices", "-l"], timeout=5).stdout
    except Exception:
        return {"connected": False, "state": "no-adb", "model": None}
    for line in out.splitlines()[1:]:
        line = line.strip()
        if not line or "\t" not in line and " " not in line:
            continue
        parts = line.split()
        serial, state = parts[0], (parts[1] if len(parts) > 1 else "")
        if state == "device":
            model = next((p.split(":", 1)[1] for p in parts if p.startswith("model:")), None)
            return {"connected": True, "state": "device", "model": model, "serial": serial}
        if state:  # unauthorized / offline
            return {"connected": False, "state": state, "model": None, "serial": serial}
    return {"connected": False, "state": "none", "model": None}


def device_info() -> dict[str, object]:
    """Return {connected, state, model, serial} for the first usable device.

    If nothing is attached but a wireless ``adb_address`` is configured, try to
    reconnect to it first — so control survives a Mac reboot / Wi-Fi blip without
    replugging USB (the phone must have wireless debugging on and be reachable).
    """
    info = _scan_device()
    if not info.get("connected"):
        addr = _adb_address()
        if addr:
            _run(["connect", addr], timeout=8)
            info = _scan_device()
    return info


def _load_map() -> dict:
    with _IR_MAP_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def match_device(spoken: str) -> str | None:
    """Map a spoken device word ('the ac', 'fan') to a configured device key."""
    spoken = (spoken or "").strip().lower().rstrip("s")  # tolerate 'fans'
    if not spoken:
        return None
    devices = _load_map().get("devices", {})
    for key, dev in devices.items():
        aliases = [key] + list(dev.get("aliases", []))
        for alias in aliases:
            a = alias.lower().rstrip("s")
            if spoken == a or a in spoken or spoken in a:
                return key
    return None


def _is_locked(serial: str | None = None) -> bool:
    """Best-effort: True if the lock screen is currently showing."""
    out = _run(["shell", "dumpsys", "window"], timeout=6, serial=serial).stdout
    for line in out.splitlines():
        if "mDreamingLockscreen" in line:
            return "mDreamingLockscreen=true" in line
    return False


def press(device_key: str, button: str) -> dict[str, object]:
    """Navigate the IR app to ``device_key`` and tap ``button``. Blocking.

    Deterministic navigation: force-stop the app so it always relaunches to its
    home grid, tap the device's card, then tap the button — no dependence on
    whatever screen was showing before.
    """
    info = device_info()
    if not info.get("connected"):
        return {"ok": False, "reason": f"phone not connected ({info.get('state')})"}
    serial = info.get("serial")

    cfg = _load_map()
    dev = cfg.get("devices", {}).get(device_key)
    if not dev:
        return {"ok": False, "reason": f"unknown device '{device_key}'"}
    buttons = dev.get("buttons", {})
    card = dev.get("card")
    spec = buttons.get(button)
    if spec is None or not card:
        return {"ok": False, "reason": f"no mapping for {device_key}.{button}"}

    # A button spec is either a bare [x, y] (direct tap on the device panel) or
    # {"via": "<other button>", "tap": [x, y]} for controls behind an extra step
    # (e.g. the fan's "More controls" sheet). Build the full tap sequence.
    target = spec if isinstance(spec, list) else spec.get("tap")
    via_key = None if isinstance(spec, list) else spec.get("via")
    if not target:
        return {"ok": False, "reason": f"bad mapping for {device_key}.{button}"}
    taps: list[list[int]] = [card]
    if via_key:
        via_spec = buttons.get(via_key)
        via_coords = via_spec if isinstance(via_spec, list) else (via_spec or {}).get("tap")
        if not via_coords:
            return {"ok": False, "reason": f"bad 'via' mapping {device_key}.{via_key}"}
        taps.append(via_coords)
    taps.append(target)

    package = cfg["package"]
    delay = cfg.get("nav_delay_ms", 2500) / 1000.0

    # Wake the screen; bail early with a clear reason if it's locked.
    _run(["shell", "input", "keyevent", "KEYCODE_WAKEUP"], timeout=6, serial=serial)
    time.sleep(0.4)
    if _is_locked(serial):
        return {"ok": False, "reason": "phone is locked — unlock it, sir"}

    # Force a clean start at the app's home grid, then walk the tap sequence.
    _run(["shell", "am", "force-stop", package], timeout=8, serial=serial)
    _run(["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"], timeout=8, serial=serial)
    for x, y in taps:
        time.sleep(delay)
        tap = _run(["shell", "input", "tap", str(x), str(y)], timeout=6, serial=serial)
        if tap.returncode != 0:
            return {"ok": False, "reason": (tap.stderr or "tap failed").strip()}
    return {"ok": True, "reason": None, "toggle": bool(dev.get("power_is_toggle"))}


def power(device_key: str, on: bool) -> dict[str, object]:
    """Press the device's power button (a toggle on these remotes)."""
    return press(device_key, "power")


# --- Full screen mirror + control (Phase 7 finale) --------------------------
# JARVIS streams the phone's screen as JPEG frames and forwards taps/swipes/keys
# back over the same ADB link, so the phone can be seen and driven from the HUD.

_SIZE_RE = re.compile(r"Override size:\s*(\d+)x(\d+)")
_SIZE_RE_PHYS = re.compile(r"Physical size:\s*(\d+)x(\d+)")

# Friendly nav names → Android keycodes.
_KEYCODES = {
    "home": "KEYCODE_HOME",
    "back": "KEYCODE_BACK",
    "recents": "KEYCODE_APP_SWITCH",
    "power": "KEYCODE_POWER",
    "wake": "KEYCODE_WAKEUP",
    "volume_up": "KEYCODE_VOLUME_UP",
    "volume_down": "KEYCODE_VOLUME_DOWN",
    "enter": "KEYCODE_ENTER",
}


def screen_size(serial: str | None = None) -> tuple[int, int] | None:
    """The phone's effective (override) display size in the coordinate space
    that ``input tap`` uses. Falls back to physical size."""
    out = _run(["shell", "wm", "size"], timeout=6, serial=serial).stdout
    m = _SIZE_RE.search(out) or _SIZE_RE_PHYS.search(out)
    return (int(m.group(1)), int(m.group(2))) if m else None


def screen_jpeg(max_edge: int = 1000) -> tuple[bytes, int, int] | None:
    """Grab one frame of the phone screen as JPEG plus its (width, height) in
    tap-coordinate space. Returns None if the phone isn't reachable."""
    info = device_info()
    if not info.get("connected"):
        return None
    serial = info.get("serial")
    args = [_ADB]
    if serial:
        args += ["-s", str(serial)]
    args += ["exec-out", "screencap", "-p"]
    # Binary output — bypass _run (which decodes as text).
    proc = subprocess.run(args, capture_output=True, timeout=15, check=False)
    if proc.returncode != 0 or not proc.stdout:
        return None
    png = proc.stdout
    w, h = screen_size(serial) or (0, 0)
    # Downscale + re-encode to JPEG with the built-in `sips` (no Python image dep).
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "s.png"
            dst = Path(tmp) / "s.jpg"
            src.write_bytes(png)
            subprocess.run(
                ["sips", "-s", "format", "jpeg", "-Z", str(max_edge), str(src), "--out", str(dst)],
                capture_output=True,
                timeout=15,
                check=False,
            )
            data = dst.read_bytes() if dst.exists() else png
    except Exception:
        data = png
    return data, w, h


def tap_xy(x: int, y: int) -> bool:
    """Tap the phone at absolute coordinates (tap-coordinate space)."""
    info = device_info()
    if not info.get("connected"):
        return False
    serial = info.get("serial")
    return _run(["shell", "input", "tap", str(int(x)), str(int(y))], timeout=6, serial=serial).returncode == 0


def swipe(x1: int, y1: int, x2: int, y2: int, ms: int = 200) -> bool:
    """Swipe/drag from (x1,y1) to (x2,y2) over ``ms`` milliseconds."""
    info = device_info()
    if not info.get("connected"):
        return False
    serial = info.get("serial")
    return (
        _run(
            ["shell", "input", "swipe", str(int(x1)), str(int(y1)), str(int(x2)), str(int(y2)), str(int(ms))],
            timeout=8,
            serial=serial,
        ).returncode
        == 0
    )


def keyevent(name: str) -> bool:
    """Press a hardware/navigation key by friendly name (home/back/recents…)."""
    code = _KEYCODES.get((name or "").lower())
    if not code:
        return False
    info = device_info()
    if not info.get("connected"):
        return False
    serial = info.get("serial")
    return _run(["shell", "input", "keyevent", code], timeout=6, serial=serial).returncode == 0


def type_text(text: str) -> bool:
    """Type a string into the focused field (spaces → %s, per adb input text)."""
    if not text:
        return False
    info = device_info()
    if not info.get("connected"):
        return False
    serial = info.get("serial")
    escaped = text.replace(" ", "%s")
    return _run(["shell", "input", "text", escaped], timeout=8, serial=serial).returncode == 0


# --- async wrappers ---------------------------------------------------------
async def a_device_info() -> dict[str, object]:
    return await asyncio.to_thread(device_info)


async def a_press(device_key: str, button: str) -> dict[str, object]:
    return await asyncio.to_thread(press, device_key, button)


async def a_power(device_key: str, on: bool) -> dict[str, object]:
    return await asyncio.to_thread(power, device_key, on)
