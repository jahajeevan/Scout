"""MAC tools — application & system control via `open`/`osascript` (spec §5 MAC/APP).

No unrestricted shell: every handler calls a *fixed* command with validated,
escaped arguments. Reversible actions are SAFE; disruptive ones (lock, sleep)
are CONFIRMATION_REQUIRED so JARVIS always says what it's about to do first.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from backend.tools.base import PermissionLevel, Tool, ToolResult


def _osascript(script: str, timeout: float = 8.0) -> tuple[bool, str]:
    try:
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=timeout,
        )
        return out.returncode == 0, (out.stdout or out.stderr).strip()
    except Exception as exc:
        return False, str(exc)


def _open_app(name: str) -> ToolResult:
    try:
        out = subprocess.run(["open", "-a", name], capture_output=True, text=True, timeout=10)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't open {name}: {exc}", error=str(exc))
    if out.returncode == 0:
        return ToolResult(ok=True, summary=f"Opened {name}.", data={"app": name})
    return ToolResult(ok=False, summary=f"I couldn't find an app called {name}, sir.", error=out.stderr.strip())


def _close_app(name: str) -> ToolResult:
    safe = name.replace('"', '\\"')
    ok, msg = _osascript(f'tell application "{safe}" to quit')
    return ToolResult(ok=ok, summary=f"Closed {name}." if ok else f"Couldn't close {name}: {msg}", data={"app": name})


def _switch_app(name: str) -> ToolResult:
    safe = name.replace('"', '\\"')
    ok, msg = _osascript(f'tell application "{safe}" to activate')
    return ToolResult(ok=ok, summary=f"Switched to {name}." if ok else f"Couldn't switch to {name}: {msg}")


def _list_running_apps() -> ToolResult:
    ok, msg = _osascript(
        'tell application "System Events" to get name of every process whose background only is false'
    )
    apps = [a.strip() for a in msg.split(",")] if ok and msg else []
    return ToolResult(
        ok=ok,
        summary=f"{len(apps)} apps in the foreground: {', '.join(apps[:12])}." if ok else f"Couldn't list apps: {msg}",
        data={"apps": apps},
    )


def _take_screenshot(path: str = "/tmp/jarvis_screenshot.png") -> ToolResult:
    # -x = no capture sound. This is the raw capture; VisionProvider (Phase F)
    # will consume the file for analysis.
    try:
        out = subprocess.run(["screencapture", "-x", path], capture_output=True, text=True, timeout=10)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Screenshot failed: {exc}", error=str(exc))
    ok = out.returncode == 0
    return ToolResult(
        ok=ok,
        summary=f"Captured the screen to {path}." if ok else "Screenshot failed — check Screen Recording permission.",
        data={"path": path},
    )


def _control_volume(level: int) -> ToolResult:
    level = max(0, min(100, int(level)))
    ok, msg = _osascript(f"set volume output volume {level}")
    return ToolResult(ok=ok, summary=f"Volume set to {level}%." if ok else f"Couldn't set volume: {msg}", data={"level": level})


def _control_brightness(level: int) -> ToolResult:
    # macOS has no first-party brightness CLI; the optional `brightness` tool
    # (brew install brightness) is used when present, else we degrade honestly.
    frac = max(0, min(100, int(level))) / 100.0
    try:
        out = subprocess.run(["brightness", f"{frac:.2f}"], capture_output=True, text=True, timeout=8)
        if out.returncode == 0:
            return ToolResult(ok=True, summary=f"Brightness set to {int(frac*100)}%.", data={"level": int(frac*100)})
    except FileNotFoundError:
        return ToolResult(
            ok=False,
            summary="I can't control brightness yet, sir — install the `brightness` CLI (brew install brightness).",
            error="brightness_cli_missing",
        )
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't set brightness: {exc}", error=str(exc))
    return ToolResult(ok=False, summary="Couldn't set brightness.", error="unknown")


def _lock_screen() -> ToolResult:
    ok, msg = _osascript(
        'tell application "System Events" to keystroke "q" using {control down, command down}'
    )
    return ToolResult(ok=ok, summary="Locking the screen, sir." if ok else f"Couldn't lock: {msg}")


def _sleep_mac() -> ToolResult:
    try:
        out = subprocess.run(["pmset", "sleepnow"], capture_output=True, text=True, timeout=8)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't sleep: {exc}", error=str(exc))
    ok = out.returncode == 0
    return ToolResult(ok=ok, summary="Going to sleep, sir." if ok else f"Couldn't sleep: {out.stderr.strip()}")


def _start_screen_sharing() -> ToolResult:
    # macOS built-in Screen Sharing (VNC on port 5900). Enable it once in
    # System Settings → General → Sharing → Screen Sharing; this tool only
    # confirms it's running and returns the address a phone client should use.
    try:
        launchctl = subprocess.run(
            ["launchctl", "list", "com.apple.screensharing"],
            capture_output=True, text=True, timeout=5,
        )
        enabled = launchctl.returncode == 0
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't check Screen Sharing: {exc}", error=str(exc))

    if not enabled:
        return ToolResult(
            ok=False,
            summary="Screen Sharing is off. Turn it on in System Settings → General → Sharing → Screen Sharing, then ask again.",
            error="screen_sharing_disabled",
        )

    host = ""
    try:
        # Tailscale IP is the right one to hand a phone that's off-LAN.
        ts = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=3)
        if ts.returncode == 0:
            host = ts.stdout.strip().splitlines()[0]
    except FileNotFoundError:
        pass
    if not host:
        try:
            ip = subprocess.run(["ipconfig", "getifaddr", "en0"], capture_output=True, text=True, timeout=3)
            if ip.returncode == 0:
                host = ip.stdout.strip()
        except Exception:
            pass

    vnc_url = f"vnc://{host}:5900" if host else "vnc://<mac-ip>:5900"
    return ToolResult(
        ok=True,
        summary=f"Screen Sharing is live at {vnc_url}. Open it in a VNC client on your phone (Jump Desktop, VNC Viewer).",
        data={"vnc_url": vnc_url, "host": host, "port": 5900},
    )


def _wake_display() -> ToolResult:
    # Wakes the display without unlocking; useful before a screen-sharing session.
    try:
        subprocess.run(["caffeinate", "-u", "-t", "2"], capture_output=True, text=True, timeout=5)
        return ToolResult(ok=True, summary="Display woken.")
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't wake display: {exc}", error=str(exc))


def _notify(title: str, message: str = "", subtitle: str = "") -> ToolResult:
    # Native macOS banner. Requires Scout (or the Python binary running Scout) to
    # be granted Notifications permission in System Settings the first time.
    safe = lambda s: (s or "").replace('"', '\\"').replace("\\", "\\\\")
    parts = [f'display notification "{safe(message)}"', f'with title "{safe(title)}"']
    if subtitle:
        parts.append(f'subtitle "{safe(subtitle)}"')
    script = " ".join(parts)
    ok, msg = _osascript(script)
    return ToolResult(ok=ok, summary=(f"Notification sent: {title}" if ok else f"Couldn't notify: {msg}"))


def _archive_files(paths: list, archive_root: str = "") -> ToolResult:
    # Move a list of files/folders into archive_root/YYYY-MM/ — preserves basename.
    # Non-destructive relative to delete: user can always drag them back.
    from datetime import datetime
    if not paths:
        return ToolResult(ok=True, summary="No paths to archive.", data={"moved": []})
    root = Path(archive_root).expanduser() if archive_root else Path.home() / "Downloads" / "_scout_archive"
    stamp = datetime.now().strftime("%Y-%m")
    dest_dir = root / stamp
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't create archive dir: {exc}", error=str(exc))
    moved: list[str] = []
    failed: list[str] = []
    for p in paths:
        try:
            src = Path(p).expanduser()
            if not src.exists():
                failed.append(f"{p} (missing)")
                continue
            target = dest_dir / src.name
            n = 1
            while target.exists():
                target = dest_dir / f"{src.stem}_{n}{src.suffix}"
                n += 1
            shutil.move(str(src), str(target))
            moved.append(str(target))
        except Exception as exc:
            failed.append(f"{p} ({exc})")
    ok = len(moved) > 0
    parts = [f"Archived {len(moved)} file(s) → {dest_dir}"]
    if failed:
        parts.append(f"Skipped {len(failed)}")
    return ToolResult(ok=ok, summary=". ".join(parts), data={"moved": moved, "failed": failed, "dest": str(dest_dir)})


def _empty_trash() -> ToolResult:
    ok, msg = _osascript('tell application "Finder" to empty trash', timeout=30.0)
    return ToolResult(ok=ok, summary=("Trash emptied." if ok else f"Couldn't empty Trash: {msg}"))


def _open_in_vscode(path: str = "", content: str = "", create_dirs: bool = True) -> ToolResult:
    """Fulfills 'open VS Code and create a file with this code' end-to-end.

    - If `path` is relative, resolves inside the current workspace root; if no
      workspace is connected, resolves under ~/Documents/scout.
    - If `content` is provided, writes it (creating parent dirs when asked),
      then opens VS Code focused on the file.
    - If `content` is empty, just opens the existing file/folder in VS Code.
    """
    from pathlib import Path as _P
    import os as _os
    if not path:
        return ToolResult(ok=False, summary="path is required", error="missing_path")

    target = _P(path).expanduser()
    if not target.is_absolute():
        try:
            from backend.workspace import service as _ws
            root = _ws.get_root()
        except Exception:
            root = None
        base = _P(root) if root else (_P.home() / "Documents" / "scout")
        target = base / target

    try:
        if content:
            if create_dirs:
                target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            action_note = f"Wrote {len(content)} bytes to {target}"
        else:
            action_note = f"Opening {target}"
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Couldn't write {target}: {exc}", error=str(exc))

    # Prefer the `code` CLI when available (jumps to file); fall back to `open -a`.
    code_bin = None
    for cand in ("/usr/local/bin/code", "/opt/homebrew/bin/code", _os.path.expanduser("~/.local/bin/code")):
        if _os.path.exists(cand):
            code_bin = cand
            break
    try:
        if code_bin:
            subprocess.run([code_bin, str(target)], capture_output=True, text=True, timeout=8)
        else:
            subprocess.run(["open", "-a", "Visual Studio Code", str(target)], capture_output=True, text=True, timeout=8)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"{action_note}; couldn't open VS Code: {exc}", error=str(exc))

    # Best-effort task log — silently no-ops if backend.main not yet imported.
    try:
        from backend.main import _log_workspace_task
        _log_workspace_task("open_in_vscode", f"{target.name}", ok=True)
    except Exception:
        pass

    return ToolResult(
        ok=True,
        summary=f"{action_note}. Opened in VS Code.",
        data={"path": str(target), "wrote": bool(content)},
    )


def register(registry) -> None:
    S, C = PermissionLevel.SAFE, PermissionLevel.CONFIRMATION_REQUIRED
    name_arg = {
        "type": "object",
        "properties": {"name": {"type": "string", "description": "Application name, e.g. 'Safari'."}},
        "required": ["name"],
    }
    no_args = {"type": "object", "properties": {}, "required": []}
    level_arg = {
        "type": "object",
        "properties": {"level": {"type": "integer", "description": "0–100."}},
        "required": ["level"],
    }
    path_arg = {
        "type": "object",
        "properties": {"path": {"type": "string", "description": "Where to save the PNG."}},
        "required": [],
    }
    specs = [
        ("open_app", "Open a macOS application by name.", name_arg, _open_app, S, "apps"),
        ("close_app", "Quit a running application by name.", name_arg, _close_app, S, "apps"),
        ("switch_app", "Bring an application to the foreground.", name_arg, _switch_app, S, "apps"),
        ("list_running_apps", "List foreground applications.", no_args, _list_running_apps, S, "apps"),
        ("take_screenshot", "Save a screenshot of the screen to a FILE. Does NOT analyse it — to answer a question about what's on the screen, use see_screen instead.", path_arg, _take_screenshot, S, "mac"),
        ("control_volume", "Set system output volume (0–100).", level_arg, _control_volume, S, "mac"),
        ("control_brightness", "Set display brightness (0–100).", level_arg, _control_brightness, S, "mac"),
        ("lock_screen", "Lock the screen.", no_args, _lock_screen, C, "mac"),
        ("sleep_mac", "Put the Mac to sleep.", no_args, _sleep_mac, C, "mac"),
        ("start_screen_sharing", "Return the VNC URL for controlling this Mac's screen from a phone (uses macOS built-in Screen Sharing over Tailscale).", no_args, _start_screen_sharing, S, "mac"),
        ("wake_display", "Wake the Mac's display (does not unlock).", no_args, _wake_display, S, "mac"),
        ("notify",
         "Show a native macOS notification banner (title + short message).",
         {"type": "object", "properties": {"title": {"type": "string"}, "message": {"type": "string"}, "subtitle": {"type": "string"}}, "required": ["title"]},
         _notify, S, "mac"),
        ("archive_files",
         "Move a list of file/folder paths into ~/Downloads/_scout_archive/YYYY-MM (or a chosen archive_root). Non-destructive — files can be moved back.",
         {"type": "object", "properties": {"paths": {"type": "array", "description": "List of absolute paths to archive."}, "archive_root": {"type": "string", "description": "Optional custom archive folder."}}, "required": ["paths"]},
         _archive_files, C, "mac"),
        ("empty_trash", "Empty the macOS Trash. Destructive.", no_args, _empty_trash, C, "mac"),
        ("open_in_vscode",
         "Open a file in VS Code, optionally writing new content to it first. Perfect for 'open VS Code and create X.py with this code'. If path is relative it resolves in the connected workspace (or ~/Documents/scout).",
         {"type": "object",
          "properties": {
              "path":    {"type": "string", "description": "File path (absolute or workspace-relative)."},
              "content": {"type": "string", "description": "Optional content to write before opening."},
              "create_dirs": {"type": "boolean", "description": "Create parent dirs if missing (default true)."},
          },
          "required": ["path"]},
         _open_in_vscode, C, "mac"),
    ]
    for nm, desc, params, handler, perm, cat in specs:
        registry.register(Tool(name=nm, description=desc, parameters=params, handler=handler, permission=perm, category=cat))
