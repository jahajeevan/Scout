"""Reminders + scheduling (spec §31) — a local, time-aware reminders store.

Reminders can carry a natural-language time ("tomorrow 9am", "in 2 hours"), which
is parsed to an absolute ``due_at``. ``due_now()`` returns the reminders that have
just come due and marks them fired — the macOS menu-bar helper polls it and raises
a native notification, so reminders reach you even with the browser closed.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from backend.config import ROOT_DIR

_DB_PATH = ROOT_DIR / "config" / "scout_reminders.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS reminders ("
        "id TEXT PRIMARY KEY, text TEXT NOT NULL, due TEXT, done INTEGER DEFAULT 0, "
        "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    # Migrate older DBs: add the scheduling columns if they aren't there yet.
    for col, ddl in (("due_at", "TEXT"), ("fired", "INTEGER DEFAULT 0")):
        try:
            conn.execute(f"ALTER TABLE reminders ADD COLUMN {col} {ddl}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return conn


_DB = _conn()


def _parse_due(due: str | None) -> str | None:
    """Natural-language time → absolute UTC ISO, or None if unparseable/empty."""
    due = (due or "").strip()
    if not due:
        return None
    try:
        import dateparser

        dt = dateparser.parse(due, settings={"PREFER_DATES_FROM": "future", "RETURN_AS_TIMEZONE_AWARE": True})
        return dt.astimezone(timezone.utc).isoformat() if dt else None
    except Exception:
        return None


def add(text: str, due: str | None = None) -> dict:
    text = (text or "").strip()
    if not text:
        return {"ok": False, "reason": "empty reminder"}
    rid = uuid.uuid4().hex[:12]
    due_at = _parse_due(due)
    _DB.execute(
        "INSERT INTO reminders (id, text, due, due_at, created_at) VALUES (?, ?, ?, ?, ?)",
        (rid, text, (due or "").strip() or None, due_at, datetime.now(timezone.utc).isoformat()),
    )
    _DB.commit()
    return {"ok": True, "id": rid, "text": text, "due": due, "due_at": due_at}


def list_all(include_done: bool = False) -> list[dict]:
    sql = "SELECT id, text, due, due_at, done FROM reminders"
    if not include_done:
        sql += " WHERE done = 0"
    sql += " ORDER BY (due_at IS NULL), due_at ASC, created_at ASC"
    rows = _DB.execute(sql).fetchall()
    return [{"id": r[0], "text": r[1], "due": r[2], "due_at": r[3], "done": bool(r[4])} for r in rows]


def due_now() -> list[dict]:
    """Reminders whose time has arrived and haven't fired yet — marks them fired."""
    now = datetime.now(timezone.utc).isoformat()
    rows = _DB.execute(
        "SELECT id, text, due FROM reminders WHERE due_at IS NOT NULL AND due_at <= ? AND fired = 0 AND done = 0",
        (now,),
    ).fetchall()
    if rows:
        ids = [r[0] for r in rows]
        _DB.executemany("UPDATE reminders SET fired = 1 WHERE id = ?", [(i,) for i in ids])
        _DB.commit()
    return [{"id": r[0], "text": r[1], "due": r[2]} for r in rows]


def complete(rid: str) -> bool:
    cur = _DB.execute("UPDATE reminders SET done = 1 WHERE id = ?", (rid,))
    _DB.commit()
    return cur.rowcount > 0


def remove(rid: str) -> bool:
    cur = _DB.execute("DELETE FROM reminders WHERE id = ?", (rid,))
    _DB.commit()
    return cur.rowcount > 0


def count() -> int:
    return int(_DB.execute("SELECT COUNT(*) FROM reminders WHERE done = 0").fetchone()[0])
