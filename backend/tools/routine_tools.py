"""Routine tools (spec §31) — let Scout set up recurring tasks from chat/voice.

"Every morning, summarise my calendar and unread email" → create_routine. The
routine then runs on its schedule via the backend scheduler and notifies the user.
All SAFE (managing the user's own routines); running them later goes through the
normal permission gate like any other task.
"""

from __future__ import annotations

from backend.tools.base import PermissionLevel, Tool, ToolResult


def _create_routine(prompt: str, schedule: str) -> ToolResult:
    from backend.integrations import routines

    r = routines.add(prompt, schedule)
    if not r.get("ok"):
        return ToolResult(ok=False, summary=f"Couldn't create the routine: {r.get('reason')}")
    return ToolResult(
        ok=True,
        summary=f"Routine set: “{r['title']}” — {r['schedule']}. I'll run it and notify you.",
        data=r,
    )


def _list_routines() -> ToolResult:
    from backend.integrations import routines

    items = routines.list_all()
    if not items:
        return ToolResult(ok=True, summary="No routines set up yet.", data={"routines": []})
    lines = [f"- {r['title']} ({r['schedule']}{'' if r['enabled'] else ', paused'})" for r in items]
    return ToolResult(ok=True, summary="Your routines:\n" + "\n".join(lines), data={"routines": items})


def _delete_routine(id: str) -> ToolResult:
    from backend.integrations import routines

    return ToolResult(ok=routines.remove(id), summary="Routine removed." if routines.remove(id) else "No such routine.")


def register(registry) -> None:
    S = PermissionLevel.SAFE
    registry.register(
        Tool(
            name="create_routine",
            description=(
                "Set up a recurring task that runs automatically on a schedule (e.g. summarise the "
                "calendar every morning, check a site daily). Give the task and a schedule phrase."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "What to do each time, e.g. 'Summarise my calendar and unread email'."},
                    "schedule": {"type": "string", "description": "When, e.g. 'every morning', 'every friday 5pm', 'every 2 hours'."},
                },
                "required": ["prompt", "schedule"],
            },
            handler=_create_routine,
            permission=S,
            category="productivity",
        )
    )
    registry.register(
        Tool(
            name="list_routines",
            description="List the user's recurring routines.",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=_list_routines,
            permission=S,
            category="productivity",
        )
    )
    registry.register(
        Tool(
            name="delete_routine",
            description="Delete a routine by its id.",
            parameters={"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
            handler=_delete_routine,
            permission=S,
            category="productivity",
        )
    )
