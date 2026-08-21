"""Deterministic fast-path for simple Mac actions (spec: fast app launching).

The point: "Scout, open VS Code" must NOT wait for an LLM reasoning cycle before
launching. We match a small set of obvious, deterministic commands here and run
them directly through native macOS mechanisms (`open -a`, `osascript`), then
*verify* the result — perceived-instant + actually-fast + verified.

Anything complex ("open VS Code AND create a bubble sort…") returns None so it
falls through to the full computer agent (orchestrator). This module is the
source of truth for executing these simple actions; the UI only reflects status.
"""

from __future__ import annotations

import os
import re
import subprocess
import time

from backend.tools.vision_tools import canonical_app

# If any of these appear, it's a multi-step task → let the agent handle it.
_COMPLEX = (
    " and ", " then ", ";", " after ", "create", "write", "build", "make ",
    " fix", "run ", "install", "delete", "generate", "program", "script",
    "search", "email", "message", "play ", "remind",
)

# "open Downloads" etc. → open a Finder folder, not an app.
_FOLDERS = {
    "downloads": "~/Downloads",
    "documents": "~/Documents",
    "desktop": "~/Desktop",
    "applications": "/Applications",
    "home": "~",
    "trash": "~/.Trash",
}

_CMD = re.compile(
    r"^(?:hey\s+scout[,\s]+)?(?:scout[,\s]+)?(?:please\s+|can you\s+|could you\s+)?"
    r"(open|launch|start|close|quit|switch to|go to|focus(?: on)?)\s+(.+)$",
    re.I,
)
_SHOT = re.compile(r"\bscreenshot\b|\bscreen shot\b", re.I)
_SHOT_VERB = re.compile(r"\b(take|grab|capture|snap|get)\b", re.I)


def match(text: str) -> dict | None:
    """Return an action dict for a simple deterministic command, else None."""
    low = " " + text.lower().strip().rstrip(" .!?") + " "
    if any(k in low for k in _COMPLEX):
        return None  # complex → agent

    if _SHOT.search(low) and _SHOT_VERB.search(low):
        return {"kind": "screenshot"}

    m = _CMD.match(text.strip())
    if not m:
        return None
    verb = m.group(1).lower()
    rest = m.group(2).strip()
    rest = re.sub(r"\b(the|app|application|window|for me|please)\b", "", rest, flags=re.I).strip(" .!?,")
    if not rest or len(rest.split()) > 5:
        return None

    if verb in ("open", "launch", "start"):
        if rest.lower() in _FOLDERS:
            return {"kind": "open_folder", "path": os.path.expanduser(_FOLDERS[rest.lower()]), "name": rest.title()}
        return {"kind": "open_app", "app": canonical_app(rest)}
    if verb in ("close", "quit"):
        return {"kind": "close_app", "app": canonical_app(rest)}
    return {"kind": "switch_app", "app": canonical_app(rest)}


def label_running(action: dict) -> str:
    """The immediate 'I'm on it' line spoken/shown before execution."""
    k = action["kind"]
    if k == "screenshot":
        return "Taking a screenshot…"
    if k == "open_folder":
        return f"Opening {action['name']}…"
    if k == "open_app":
        return f"Opening {action['app']}…"
    if k == "close_app":
        return f"Closing {action['app']}…"
    if k == "switch_app":
        return f"Switching to {action['app']}…"
    return "Working…"


def _run(cmd: list[str], timeout: float = 8.0) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or p.stderr).strip()
    except Exception as exc:
        return 1, str(exc)


def _is_running(app: str) -> bool:
    """Best-effort check that the app is running (does NOT launch it)."""
    safe = app.replace('"', '\\"')
    rc, out = _run(["osascript", "-e", f'application "{safe}" is running'], timeout=4)
    return rc == 0 and out.strip().lower() == "true"


def execute(action: dict) -> tuple[bool, str]:
    """Run the action natively and VERIFY it. Returns (ok, spoken_result).

    Blocking (subprocess + a short verification poll) — call via asyncio.to_thread
    so the event loop / UI stays responsive.
    """
    kind = action["kind"]

    if kind == "screenshot":
        path = "/tmp/scout_screenshot.png"
        rc, _ = _run(["screencapture", "-x", path])
        return (rc == 0, "Screenshot saved." if rc == 0 else
                "I couldn't take the screenshot — check Screen Recording permission.")

    if kind == "open_folder":
        rc, _ = _run(["open", action["path"]])
        name = action["name"]
        return (rc == 0, f"{name} is open." if rc == 0 else f"I couldn't open {name}.")

    app = action["app"]

    if kind == "open_app":
        rc, err = _run(["open", "-a", app])          # native, fast; rc!=0 → app not found
        if rc != 0:
            return (False, f"I couldn't find an app called {app}.")
        for _ in range(12):                          # verify up to ~3s
            if _is_running(app):
                return (True, f"{app} is open.")
            time.sleep(0.25)
        return (True, f"{app} is launching.")        # initiated, not yet confirmed

    if kind == "close_app":
        safe = app.replace('"', '\\"')
        rc, err = _run(["osascript", "-e", f'tell application "{safe}" to quit'])
        return (rc == 0, f"Closed {app}." if rc == 0 else f"I couldn't close {app}: {err[:80]}")

    if kind == "switch_app":
        safe = app.replace('"', '\\"')
        rc, err = _run(["osascript", "-e", f'tell application "{safe}" to activate'])
        return (rc == 0, f"Switched to {app}." if rc == 0 else f"I couldn't switch to {app}.")

    return (False, "I didn't understand that action.")
