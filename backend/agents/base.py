"""Agent framework primitives (spec §7).

One JARVIS, many specialists. An ``AgentSpec`` is the metadata for a capability
area (its tools, permissions, what it's for); the Orchestrator coordinates them.
Activity is reported at a HIGH LEVEL only — never internal chain-of-thought
(spec §7.10).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TaskState(str, Enum):
    PLANNING = "planning"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    REQUIRES_CONFIRMATION = "requires_confirmation"


@dataclass
class ActivityEvent:
    """A user-facing line of what JARVIS is doing (no hidden reasoning)."""

    label: str          # e.g. "Checking system status"
    tool: str = ""      # the tool that ran
    agent: str = ""     # which specialist owns it
    ok: bool = True
    detail: str = ""    # the tool's human-readable result

    def as_dict(self) -> dict:
        return {"label": self.label, "tool": self.tool, "agent": self.agent, "ok": self.ok, "detail": self.detail}


@dataclass
class AgentSpec:
    """Declarative description of a specialist agent."""

    name: str
    description: str
    capabilities: list[str]
    tool_categories: list[str]  # which tool-registry categories it may use
    permission: str = "safe"

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "capabilities": self.capabilities,
            "tool_categories": self.tool_categories,
            "permission": self.permission,
        }


@dataclass
class AgentResult:
    reply: str
    activity: list[ActivityEvent] = field(default_factory=list)
    state: TaskState = TaskState.COMPLETED
    pending_confirmation: dict | None = None
    model: str = ""

    def as_dict(self) -> dict:
        return {
            "reply": self.reply,
            "activity": [a.as_dict() for a in self.activity],
            "state": self.state.value,
            "pending_confirmation": self.pending_confirmation,
            "model": self.model,
        }
