"""Code tools (spec §18–20) — Code mode's hands, all inside the workspace sandbox.

Read-only tools (list/read/search, git status/diff) are SAFE. Anything that mutates
the project (write/create/edit/rename/delete) is CONFIRMATION_REQUIRED, so it never
runs silently from model text — it either awaits the user's confirmation or is
auto-approved by the active Code mode (AUTO/BYPASS), while delete always confirms
(spec §19/§42). Every path goes through ``workspace.resolve`` — nothing escapes the
connected project. There is NO arbitrary-shell tool here.
"""

from __future__ import annotations

import os
import shutil
import subprocess

from backend.tools.base import PermissionLevel, Tool, ToolResult
from backend.workspace import service as ws
from backend.workspace.service import WorkspaceError

_MAX_READ = 60_000        # chars returned from a single read
_MAX_SEARCH_HITS = 40
_BINARY_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".so", ".dylib",
                ".bin", ".onnx", ".glb", ".task", ".ico", ".woff", ".woff2", ".ttf", ".db"}


def _guard(fn):
    """Wrap a handler so a WorkspaceError becomes an honest ToolResult, not a crash."""
    def inner(**kwargs) -> ToolResult:
        try:
            return fn(**kwargs)
        except WorkspaceError as exc:
            return ToolResult(ok=False, summary=str(exc), error="workspace")
        except Exception as exc:
            return ToolResult(ok=False, summary=f"{fn.__name__} failed: {exc}", error=str(exc))
    return inner


@_guard
def _list_directory(path: str = ".") -> ToolResult:
    target = ws.resolve(path)
    if not target.is_dir():
        return ToolResult(ok=False, summary=f"Not a directory: {path}")
    items = []
    for e in sorted(os.scandir(target), key=lambda e: (not e.is_dir(), e.name.lower())):
        if e.name in ws._SKIP_DIRS:
            continue
        items.append(f"{'📁' if e.is_dir() else '📄'} {e.name}")
    listing = "\n".join(items) if items else "(empty)"
    return ToolResult(ok=True, summary=f"{ws.rel(target)}/\n{listing}", data={"path": ws.rel(target)})


@_guard
def _read_file(path: str) -> ToolResult:
    target = ws.resolve(path)
    if not target.is_file():
        return ToolResult(ok=False, summary=f"No such file: {path}")
    if target.suffix.lower() in _BINARY_EXTS:
        return ToolResult(ok=False, summary=f"{path} is a binary file — I can't read it as text.")
    text = target.read_text(encoding="utf-8", errors="replace")
    truncated = len(text) > _MAX_READ
    body = text[:_MAX_READ] + ("\n… (truncated)" if truncated else "")
    return ToolResult(ok=True, summary=f"{ws.rel(target)}:\n\n{body}", data={"path": ws.rel(target), "truncated": truncated})


@_guard
def _search_code(query: str, glob: str = "") -> ToolResult:
    root = ws.resolve(".")
    hits: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ws._SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if glob and not fn.endswith(glob.lstrip("*")):
                continue
            fp = os.path.join(dirpath, fn)
            if os.path.splitext(fn)[1].lower() in _BINARY_EXTS:
                continue
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                    for i, line in enumerate(fh, 1):
                        if query in line:
                            hits.append(f"{ws.rel(fp)}:{i}: {line.strip()[:160]}")
                            if len(hits) >= _MAX_SEARCH_HITS:
                                break
            except OSError:
                continue
        if len(hits) >= _MAX_SEARCH_HITS:
            break
    if not hits:
        return ToolResult(ok=True, summary=f"No matches for '{query}'.", data={"hits": []})
    return ToolResult(ok=True, summary=f"{len(hits)} match(es) for '{query}':\n" + "\n".join(hits), data={"hits": hits})


@_guard
def _write_file(path: str, content: str) -> ToolResult:
    target = ws.resolve(path)
    existed = target.is_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    verb = "Updated" if existed else "Created"
    return ToolResult(ok=True, summary=f"{verb} {ws.rel(target)} ({len(content)} bytes).", data={"path": ws.rel(target)})


@_guard
def _edit_file(path: str, old_string: str, new_string: str) -> ToolResult:
    target = ws.resolve(path)
    if not target.is_file():
        return ToolResult(ok=False, summary=f"No such file: {path}")
    text = target.read_text(encoding="utf-8")
    n = text.count(old_string)
    if n == 0:
        return ToolResult(ok=False, summary=f"The text to replace wasn't found in {ws.rel(target)}.")
    if n > 1:
        return ToolResult(ok=False, summary=f"That text appears {n} times in {ws.rel(target)} — make it unique.")
    target.write_text(text.replace(old_string, new_string, 1), encoding="utf-8")
    return ToolResult(ok=True, summary=f"Edited {ws.rel(target)}.", data={"path": ws.rel(target)})


@_guard
def _rename_path(src: str, dst: str) -> ToolResult:
    s, d = ws.resolve(src), ws.resolve(dst)
    if not s.exists():
        return ToolResult(ok=False, summary=f"No such path: {src}")
    d.parent.mkdir(parents=True, exist_ok=True)
    os.rename(s, d)
    return ToolResult(ok=True, summary=f"Renamed {ws.rel(s)} → {ws.rel(d)}.", data={"path": ws.rel(d)})


