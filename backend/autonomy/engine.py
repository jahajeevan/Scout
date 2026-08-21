"""Autonomy engine — daemon registry, scheduler tick, action executor.

Daemons register themselves at import time via ``@daemon(...)``. The scheduler
tick (called from main.py's background loop) looks at each enabled daemon,
checks whether ``next_run`` has arrived, invokes it, records the outcome, and
advances ``next_run``. Daemons return a ``DaemonResult`` describing what they
did — either a plain summary (SAFE) or a proposal payload (PROPOSE).

Approvals: the caller invokes ``execute_proposal(pid)`` which pulls the encoded
tool actions and runs them through the shared tool registry — so every action
is exactly one Scout tool call, permission-checked and auditable.
"""

from __future__ import annotations

import asyncio
import inspect
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from backend.autonomy import proposals

Schedule = dict[str, Any]  # {"kind": "daily|weekly|interval|manual", ...}


class Permission:
    SAFE = "safe"
    PROPOSE = "propose"


@dataclass
class DaemonResult:
    ok: bool
    summary: str
    proposal: dict | None = None  # {"title", "body", "actions": [...]}


@dataclass
class Daemon:
    name: str
    description: str
    schedule: Schedule
    permission: str
    handler: Callable[[], Awaitable[DaemonResult] | DaemonResult]
    category: str = "general"

    def as_dict(self) -> dict:
        st = proposals.get_state(self.name)
        return {
            "name": self.name,
            "description": self.description,
            "schedule": self.schedule,
            "permission": self.permission,
            "category": self.category,
            "enabled": st["enabled"],
            "last_run": st["last_run"],
            "next_run": st["next_run"],
        }


_REGISTRY: dict[str, Daemon] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _compute_next(schedule: Schedule, after: datetime | None = None) -> datetime | None:
    """Return the next fire time for a schedule, or None if manual/one-shot done."""
    a = after or _now()
    kind = schedule.get("kind", "manual")
    if kind == "manual":
        return None
    if kind == "interval":
        return a + timedelta(minutes=int(schedule.get("minutes", 60)))
    hh = int(schedule.get("hh", 9))
    mm = int(schedule.get("mm", 0))
    nxt = a.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if kind == "daily":
        if nxt <= a:
            nxt += timedelta(days=1)
        return nxt
    if kind == "weekly":
        target = int(schedule.get("day", 0))  # 0 = monday
        delta = (target - a.weekday()) % 7
        nxt = nxt + timedelta(days=delta)
        if nxt <= a:
            nxt += timedelta(days=7)
        return nxt
    return None


def daemon(
    name: str,
    description: str,
    schedule: Schedule,
    permission: str = Permission.SAFE,
    category: str = "general",
):
    """Decorator: register a coroutine (or sync fn) as a Scout autonomy daemon."""

    def _wrap(fn):
        d = Daemon(
            name=name, description=description, schedule=schedule,
            permission=permission, handler=fn, category=category,
        )
        _REGISTRY[name] = d
        # Seed next_run so the scheduler knows when to first fire it.
        st = proposals.get_state(name)
        if not st.get("next_run"):
            nxt = _compute_next(schedule)
            if nxt:
                proposals.set_next_run(name, nxt.isoformat())
        return fn

    return _wrap


def list_daemons() -> list[dict]:
    return [d.as_dict() for d in _REGISTRY.values()]


def get_daemon(name: str) -> Daemon | None:
    return _REGISTRY.get(name)


async def _invoke(d: Daemon) -> DaemonResult:
    try:
        rv = d.handler()
        if inspect.isawaitable(rv):
            rv = await rv
        if isinstance(rv, DaemonResult):
            return rv
        return DaemonResult(ok=True, summary=str(rv or ""))
    except Exception as exc:
        return DaemonResult(ok=False, summary=f"{type(exc).__name__}: {str(exc)[:200]}")


async def run_now(name: str) -> DaemonResult:
    """Fire a daemon immediately, regardless of schedule. Records the run."""
    d = _REGISTRY.get(name)
    if not d:
        return DaemonResult(ok=False, summary=f"No such daemon: {name}")
    res = await _invoke(d)
    _record_after_run(d, res)
    return res


def _current_mode() -> str:
    """Read the current autonomy execution mode set from the UI.
    Importing lazily to avoid a circular dep with backend.main."""
    try:
        from backend.main import _AUTONOMY_MODE  # type: ignore
        return _AUTONOMY_MODE.get("value", "plan")
    except Exception:
        return "plan"


def _record_after_run(d: Daemon, res: DaemonResult) -> None:
    now = _now()
    proposals.log_run(d.name, res.ok, res.summary or "(no summary)")
    proposals.set_last_run(d.name, now.isoformat())
    nxt = _compute_next(d.schedule, now)
    if nxt:
        proposals.set_next_run(d.name, nxt.isoformat())
    if res.proposal:
        prop = proposals.create(
            daemon=d.name,
            title=res.proposal.get("title", d.description),
            body=res.proposal.get("body", ""),
            actions=res.proposal.get("actions", []),
        )
        # Bypass mode: auto-approve PROPOSE outputs. The activity log still shows
        # the proposal — nothing runs silently — but no user click is required.
        if _current_mode() == "bypass":
            import asyncio as _a
            _a.create_task(execute_proposal(prop["id"]))


async def tick() -> int:
    """Run every daemon whose next_run is due. Returns count fired."""
    fired = 0
    now = _now().isoformat()
    for d in list(_REGISTRY.values()):
        st = proposals.get_state(d.name)
        if not st["enabled"]:
            continue
        nxt = st.get("next_run")
        if not nxt or nxt > now:
            continue
        res = await _invoke(d)
        _record_after_run(d, res)
        fired += 1
    return fired


async def execute_proposal(pid: str) -> dict:
    """Approve a proposal → run each encoded tool action through the registry."""
    from backend.tools import registry as tool_registry

    prop = proposals.get(pid)
    if not prop:
        return {"ok": False, "error": "no such proposal"}
    if prop["status"] != "pending":
        return {"ok": False, "error": f"already {prop['status']}"}

    results: list[dict] = []
    all_ok = True
    for act in prop["actions"]:
        tool = act.get("tool", "")
        args = act.get("args", {}) or {}
        try:
            # User pressed approve → this IS the confirmation; pass confirm=True
            # so CONFIRMATION_REQUIRED tools (send_email, write_file, …) actually run.
            r = await tool_registry.execute(tool, args, confirm=True)
            ok = getattr(r, "ok", True)
            summary = getattr(r, "summary", str(r))
            results.append({"tool": tool, "ok": ok, "summary": summary})
            if not ok:
                all_ok = False
        except Exception as exc:
            all_ok = False
            results.append({"tool": tool, "ok": False, "summary": f"{type(exc).__name__}: {exc}"})

    outcome = "; ".join(f"{r['tool']}: {'ok' if r['ok'] else 'fail'}" for r in results)[:500]
    proposals.mark(pid, "approved" if all_ok else "failed", outcome)
    return {"ok": all_ok, "results": results, "outcome": outcome}


def reject_proposal(pid: str, reason: str = "") -> bool:
    return proposals.mark(pid, "rejected", reason or "user rejected")
