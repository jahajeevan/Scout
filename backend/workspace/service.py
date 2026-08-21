"""Workspace service — the connected project root + a hard path sandbox.

The active workspace root is persisted to ``config/scout_workspace.json``. Every
path a code tool touches goes through ``resolve``, which realpath-resolves it and
refuses anything that escapes the root (``../`` traversal, symlinks pointing out,
absolute paths outside). This is the boundary that makes Code mode safe: the model
can act freely *inside* the project and not at all outside it (spec §42/§48).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from backend.config import ROOT_DIR

_STATE_PATH = ROOT_DIR / "config" / "scout_workspace.json"

# Directories never worth showing/searching in a project tree.
_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build",
    ".turbo", ".cache", ".mypy_cache", ".pytest_cache", ".idea", ".vscode", "target",
    ".venv-gesture", ".DS_Store",
}
_MAX_TREE_ENTRIES = 2000


class WorkspaceError(Exception):
    """A path escaped the workspace, or no workspace is connected."""


@dataclass
class Node:
    name: str
    path: str          # workspace-relative
    is_dir: bool
    children: list["Node"] | None = None

    def as_dict(self) -> dict:
        d = {"name": self.name, "path": self.path, "is_dir": self.is_dir}
        if self.children is not None:
            d["children"] = [c.as_dict() for c in self.children]
        return d


def _load() -> str | None:
    try:
        root = json.loads(_STATE_PATH.read_text(encoding="utf-8")).get("root")
        return root if root and Path(root).is_dir() else None
    except Exception:
        return None


_root: str | None = _load()


def get_root() -> str | None:
    return _root


def is_connected() -> bool:
    return _root is not None


def set_root(path: str) -> dict:
    """Connect a workspace. The path must be an existing directory."""
    global _root
    expanded = os.path.abspath(os.path.expanduser((path or "").strip()))
    if not os.path.isdir(expanded):
        return {"ok": False, "reason": f"Not a directory: {path}"}
    _root = expanded
    try:
        _STATE_PATH.write_text(json.dumps({"root": expanded}, indent=2), encoding="utf-8")
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "root": expanded, "name": os.path.basename(expanded)}


def disconnect() -> dict:
    global _root
    _root = None
    try:
        if _STATE_PATH.exists():
            _STATE_PATH.write_text(json.dumps({"root": None}), encoding="utf-8")
    except Exception:
        pass
    return {"ok": True}


def resolve(rel_path: str) -> Path:
    """Resolve a workspace-relative path to an absolute one INSIDE the root.

    Raises WorkspaceError if no workspace is connected or the path escapes it.
    """
    if _root is None:
        raise WorkspaceError("No workspace is connected, sir. Connect a project folder first.")
    rel = (rel_path or ".").strip().lstrip("/")
    root = os.path.realpath(_root)
    target = os.path.realpath(os.path.join(root, rel))
    if target != root and not target.startswith(root + os.sep):
        raise WorkspaceError(f"'{rel_path}' is outside the workspace — refused.")
    return Path(target)


def rel(path: Path | str) -> str:
    """A path relative to the workspace root (for display/citations)."""
    if _root is None:
        return str(path)
    try:
        return os.path.relpath(str(path), _root)
    except Exception:
        return str(path)


def tree(max_entries: int = _MAX_TREE_ENTRIES) -> Node | None:
    """Build the project file tree, skipping heavy/generated directories."""
    if _root is None:
        return None
    count = 0

    def build(dir_path: str, rel_path: str) -> Node:
        nonlocal count
        node = Node(name=os.path.basename(dir_path) or dir_path, path=rel_path, is_dir=True, children=[])
        try:
            entries = sorted(
                os.scandir(dir_path),
                key=lambda e: (not e.is_dir(), e.name.lower()),
            )
        except OSError:
            return node
        for e in entries:
            if e.name in _SKIP_DIRS or e.name.startswith("."):
                if e.name not in {".env", ".gitignore", ".env.example"}:
                    continue
            if count >= max_entries:
                break
            child_rel = f"{rel_path}/{e.name}".lstrip("/") if rel_path else e.name
            count += 1
            if e.is_dir():
                node.children.append(build(e.path, child_rel))
            else:
                node.children.append(Node(name=e.name, path=child_rel, is_dir=False))
        return node

    root_node = build(os.path.realpath(_root), "")
    root_node.name = os.path.basename(os.path.realpath(_root))
    return root_node


def info() -> dict:
    """Summary for the UI header and /workspace."""
    if _root is None:
        return {"connected": False, "root": None, "name": None}
    return {"connected": True, "root": _root, "name": os.path.basename(_root)}
