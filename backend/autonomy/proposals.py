"""Proposal inbox — daemon outputs that need the user's yes before executing.

A PROPOSE-level daemon (e.g. the email drafter) doesn't send anything; it
composes and drops a proposal here. The user opens Scout's Autonomy panel,
reviews it, hits approve → the encoded ``actions`` are re-run by the engine
to actually do the thing. Reject just discards the row.

Actions are a list of ``{"tool": <tool_name>, "args": {...}}`` — the tool
registry executes them, so nothing runs that isn't already a real Scout tool.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from backend.config import ROOT_DIR

_DB_PATH = ROOT_DIR / "config" / "scout_autonomy.db"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS proposals ("
        "id TEXT PRIMARY KEY, daemon TEXT NOT NULL, title TEXT NOT NULL, "
        "body TEXT, actions TEXT NOT NULL, status TEXT DEFAULT 'pending', "
        "created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, "
        "outcome TEXT)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS daemon_runs ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, daemon TEXT NOT NULL, "
        "ok INTEGER, summary TEXT, ran_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS daemon_state ("
        "name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, "
        "last_run TEXT, next_run TEXT)"
    )
    conn.commit()
    return conn


_DB = _conn()


def create(daemon: str, title: str, body: str, actions: list[dict]) -> dict:
    pid = uuid.uuid4().hex[:12]
    _DB.execute(
        "INSERT INTO proposals (id, daemon, title, body, actions) VALUES (?, ?, ?, ?, ?)",
        (pid, daemon, title, body or "", json.dumps(actions)),
    )
    _DB.commit()
    return {"id": pid, "daemon": daemon, "title": title}


def _row(r) -> dict:
    return {
        "id": r[0], "daemon": r[1], "title": r[2], "body": r[3],
        "actions": json.loads(r[4] or "[]"), "status": r[5],
        "created_at": r[6], "resolved_at": r[7], "outcome": r[8],
    }


def list_pending() -> list[dict]:
    rows = _DB.execute(
        "SELECT id, daemon, title, body, actions, status, created_at, resolved_at, outcome "
        "FROM proposals WHERE status = 'pending' ORDER BY created_at DESC"
    ).fetchall()
    return [_row(r) for r in rows]


def list_all(limit: int = 50) -> list[dict]:
    rows = _DB.execute(
        "SELECT id, daemon, title, body, actions, status, created_at, resolved_at, outcome "
        "FROM proposals ORDER BY created_at DESC LIMIT ?",
        (int(limit),),
    ).fetchall()
    return [_row(r) for r in rows]


def get(pid: str) -> dict | None:
    r = _DB.execute(
        "SELECT id, daemon, title, body, actions, status, created_at, resolved_at, outcome "
        "FROM proposals WHERE id = ?",
        (pid,),
    ).fetchone()
    return _row(r) if r else None


def mark(pid: str, status: str, outcome: str = "") -> bool:
    cur = _DB.execute(
        "UPDATE proposals SET status = ?, resolved_at = ?, outcome = ? WHERE id = ?",
        (status, _now_iso(), outcome[:500], pid),
    )
    _DB.commit()
    return cur.rowcount > 0


def log_run(daemon: str, ok: bool, summary: str) -> None:
    _DB.execute(
        "INSERT INTO daemon_runs (daemon, ok, summary) VALUES (?, ?, ?)",
        (daemon, 1 if ok else 0, (summary or "")[:1000]),
    )
    _DB.commit()


def recent_runs(daemon: str | None = None, limit: int = 25) -> list[dict]:
    if daemon:
        rows = _DB.execute(
            "SELECT daemon, ok, summary, ran_at FROM daemon_runs WHERE daemon = ? "
            "ORDER BY id DESC LIMIT ?",
            (daemon, int(limit)),
        ).fetchall()
    else:
        rows = _DB.execute(
            "SELECT daemon, ok, summary, ran_at FROM daemon_runs "
            "ORDER BY id DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    return [{"daemon": r[0], "ok": bool(r[1]), "summary": r[2], "ran_at": r[3]} for r in rows]


def get_state(name: str) -> dict:
    r = _DB.execute(
        "SELECT enabled, last_run, next_run FROM daemon_state WHERE name = ?", (name,)
    ).fetchone()
    if not r:
        _DB.execute("INSERT OR IGNORE INTO daemon_state (name) VALUES (?)", (name,))
        _DB.commit()
        return {"enabled": True, "last_run": None, "next_run": None}
    return {"enabled": bool(r[0]), "last_run": r[1], "next_run": r[2]}


def set_enabled(name: str, enabled: bool) -> None:
    _DB.execute(
        "INSERT INTO daemon_state (name, enabled) VALUES (?, ?) "
        "ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled",
        (name, 1 if enabled else 0),
    )
    _DB.commit()


def set_next_run(name: str, next_run_iso: str) -> None:
    _DB.execute(
        "INSERT INTO daemon_state (name, next_run) VALUES (?, ?) "
        "ON CONFLICT(name) DO UPDATE SET next_run = excluded.next_run",
        (name, next_run_iso),
    )
    _DB.commit()


def set_last_run(name: str, last_run_iso: str) -> None:
    _DB.execute(
        "INSERT INTO daemon_state (name, last_run) VALUES (?, ?) "
        "ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run",
        (name, last_run_iso),
    )
    _DB.commit()
