"""JARVIS multi-agent layer (spec §7).

One orchestrator, a registry of specialist agents, all acting through the shared
tool registry and permission gate.
"""

from backend.agents.base import ActivityEvent, AgentResult, AgentSpec, TaskState
from backend.agents import orchestrator, registry

__all__ = ["ActivityEvent", "AgentResult", "AgentSpec", "TaskState", "orchestrator", "registry"]
