"""Productivity tools (spec §30) — email, calendar, reminders as agent tools.

These wrap the Google integrations + the local reminders store so Scout (chat),
Code mode, and the orchestrator can all use them through the one tool registry.
Reading email/calendar and managing reminders are SAFE; **sending email** is
CONFIRMATION_REQUIRED — Scout never sends a message on your behalf without a
clear yes (spec §42).
"""

from __future__ import annotations

import asyncio

from backend.tools.base import PermissionLevel, Tool, ToolResult


async def _check_email(limit: int = 5) -> ToolResult:
    from backend.integrations import gmail

    data = await asyncio.to_thread(gmail.get_summary, int(limit))
    if not data.get("authorized"):
        return ToolResult(ok=False, summary="Gmail isn't connected yet — connect it in Settings → Connectors.")
    msgs = data.get("messages", [])
    if not msgs:
        return ToolResult(ok=True, summary=f"{data.get('unread', 0)} unread emails; nothing notable up top.", data=data)
    lines = [f"- {m['from']}: {m['subject']}" for m in msgs]
    return ToolResult(ok=True, summary=f"{data.get('unread', 0)} unread. Latest:\n" + "\n".join(lines), data=data)


async def _send_email(to: str, subject: str, body: str) -> ToolResult:
    from backend.integrations import gmail

    ok, detail = await asyncio.to_thread(gmail.send_email, to, subject, body)
    if ok:
        return ToolResult(ok=True, summary=f"Email sent to {to}.", data={"to": to, "subject": subject})
    if detail == "not_connected":
        return ToolResult(ok=False, summary="Couldn't send — Gmail isn't connected. Open Settings → Connectors → Connect.")
    lowered = detail.lower()
    if "insufficient" in lowered or "scope" in lowered or "permission" in lowered or "403" in lowered:
        return ToolResult(
            ok=False,
            summary=(
                "Gmail is connected but doesn't have SEND permission. "
                "Reconnect: Settings → Connectors → Disconnect, then Connect again "
                "and grant \"Send email on your behalf\" when Google asks."
            ),
            data={"detail": detail},
        )
    return ToolResult(ok=False, summary=f"Send failed: {detail}", data={"detail": detail})


async def _list_calendar(count: int = 5) -> ToolResult:
    from backend.integrations import calendar as cal

    data = await asyncio.to_thread(cal.get_upcoming, int(count))
    if not data.get("authorized"):
        return ToolResult(ok=False, summary="Calendar isn't connected yet — connect it in Settings → Connectors.")
    events = data.get("events", [])
    if not events:
        return ToolResult(ok=True, summary="Nothing on your calendar coming up.", data=data)
    lines = [f"- {e.get('time', '')}: {e.get('title', '')}" for e in events]
    return ToolResult(ok=True, summary="Upcoming:\n" + "\n".join(lines), data=data)


def _add_reminder(text: str, due: str = "") -> ToolResult:
    from backend.integrations import reminders

    r = reminders.add(text, due or None)
    if not r.get("ok"):
        return ToolResult(ok=False, summary=f"Couldn't add reminder: {r.get('reason')}")
    when = f" (due {due})" if due else ""
    return ToolResult(ok=True, summary=f"Reminder added: {text}{when}.", data=r)


def _list_reminders() -> ToolResult:
    from backend.integrations import reminders

    items = reminders.list_all()
    if not items:
        return ToolResult(ok=True, summary="No reminders right now.", data={"reminders": []})
    lines = [f"- {i['text']}" + (f" (due {i['due']})" if i.get("due") else "") for i in items]
    return ToolResult(ok=True, summary="Your reminders:\n" + "\n".join(lines), data={"reminders": items})


def _complete_reminder(id: str) -> ToolResult:
    from backend.integrations import reminders

    ok = reminders.complete(id)
    return ToolResult(ok=ok, summary="Marked done." if ok else "No such reminder.")


def register(registry) -> None:
    S, C = PermissionLevel.SAFE, PermissionLevel.CONFIRMATION_REQUIRED
    specs = [
        ("check_email", "Check the user's unread Gmail (count + latest senders/subjects).",
         {"type": "object", "properties": {"limit": {"type": "integer", "description": "How many to preview."}}, "required": []},
         _check_email, S),
        ("send_email", "Send an email from the user's Gmail account.",
         {"type": "object", "properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}, "required": ["to", "subject", "body"]},
         _send_email, C),
        ("list_calendar", "List the user's upcoming calendar events.",
         {"type": "object", "properties": {"count": {"type": "integer"}}, "required": []},
         _list_calendar, S),
        ("add_reminder", "Add a reminder for the user.",
         {"type": "object", "properties": {"text": {"type": "string"}, "due": {"type": "string", "description": "Optional natural-language time, e.g. 'tomorrow 9am'."}}, "required": ["text"]},
         _add_reminder, S),
        ("list_reminders", "List the user's active reminders.",
         {"type": "object", "properties": {}, "required": []}, _list_reminders, S),
        ("complete_reminder", "Mark a reminder done by its id.",
         {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}, _complete_reminder, S),
    ]
    for name, desc, params, handler, perm in specs:
        registry.register(Tool(name=name, description=desc, parameters=params, handler=handler, permission=perm, category="productivity"))
