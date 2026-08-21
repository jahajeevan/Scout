"""Tool registry + permission system — the ONLY path from a model to the machine.

No agent ever touches the OS directly. Every capability is a registered ``Tool``
with a JSON schema, a permission level, and a handler that returns a
human-readable ``ToolResult``. The registry enforces the permission gate before
anything runs, so there is never an unrestricted-shell escape hatch (spec §6/§7).

Permission levels (spec §6):
* ``SAFE``                  — runs immediately (read-only or trivially reversible).
* ``CONFIRMATION_REQUIRED`` — the caller must pass ``confirm=True``; otherwise the
  registry returns a "needs confirmation" result the UI turns into a prompt.
* ``BLOCKED``               — never runs (kill-switch for a capability).
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable


class PermissionLevel(str, Enum):
    SAFE = "safe"
    CONFIRMATION_REQUIRED = "confirmation_required"
    BLOCKED = "blocked"


@dataclass
class ToolResult:
    """The outcome of running a tool — always human-readable via ``summary``."""

    ok: bool
    summary: str
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    needs_confirmation: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "summary": self.summary,
            "data": self.data,
            "error": self.error,
            "needs_confirmation": self.needs_confirmation,
        }


Handler = Callable[..., Awaitable[ToolResult]] | Callable[..., ToolResult]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema for the arguments object
    handler: Handler
    permission: PermissionLevel = PermissionLevel.SAFE
    category: str = "general"

    def to_openai_schema(self) -> dict[str, Any]:
        """The shape GLM-5.2 / any OpenAI-compatible model expects in ``tools=``."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def _validate(self, args: dict[str, Any]) -> str | None:
        """Lightweight, dependency-free schema check. Returns an error or None."""
        props = self.parameters.get("properties", {})
        required = self.parameters.get("required", [])
        for key in required:
            if key not in args:
                return f"missing required argument '{key}'"
        for key, spec in props.items():
            if key not in args:
                continue
            want = spec.get("type")
            val = args[key]
            ok = {
                "string": isinstance(val, str),
                "integer": isinstance(val, int) and not isinstance(val, bool),
                "number": isinstance(val, (int, float)) and not isinstance(val, bool),
                "boolean": isinstance(val, bool),
                "array": isinstance(val, list),
                "object": isinstance(val, dict),
            }.get(want, True)
            if not ok:
                return f"argument '{key}' must be {want}"
            if "enum" in spec and val not in spec["enum"]:
                return f"argument '{key}' must be one of {spec['enum']}"
        return None

    async def run(self, args: dict[str, Any]) -> ToolResult:
        err = self._validate(args)
        if err:
            return ToolResult(ok=False, summary=f"Invalid call to {self.name}: {err}", error=err)
        try:
            result = self.handler(**args)
            if inspect.isawaitable(result):
                result = await result
            return result  # type: ignore[return-value]
        except Exception as exc:  # tools must never crash the agent loop
            return ToolResult(
                ok=False,
                summary=f"{self.name} failed: {exc}",
                error=str(exc),
            )


class ToolRegistry:
    """Central registry the orchestrator and agents share (spec §5, §7.5)."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate tool name: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def schemas(self, categories: list[str] | None = None) -> list[dict[str, Any]]:
        """Model-facing tool schemas, optionally filtered to some categories."""
        tools = self.all()
        if categories:
            tools = [t for t in tools if t.category in categories]
        return [
            t.to_openai_schema()
            for t in tools
            if t.permission is not PermissionLevel.BLOCKED
        ]

    async def execute(
        self, name: str, args: dict[str, Any] | None = None, *, confirm: bool = False
    ) -> ToolResult:
        """Run a tool through the permission gate. This is the only entry point."""
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult(ok=False, summary=f"No such tool: {name}", error="unknown_tool")
        args = args or {}
        if tool.permission is PermissionLevel.BLOCKED:
            return ToolResult(
                ok=False,
                summary=f"'{name}' is blocked by policy, sir.",
                error="blocked",
            )
        if tool.permission is PermissionLevel.CONFIRMATION_REQUIRED and not confirm:
            return ToolResult(
                ok=False,
                needs_confirmation=True,
                summary=f"This will run '{name}'. Confirm to proceed, sir.",
                data={"tool": name, "args": args},
            )
        return await tool.run(args)
