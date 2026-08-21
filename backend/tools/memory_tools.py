"""MEMORY tools (spec §33–§35) — SCOUT decides what to remember.

The model calls these when the user explicitly asks to remember/forget/update a
fact. Keys should be short stable snake_case ids (e.g. 'preferred_editor') so an
update to the same fact finds and supersedes the old value (spec §35/§62).
"""

from __future__ import annotations

from backend.memory import personal
from backend.tools.base import PermissionLevel, Tool, ToolResult

_CATEGORIES = ", ".join(personal.CATEGORIES)


async def _remember(key: str, value: str, category: str = "other") -> ToolResult:
    r = await personal.remember(category, key, value)
    if not r.get("ok"):
        return ToolResult(ok=False, summary=f"I couldn't save that, sir — {r.get('reason', 'memory unavailable')}.", data=r)
    label = key.replace("_", " ")
    if r["action"] == "updated":
        return ToolResult(ok=True, summary=f"Updated your {label} from {r['old_value']} to {value}.", data=r)
    if r["action"] == "unchanged":
        return ToolResult(ok=True, summary=f"Already remembered: your {label} is {value}.", data=r)
    return ToolResult(ok=True, summary=f"Remembered: your {label} is {value}.", data=r)


async def _forget(key: str) -> ToolResult:
    r = await personal.forget(key)
    if not r.get("ok"):
        return ToolResult(ok=False, summary=f"Nothing to forget for '{key}', sir.", data=r)
    return ToolResult(ok=True, summary=f"Forgotten: {key.replace('_', ' ')}.", data=r)


async def _list_memories() -> ToolResult:
    mems = await personal.list_current()
    if not mems:
        return ToolResult(ok=True, summary="I have no saved memories yet, sir.", data={"memories": []})
    lines = [f"{m['key'].replace('_', ' ')}: {m['value']}" for m in mems]
    return ToolResult(ok=True, summary="Here's what I remember:\n" + "\n".join(lines), data={"memories": mems})


def register(registry) -> None:
    registry.register(
        Tool(
            name="remember",
            description=(
                "Store or UPDATE a durable fact the user explicitly asked you to remember "
                "(preferences, projects, identity, goals). Reuse the same short snake_case "
                f"key to update an existing fact. category is one of: {_CATEGORIES}."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Short stable id, e.g. 'preferred_editor'."},
                    "value": {"type": "string", "description": "The value to remember."},
                    "category": {"type": "string", "description": f"One of: {_CATEGORIES}."},
                },
                "required": ["key", "value"],
            },
            handler=_remember,
            permission=PermissionLevel.SAFE,
            category="memory",
        )
    )
    registry.register(
        Tool(
            name="forget",
            description="Forget a previously remembered fact by its key (marks it superseded).",
            parameters={
                "type": "object",
                "properties": {"key": {"type": "string", "description": "The key to forget."}},
                "required": ["key"],
            },
            handler=_forget,
            permission=PermissionLevel.SAFE,
            category="memory",
        )
    )
    registry.register(
        Tool(
            name="list_memories",
            description="List what SCOUT currently remembers about the user.",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=_list_memories,
            permission=PermissionLevel.SAFE,
            category="memory",
        )
    )
