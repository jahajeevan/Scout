"""Screen vision (spec §24) — "what am I looking at?"

`see_screen` captures the Mac screen, downscales it, and sends it to a vision model,
returning a text description the (tool-capable) agent can reason about and answer
with. This bridges the model split — tool models can't see, vision models can't
call tools — by doing the vision call *inside* the tool.

Needs macOS Screen Recording permission; fails honestly if it isn't granted. The
capture is user-initiated (the user asked about their screen), read-only, and
routed to the same vision model used for uploaded images.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import re
import subprocess

from backend.tools.base import PermissionLevel, Tool, ToolResult

_SHOT_PATH = "/tmp/scout_screen.png"
_VISION_MODEL = "llama-3.2-11b-vision"

# Natural names → real macOS application names (for switch-and-capture). Anything
# not listed is passed straight to `activate`, which fails honestly if unknown.
_APP_ALIASES = {
    "terminal": "Terminal",
    "iterm": "iTerm",
    "iterm2": "iTerm",
    "vscode": "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "code": "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "safari": "Safari",
    "arc": "Arc",
    "firefox": "Firefox",
    "finder": "Finder",
    "notes": "Notes",
    "mail": "Mail",
    "messages": "Messages",
    "slack": "Slack",
    "spotify": "Spotify",
    "preview": "Preview",
    "xcode": "Xcode",
    "pycharm": "PyCharm",
}


def canonical_app(name: str) -> str:
    """Map a spoken/typed app name to its macOS application name."""
    key = (name or "").strip().lower()
    return _APP_ALIASES.get(key, name.strip())


# Alias keys safe to auto-detect from free text (excludes short/common words like
# "code", "mail", "notes", "arc", "preview" that appear in ordinary sentences).
_AUTODETECT_KEYS = (
    "visual studio code", "vs code", "vscode", "google chrome", "iterm2", "iterm",
    "terminal", "chrome", "safari", "firefox", "finder", "xcode", "pycharm",
    "spotify", "slack",
)


def detect_app(text: str) -> str | None:
    """Find an app name referenced in free text → its macOS name, or None.

    Prefers longer aliases ("visual studio code" before "vscode"), matches on word
    boundaries, and falls back to an "…in my <name> app/window/editor/tab" pattern.
    """
    low = (text or "").lower()
    for key in _AUTODETECT_KEYS:
        if re.search(rf"\b{re.escape(key)}\b", low):
            return _APP_ALIASES[key]
    m = re.search(r"(?:in|into|inside|on|open) (?:my |the )?([a-z][a-z ]{1,20}?) (?:app|window|editor|tab)", low)
    if m:
        name = m.group(1).strip()
        if name and name not in ("current", "same", "front", "this", "that", "active", "open"):
            return _APP_ALIASES.get(name, name.title())
    return None


def _osascript(script: str, timeout: float = 6.0) -> tuple[bool, str]:
    try:
        out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        return out.returncode == 0, (out.stdout or out.stderr).strip()
    except Exception as exc:
        return False, str(exc)


def _frontmost_app() -> str | None:
    ok, name = _osascript(
        'tell application "System Events" to get name of first process whose frontmost is true'
    )
    return name if ok and name else None


def _activate(app_name: str) -> tuple[bool, str]:
    safe = app_name.replace('"', '\\"')
    return _osascript(f'tell application "{safe}" to activate')


def _capture_data_uri() -> tuple[str | None, str | None]:
    """Capture + downscale the screen → (data_uri, error)."""
    try:
        out = subprocess.run(["screencapture", "-x", _SHOT_PATH], capture_output=True, text=True, timeout=12)
    except Exception as exc:
        return None, f"Couldn't capture the screen: {exc}"
    if out.returncode != 0 or not os.path.exists(_SHOT_PATH):
        return None, (
            "Couldn't capture the screen — grant Scout Screen Recording permission "
            "in System Settings → Privacy & Security → Screen Recording."
        )
    try:
        from PIL import Image

        img = Image.open(_SHOT_PATH).convert("RGB")
        w, h = img.size
        if w > 1500:
            img = img.resize((1500, max(1, int(h * 1500 / w))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        raw, mime = buf.getvalue(), "image/jpeg"
    except Exception:
        with open(_SHOT_PATH, "rb") as fh:
            raw = fh.read()
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}", None


async def _analyze(data_uri: str, question: str) -> tuple[str | None, str | None]:
    """Send a captured frame to the vision model → (answer, error)."""
    from backend.providers import registry

    provider, spec = registry.provider_for(_VISION_MODEL)
    q = (question or "").strip() or "Describe what's on the screen clearly and concisely."
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": q},
                {"type": "image_url", "image_url": {"url": data_uri}},
            ],
        }
    ]
    try:
        result = await provider.complete(messages, system=None, model=spec.remote_id)
    except Exception as exc:
        return None, f"Screen analysis failed: {str(exc)[:140]}"
    return (result.text or "(couldn't read the screen)"), None


async def _see_screen(question: str = "") -> ToolResult:
    data_uri, err = _capture_data_uri()
    if err:
        return ToolResult(ok=False, summary=err, error="capture")
    answer, verr = await _analyze(data_uri, question)
    if verr:
        return ToolResult(ok=False, summary=verr, error="vision")
    return ToolResult(ok=True, summary=answer, data={"question": question})


async def _see_app(app: str, question: str = "") -> ToolResult:
    """Bring an app to the front, capture it, describe it, then restore focus.

    This is the literal "go to the app, take a look, come back" flow: Scout
    activates the target app, screenshots the real screen, analyses it with the
    vision model, and switches focus back to wherever the user was — so the
    answer is grounded in what's actually there, on any chat model.
    """
    target = canonical_app(app)
    previous = _frontmost_app()  # so we can hand focus back
    ok, msg = _activate(target)
    if not ok:
        return ToolResult(
            ok=False,
            summary=f"I couldn't switch to {target} to look at it — {msg or 'the app may not be open'}.",
            error="activate",
        )
    await asyncio.sleep(0.6)  # let the window come forward and repaint

    data_uri, err = _capture_data_uri()
    if err:
        if previous:
            _activate(previous)
        return ToolResult(ok=False, summary=err, error="capture")

    q = (question or "").strip() or f"Describe clearly and concisely what's shown in {target} right now."
    answer, verr = await _analyze(data_uri, q)

    # Hand focus back to whatever the user was in (e.g. the Scout browser).
    if previous and previous != target:
        _activate(previous)

    if verr:
        return ToolResult(ok=False, summary=verr, error="vision")
    return ToolResult(ok=True, summary=answer, data={"app": target, "question": q})


def register(registry) -> None:
    registry.register(
        Tool(
            name="see_screen",
            description=(
                "Look at what's currently on the user's Mac screen and answer a question about it "
                "(e.g. 'what am I looking at?', 'why is this error showing?', 'what should I click?'). "
                "Captures the screen and analyses it with a vision model."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "What to look for / answer about the screen."}
                },
                "required": [],
            },
            handler=_see_screen,
            permission=PermissionLevel.SAFE,
            category="vision",
        )
    )
    registry.register(
        Tool(
            name="see_app",
            description=(
                "Look at what's inside a SPECIFIC application and answer a question about it "
                "(e.g. 'what's in my terminal?', 'look into VS Code', 'what's open in Chrome?'). "
                "Brings the app to the front, captures it, analyses it with a vision model, and "
                "restores the previous window. Use this when the user names an app; use see_screen "
                "for the whole current screen."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "app": {"type": "string", "description": "Application name, e.g. 'Terminal', 'Visual Studio Code', 'Chrome'."},
                    "question": {"type": "string", "description": "What to look for / answer about the app."},
                },
                "required": ["app"],
            },
            handler=_see_app,
            permission=PermissionLevel.SAFE,
            category="vision",
        )
    )