@_guard
def _delete_path(path: str) -> ToolResult:
    target = ws.resolve(path)
    if not target.exists():
        return ToolResult(ok=False, summary=f"No such path: {path}")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return ToolResult(ok=True, summary=f"Deleted {ws.rel(target)}.", data={"path": ws.rel(target)})


def _git(*args: str, timeout: float = 8.0) -> tuple[bool, str]:
    root = ws.get_root()
    if not root:
        return False, "No workspace connected."
    try:
        out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout)
        return out.returncode == 0, (out.stdout or out.stderr).strip()
    except Exception as exc:
        return False, str(exc)


@_guard
def _git_status() -> ToolResult:
    ok, msg = _git("status", "--short", "--branch")
    if not ok:
        return ToolResult(ok=False, summary=f"git status unavailable: {msg[:120]}")
    return ToolResult(ok=True, summary=f"git status:\n{msg or '(clean)'}", data={"status": msg})


@_guard
def _git_diff(path: str = "") -> ToolResult:
    args = ["diff"] + ([ws.rel(ws.resolve(path))] if path else [])
    ok, msg = _git(*args, timeout=10.0)
    if not ok:
        return ToolResult(ok=False, summary=f"git diff unavailable: {msg[:120]}")
    diff = msg[:_MAX_READ] + ("\n… (truncated)" if len(msg) > _MAX_READ else "")
    return ToolResult(ok=True, summary=f"git diff:\n{diff or '(no changes)'}", data={"diff": msg})


# Commands that could wreck the machine — refused outright, even under BYPASS.
_DANGEROUS = (
    "rm -rf /", "rm -rf ~", "rm -rf .", ":(){", "mkfs", "dd if=", " of=/dev/",
    "> /dev/sd", "shutdown", "reboot", "sudo ", "chmod -r 000", "chown -r",
    "curl ", "wget ", "git push",  # push/network deferred; commit is fine
)


@_guard
def _run_command(command: str) -> ToolResult:
    root = ws.get_root()
    if not root:
        return ToolResult(ok=False, summary="No workspace connected, sir.")
    low = (command or "").lower()
    if any(bad in low for bad in _DANGEROUS):
        return ToolResult(ok=False, summary=f"That command is blocked for safety: {command!r}", error="blocked")
    try:
        out = subprocess.run(command, shell=True, cwd=root, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return ToolResult(ok=False, summary=f"'{command}' timed out after 90s.")
    body = (out.stdout or "") + (("\n" + out.stderr) if out.stderr else "")
    body = body.strip()[:_MAX_READ]
    tag = "ran" if out.returncode == 0 else f"exited {out.returncode}"
    return ToolResult(ok=out.returncode == 0, summary=f"$ {command}  ({tag})\n{body or '(no output)'}", data={"code": out.returncode, "output": body})


@_guard
def _git_commit(message: str) -> ToolResult:
    ok_add, _ = _git("add", "-A")
    ok, msg = _git("commit", "-m", message or "Update from Scout Code")
    if not ok:
        # "nothing to commit" is a benign, honest outcome — not a failure to hide.
        return ToolResult(ok=False, summary=f"Nothing committed: {msg[:160]}", data={"output": msg})
    return ToolResult(ok=True, summary=f"Committed: {msg.splitlines()[0] if msg else message}", data={"output": msg})


def register(registry) -> None:
    S, C = PermissionLevel.SAFE, PermissionLevel.CONFIRMATION_REQUIRED
    p = lambda **props: {"type": "object", "properties": props, "required": [k for k in props]}
    path_opt = {"type": "object", "properties": {"path": {"type": "string", "description": "Workspace-relative path."}}, "required": []}
    specs = [
        ("list_directory", "List a directory in the connected workspace.", path_opt, _list_directory, S),
        ("read_file", "Read a text file from the workspace.", p(path={"type": "string", "description": "Workspace-relative file path."}), _read_file, S),
        ("search_code", "Search the workspace files for a string.", {"type": "object", "properties": {"query": {"type": "string"}, "glob": {"type": "string", "description": "Optional extension filter e.g. '.ts'."}}, "required": ["query"]}, _search_code, S),
        ("write_file", "Create or overwrite a file with the given content.", p(path={"type": "string"}, content={"type": "string"}), _write_file, C),
        ("edit_file", "Replace an exact unique snippet in a file with new text.", p(path={"type": "string"}, old_string={"type": "string"}, new_string={"type": "string"}), _edit_file, C),
        ("rename_path", "Rename or move a file/folder within the workspace.", p(src={"type": "string"}, dst={"type": "string"}), _rename_path, C),
        ("delete_path", "Delete a file or folder in the workspace.", p(path={"type": "string"}), _delete_path, C),
        ("git_status", "Show git status of the workspace.", {"type": "object", "properties": {}, "required": []}, _git_status, S),
        ("git_diff", "Show the git diff of the workspace (optionally a path).", path_opt, _git_diff, S),
        ("run_command", "Run a shell command in the workspace (e.g. npm install, python script.py, git status). Runs in the project root.", p(command={"type": "string"}), _run_command, C),
        ("git_commit", "Stage all changes and commit them with a message.", p(message={"type": "string"}), _git_commit, C),
    ]
    for name, desc, params, handler, perm in specs:
        registry.register(Tool(name=name, description=desc, parameters=params, handler=handler, permission=perm, category="code"))
