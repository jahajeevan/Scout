"""Persistent personal memory (spec §32–§46) — SCOUT's long-term knowledge of the user.

Structured, categorized, and VERSIONED: updating a fact supersedes the old row
(status='superseded') and inserts a new current one, so history is traceable and
the model is never handed two conflicting "current" facts (spec §35/§36/§43).

Backed by the Supabase `memories` table via REST (publishable key). Degrades to a
clear error if not configured — never crashes a turn (spec §48/§59). This is
distinct from chat history: deleting a conversation does not delete a memory the
user explicitly asked SCOUT to keep (spec §45).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

from backend.config import SUPABASE_KEY, SUPABASE_URL

_BASE = f"{SUPABASE_URL}/rest/v1/memories" if SUPABASE_URL else None
_TIMEOUT = httpx.Timeout(15.0)

CATEGORIES = ["identity", "preferences", "projects", "technical", "workflows", "goals", "facts", "other"]

# Never auto-store secrets even if they appear in conversation (spec §38).
_SECRET_RE = re.compile(r"(password|api[_ ]?key|secret|token|credential|ssn|cvv|otp)", re.I)


def configured() -> bool:
    return bool(_BASE and SUPABASE_KEY)


def _headers(extra: dict | None = None) -> dict:
    h = {"apikey": SUPABASE_KEY or "", "Authorization": f"Bearer {SUPABASE_KEY or ''}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (key or "").lower()).strip("_")


async def _get(params: dict) -> list[dict]:
    if not configured():
        return []
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.get(_BASE, headers=_headers(), params=params)
            return r.json() if r.status_code < 300 else []
    except Exception:
        return []


async def list_current() -> list[dict]:
    return await _get({"status": "eq.current", "order": "category.asc,updated_at.desc"})


async def list_all() -> list[dict]:
    return await _get({"order": "updated_at.desc"})


async def remember(category: str, key: str, value: str, confidence: str = "explicit", source: str = "chat") -> dict:
    """Store or UPDATE a memory. If the key already has a current value, the old
    one is superseded and a new current row is written (versioning)."""
    if not configured():
        return {"ok": False, "reason": "memory store not configured"}
    value = (value or "").strip()
    if not value:
        return {"ok": False, "reason": "empty value"}
    if _SECRET_RE.search(f"{key} {value}"):
        return {"ok": False, "reason": "refused: looks like a secret; not stored in plain memory"}
    nkey = normalize_key(key)
    cat = category if category in CATEGORIES else "other"
    existing = await _get({"status": "eq.current", "key": f"eq.{nkey}"})
    old = existing[0] if existing else None
    if old and old["value"].strip().lower() == value.lower():
        return {"ok": True, "action": "unchanged", "key": nkey, "value": value}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            if old:
                await c.patch(
                    f"{_BASE}?id=eq.{old['id']}",
                    headers=_headers(),
                    json={"status": "superseded", "updated_at": _now()},
                )
            await c.post(
                _BASE,
                headers=_headers({"Prefer": "return=minimal"}),
                json={"category": cat, "key": nkey, "value": value, "confidence": confidence, "source": source, "updated_at": _now()},
            )
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    return {
        "ok": True,
        "action": "updated" if old else "created",
        "category": cat,
        "key": nkey,
        "value": value,
        "old_value": old["value"] if old else None,
    }


async def forget(key: str) -> dict:
    if not configured():
        return {"ok": False, "reason": "memory store not configured"}
    nkey = normalize_key(key)
    existing = await _get({"status": "eq.current", "key": f"eq.{nkey}"})
    if not existing:
        return {"ok": False, "reason": "nothing to forget", "key": nkey}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            await c.patch(f"{_BASE}?id=eq.{existing[0]['id']}", headers=_headers(), json={"status": "superseded", "updated_at": _now()})
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "key": nkey}


async def delete_by_id(mem_id: str) -> dict:
    if not configured():
        return {"ok": False}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            await c.delete(f"{_BASE}?id=eq.{mem_id}", headers=_headers())
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True}


async def edit_by_id(mem_id: str, value: str) -> dict:
    if not configured():
        return {"ok": False}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            await c.patch(f"{_BASE}?id=eq.{mem_id}", headers=_headers(), json={"value": value.strip(), "updated_at": _now()})
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    return {"ok": True}


async def context_block() -> str:
    """A compact 'what SCOUT knows about the user' block for the system prompt.

    Only CURRENT memories (spec §42/§46) — never the whole/superseded history.
    """
    mems = await list_current()
    if not mems:
        return ""
    lines = [f"- {m['key'].replace('_', ' ')}: {m['value']}" for m in mems[:40]]
    return "What you remember about the user (from earlier — treat as current):\n" + "\n".join(lines)
