"""Routines (spec §31) — recurring, proactive tasks Scout runs on a schedule.

A routine is a saved instruction ("summarise my calendar") plus a schedule
("every morning", "every hour", "every friday 5pm"). A background scheduler runs
due routines through the orchestrator and delivers the result as a notification.

Schedules are stored structurally (daily / interval / weekly) with a computed
``next_run``; the scheduler advances it after each run. Natural-language phrases
are parsed leniently into that structure.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

from backend.config import ROOT_DIR

_DB_PATH = ROOT_DIR / "config" / "scout_routines.db"
_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()  # local tz for schedule times


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS routines ("
        "id TEXT PRIMARY KEY, title TEXT, prompt TEXT NOT NULL, schedule TEXT, "
        "recur TEXT, next_run TEXT, enabled INTEGER DEFAULT 1, last_run TEXT, "
        "last_result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    try:
        conn.execute("ALTER TABLE routines ADD COLUMN delivered INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return conn


_DB = _conn()


def _extract_time(p: str) -> tuple[int, int]:
    """Pull an HH:MM out of a phrase, honouring am/pm and time-of-day words."""
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", p)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2) or 0)
        ap = m.group(3)
        if ap == "pm" and hh < 12:
            hh += 12
        if ap == "am" and hh == 12:
            hh = 0
        if 0 <= hh <= 23 and 0 <= mm <= 59 and (m.group(3) or m.group(2) or "1" <= m.group(1) <= "24"):
            return hh, mm
    if "morning" in p:
        return 8, 0
    if "afternoon" in p:
        return 14, 0
    if "evening" in p:
        return 18, 0
    if "night" in p:
        return 21, 0
    return 9, 0


def _parse_schedule(phrase: str) -> tuple[str, dict, datetime]:
    """Return (label, recur-dict, next_run) from a natural schedule phrase."""
    p = (phrase or "").strip().lower()
    now = _now()

    # interval: "every 30 minutes", "every 2 hours", "hourly"
    mins = None
    if "hourly" in p:
        mins = 60
    m = re.search(r"every\s+(\d+)\s*(minute|min|hour|hr)", p)
    if m:
        n = int(m.group(1))
        mins = n * (60 if m.group(2).startswith(("hour", "hr")) else 1)
    elif re.search(r"every\s+(hour)", p):
        mins = 60
    if mins:
        return (f"every {mins} min", {"kind": "interval", "minutes": mins}, now + timedelta(minutes=mins))

    # weekly: a weekday name present
    for i, day in enumerate(_WEEKDAYS):
        if day in p or day[:3] in p:
            hh, mm = _extract_time(p)
            nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            delta = (i - now.weekday()) % 7
            nxt += timedelta(days=delta)
            if nxt <= now:
                nxt += timedelta(days=7)
            return (f"{day.capitalize()} {hh:02d}:{mm:02d}", {"kind": "weekly", "day": i, "hh": hh, "mm": mm}, nxt)

    # default: daily at a time
    hh, mm = _extract_time(p)
    nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return (f"daily {hh:02d}:{mm:02d}", {"kind": "daily", "hh": hh, "mm": mm}, nxt)


def _advance(recur: dict, after: datetime) -> datetime:
    kind = recur.get("kind")
    if kind == "interval":
        return after + timedelta(minutes=int(recur.get("minutes", 60)))
    hh, mm = int(recur.get("hh", 9)), int(recur.get("mm", 0))
    nxt = after.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if kind == "weekly":
        nxt += timedelta(days=7)
        while nxt <= after:
            nxt += timedelta(days=7)
    else:  # daily
        if nxt <= after:
            nxt += timedelta(days=1)
    return nxt


def add(prompt: str, schedule: str, title: str | None = None) -> dict:
    prompt = (prompt or "").strip()
    if not prompt:
        return {"ok": False, "reason": "empty routine"}
    label, recur, next_run = _parse_schedule(schedule)
    rid = uuid.uuid4().hex[:12]
    _DB.execute(
        "INSERT INTO routines (id, title, prompt, schedule, recur, next_run) VALUES (?, ?, ?, ?, ?, ?)",
        (rid, (title or prompt[:48]), prompt, label, json.dumps(recur), next_run.isoformat()),
    )
    _DB.commit()
    return {"ok": True, "id": rid, "title": title or prompt[:48], "schedule": label, "next_run": next_run.isoformat()}


def _row(r) -> dict:
    return {
        "id": r[0], "title": r[1], "prompt": r[2], "schedule": r[3],
        "enabled": bool(r[4]), "next_run": r[5], "last_run": r[6], "last_result": r[7],
    }


def list_all() -> list[dict]:
    rows = _DB.execute(
        "SELECT id, title, prompt, schedule, enabled, next_run, last_run, last_result FROM routines ORDER BY created_at DESC"
    ).fetchall()
    return [_row(r) for r in rows]


def due() -> list[dict]:
    """Enabled routines whose time has arrived. Caller runs them then calls record()."""
    now = _now().isoformat()
    rows = _DB.execute(
        "SELECT id, title, prompt, schedule, enabled, next_run, last_run, last_result FROM routines "
        "WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?",
        (now,),
    ).fetchall()
    return [_row(r) for r in rows]


def record(rid: str, result: str) -> None:
    """Store a run's result and advance next_run to the following occurrence."""
    row = _DB.execute("SELECT recur FROM routines WHERE id = ?", (rid,)).fetchone()
    recur = json.loads(row[0]) if row and row[0] else {"kind": "daily", "hh": 9, "mm": 0}
    nxt = _advance(recur, _now())
    _DB.execute(
        "UPDATE routines SET last_run = ?, last_result = ?, next_run = ?, delivered = 0 WHERE id = ?",
        (_now().isoformat(), result[:2000], nxt.isoformat(), rid),
    )
    _DB.commit()


def pending_notifications() -> list[dict]:
    """Freshly-run routine results not yet delivered — marks them delivered."""
    rows = _DB.execute(
        "SELECT id, title, last_result FROM routines WHERE delivered = 0 AND last_result IS NOT NULL"
    ).fetchall()
    if rows:
        _DB.executemany("UPDATE routines SET delivered = 1 WHERE id = ?", [(r[0],) for r in rows])
        _DB.commit()
    return [{"id": r[0], "title": r[1], "result": r[2]} for r in rows]


def set_enabled(rid: str, enabled: bool) -> bool:
    cur = _DB.execute("UPDATE routines SET enabled = ? WHERE id = ?", (1 if enabled else 0, rid))
    _DB.commit()
    return cur.rowcount > 0


def remove(rid: str) -> bool:
    cur = _DB.execute("DELETE FROM routines WHERE id = ?", (rid,))
    _DB.commit()
    return cur.rowcount > 0
