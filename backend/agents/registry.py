"""Agent registry (spec §7.5).

The catalog of specialist agents JARVIS can draw on. Each maps to tool-registry
categories; as new tool groups land (web, productivity, coding), the matching
agent gains real abilities without any orchestrator change. Categories with no
tools yet are declared here so the structure is ready (spec §7.4 extensibility).
"""

from __future__ import annotations

from backend.agents.base import AgentSpec

AGENTS: list[AgentSpec] = [
    AgentSpec(
        name="mac",
        description="Controls macOS: apps, windows, volume, brightness, screenshots, system.",
        capabilities=["open/close apps", "system control", "screenshots"],
        tool_categories=["apps", "mac", "system"],
        permission="confirmation_for_disruptive",
    ),
    AgentSpec(
        name="system",
        description="Reports live machine state — CPU, memory, battery, network, time.",
        capabilities=["diagnostics", "status"],
        tool_categories=["system"],
        permission="safe",
    ),
    AgentSpec(
        name="vision",
        description="Understands the screen and images (screenshot/camera analysis, OCR).",
        capabilities=["screen understanding", "image Q&A"],
        tool_categories=["vision"],
        permission="screen_camera",
    ),
    AgentSpec(
        name="research",
        description="Web research: search, read pages, compare sources, cite. (backend pending)",
        capabilities=["web search", "source comparison"],
        tool_categories=["web"],
        permission="safe",
    ),
    AgentSpec(
        name="productivity",
        description="Reminders, notes, tasks, calendar. (backend pending)",
        capabilities=["reminders", "notes", "calendar"],
        tool_categories=["productivity"],
        permission="user_data",
    ),
    AgentSpec(
        name="memory",
        description="Remembers and recalls user-approved facts and preferences.",
        capabilities=["long-term memory"],
        tool_categories=["memory"],
        permission="user_data",
    ),
    AgentSpec(
        name="documents",
        description="Answers from the user's uploaded documents (PDF/DOCX/text) with citations.",
        capabilities=["document Q&A", "retrieval"],
        tool_categories=["documents"],
        permission="user_data",
    ),
    AgentSpec(
        name="code",
        description="Reads/searches/writes code in the connected workspace; inspects git.",
        capabilities=["read/write files", "search", "git"],
        tool_categories=["code"],
        permission="confirmation_for_writes",
    ),
]

_BY_NAME = {a.name: a for a in AGENTS}


def get(name: str) -> AgentSpec | None:
    return _BY_NAME.get(name)


def all_specs() -> list[AgentSpec]:
    return list(AGENTS)


def categories_for(agent_names: list[str] | None) -> list[str] | None:
    """Union of tool categories for the given agents (None = all tools)."""
    if not agent_names:
        return None
    cats: list[str] = []
    for name in agent_names:
        spec = _BY_NAME.get(name)
        if spec:
            for c in spec.tool_categories:
                if c not in cats:
                    cats.append(c)
    return cats or None
