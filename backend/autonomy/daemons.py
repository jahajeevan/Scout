"""First shipping daemons — proving the engine end-to-end.

Each is small, honest, and reversible. SAFE daemons post a banner
notification; PROPOSE daemons drop a card into the approval inbox so nothing
irreversible happens without a yes.

- ``downloads_cleaner`` (weekly, PROPOSE) — archive Downloads files >30d old
- ``bin_monitor``       (daily,  SAFE)   — banner when Trash exceeds 1 GB
- ``weekly_summary``    (weekly, SAFE)   — Sunday 21:00 week-in-review notification
- ``email_drafter``     (daily,  PROPOSE)— draft replies to unread email for morning review
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path

from backend.autonomy.engine import DaemonResult, Permission, daemon

_DOWNLOADS = Path.home() / "Downloads"
_TRASH = Path.home() / ".Trash"
_ARCHIVE_ROOT = _DOWNLOADS / "_scout_archive"
_DOWNLOADS_AGE_DAYS = 30
_TRASH_ALERT_BYTES = 1 * 1024 * 1024 * 1024   # 1 GB


# ─── helpers ──────────────────────────────────────────────────────────────

def _size_gb(bytes_: int) -> str:
    return f"{bytes_ / (1024**3):.2f} GB"


def _dir_size(root: Path) -> int:
    total = 0
    for base, _dirs, files in os.walk(root):
        for f in files:
            try:
                total += (Path(base) / f).stat().st_size
            except OSError:
                pass
    return total


def _old_files(root: Path, days: int) -> list[Path]:
    if not root.is_dir():
        return []
    cutoff = datetime.now().timestamp() - days * 86400
    out: list[Path] = []
    for entry in root.iterdir():
        # skip our own archive folder and dotfiles/system junk
        if entry.name.startswith(".") or entry == _ARCHIVE_ROOT:
            continue
        try:
            if entry.stat().st_mtime < cutoff:
                out.append(entry)
        except OSError:
            continue
    return out


# ─── downloads_cleaner ────────────────────────────────────────────────────

@daemon(
    name="downloads_cleaner",
    description="Every Sunday, propose archiving Downloads files older than 30 days.",
    schedule={"kind": "weekly", "day": 6, "hh": 20, "mm": 0},  # Sunday 20:00
    permission=Permission.PROPOSE,
    category="cleanup",
)
async def downloads_cleaner() -> DaemonResult:
    olds = _old_files(_DOWNLOADS, _DOWNLOADS_AGE_DAYS)
    if not olds:
        return DaemonResult(ok=True, summary="Nothing older than 30 days in Downloads.")
    olds_by_size = sorted(olds, key=lambda p: -p.stat().st_size)[:50]
    total = sum(p.stat().st_size for p in olds if p.is_file())
    lines = [f"- {p.name}  ({_size_gb(p.stat().st_size)})" for p in olds_by_size[:25]]
    body = (
        f"{len(olds)} item(s) in ~/Downloads are older than {_DOWNLOADS_AGE_DAYS} days "
        f"— together about {_size_gb(total)}.\n\nTop items:\n" + "\n".join(lines)
    )
    if len(olds) > 25:
        body += f"\n… and {len(olds) - 25} more."
    proposal = {
        "title": f"Archive {len(olds)} old files from Downloads (~{_size_gb(total)})",
        "body": body,
        "actions": [{
            "tool": "archive_files",
            "args": {"paths": [str(p) for p in olds], "archive_root": str(_ARCHIVE_ROOT)},
        }],
    }
    return DaemonResult(ok=True, summary=f"Proposed archive of {len(olds)} files.", proposal=proposal)


# ─── bin_monitor ──────────────────────────────────────────────────────────

@daemon(
    name="bin_monitor",
    description="Every evening, alert if the Trash has grown past 1 GB.",
    schedule={"kind": "daily", "hh": 20, "mm": 0},
    permission=Permission.SAFE,
    category="cleanup",
)
async def bin_monitor() -> DaemonResult:
    if not _TRASH.exists():
        return DaemonResult(ok=True, summary="No ~/.Trash directory.")
    size = _dir_size(_TRASH)
    if size < _TRASH_ALERT_BYTES:
        return DaemonResult(ok=True, summary=f"Trash is {_size_gb(size)} — under threshold.")
    # Send a native banner via the tool so the user actually sees it.
    from backend.tools import registry as tool_registry
    await tool_registry.execute(
        "notify",
        {
            "title": "Trash is getting big",
            "message": f"~/.Trash is {_size_gb(size)}. Say 'empty the trash' to Scout.",
            "subtitle": "Scout — bin monitor",
        },
    )
    return DaemonResult(ok=True, summary=f"Notified: trash is {_size_gb(size)}.")


# ─── weekly_summary ───────────────────────────────────────────────────────

_WEEKLY_PROMPT = """Give me a warm, specific week-in-review for the user.
Use the memory tools to recall notable things they mentioned this week
(projects, decisions, people, feelings, wins, unfinished threads). Keep it to
6-10 short bullets, then one honest reflection line and one gentle suggestion
for the week ahead. Be a good friend, not a corporate coach."""


@daemon(
    name="weekly_summary",
    description="Sunday night, write a personal week-in-review from Scout's memory.",
    schedule={"kind": "weekly", "day": 6, "hh": 21, "mm": 0},  # Sunday 21:00
    permission=Permission.SAFE,
    category="reflection",
)
async def weekly_summary() -> DaemonResult:
    from backend.agents import orchestrator
    from backend.tools import registry as tool_registry
    try:
        result = await orchestrator.run(_WEEKLY_PROMPT)
    except Exception as exc:
        return DaemonResult(ok=False, summary=f"Summary run failed: {exc}")
    body = (result.reply or "").strip()
    if not body:
        return DaemonResult(ok=False, summary="Empty reply from orchestrator.")
    # Banner is short; the full text is preserved in the daemon_runs log.
    await tool_registry.execute(
        "notify",
        {
            "title": "Your week — a look back",
            "message": body[:200] + ("…" if len(body) > 200 else ""),
            "subtitle": "Scout weekly summary",
        },
    )
    return DaemonResult(ok=True, summary=body)


# ─── email_drafter ────────────────────────────────────────────────────────

@daemon(
    name="email_drafter",
    description="Late evening: draft replies to unread email so mornings start empty.",
    schedule={"kind": "daily", "hh": 22, "mm": 0},
    permission=Permission.PROPOSE,
    category="communications",
)
async def email_drafter() -> DaemonResult:
    from backend.integrations import gmail
    try:
        data = await asyncio.to_thread(gmail.get_summary, 8)
    except Exception as exc:
        return DaemonResult(ok=False, summary=f"Gmail read failed: {exc}")
    if not data.get("authorized"):
        return DaemonResult(ok=True, summary="Gmail not connected — skipped.")
    messages = data.get("messages") or []
    unread = [m for m in messages if m.get("unread")] or messages[:3]
    if not unread:
        return DaemonResult(ok=True, summary="No unread mail worth drafting.")

    from backend.agents import orchestrator
    drafts: list[dict] = []
    for m in unread[:5]:
        sender = m.get("from", "")
        subject = m.get("subject", "(no subject)")
        snippet = m.get("snippet", "")
        prompt = (
            "Draft a short, warm, honest reply to this email. Match the sender's "
            "tone. No fluff, no signature, no subject line — just the reply body.\n\n"
            f"From: {sender}\nSubject: {subject}\n\n{snippet}"
        )
        try:
            res = await orchestrator.run(prompt)
            reply = (res.reply or "").strip()
        except Exception as exc:
            reply = f"(couldn't draft: {exc})"
        if reply and not reply.startswith("(couldn't"):
            drafts.append({"to": sender, "subject": "Re: " + subject, "body": reply})

    if not drafts:
        return DaemonResult(ok=True, summary="Couldn't draft any replies tonight.")

    body_parts = []
    for d in drafts:
        body_parts.append(f"→ To {d['to']}\n  {d['subject']}\n\n{d['body']}\n")
    proposal = {
        "title": f"{len(drafts)} email reply draft(s) — approve to send",
        "body": "\n---\n".join(body_parts),
        "actions": [
            {"tool": "send_email", "args": d} for d in drafts
        ],
    }
    return DaemonResult(
        ok=True,
        summary=f"Drafted {len(drafts)} replies — awaiting approval.",
        proposal=proposal,
    )
