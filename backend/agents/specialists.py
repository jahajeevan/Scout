"""Specialist agents (spec §27) — focused workers the orchestrator delegates to.

Each specialist is a *functional* agent, not just metadata: it owns a slice of the
tool registry (its ``categories``) and a focused system prompt, and it runs a
bounded tool-loop to complete one subtask. Specialisation improves reliability —
a Research agent that only sees web tools won't try to open an app, and its prompt
keeps it on-task (spec §27: don't make an agent for every tiny thing, but do use
them where focus helps).

Specialists never touch the OS directly: like everything else they act only through
``tools.registry.execute``, so the permission gate still holds (spec §7).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Specialist:
    name: str
    description: str
    categories: list[str] | None  # tool categories it may use; None = all tools
    system: str                   # focused persona/instructions for this worker


# The base line every specialist shares — keeps them honest and non-fabricating.
_BASE = (
    "You are a focused specialist working as part of Scout, a personal AI system. "
    "You are given ONE subtask. Use your tools when the subtask needs live data, "
    "real state, or an action; otherwise answer directly. Never invent tool results "
    "or claim you did something you didn't. Be concise and factual — your output is "
    "handed to a coordinator that will synthesise the final answer for the user."
)

SPECIALISTS: dict[str, Specialist] = {
    "research": Specialist(
        name="research",
        description="Searches the web and reads sources, then reports findings with citations.",
        categories=["web"],
        system=_BASE
        + " You are the Research specialist. Search the web with focused queries, read the "
        "most relevant results, and report concrete facts with their source URLs. If the "
        "search returns nothing usable, say so plainly — do not fabricate sources.",
    ),
    "system": Specialist(
        name="system",
        description="Reports live machine state: CPU, memory, battery, network, time.",
        categories=["system"],
        system=_BASE
        + " You are the System specialist. Read the machine's real state with your tools and "
        "report the concrete numbers.",
    ),
    "mac": Specialist(
        name="mac",
        description="Controls macOS: opens/closes apps, adjusts volume/brightness, sees the screen.",
        categories=["apps", "mac", "system", "vision"],
        system=_BASE
        + " You are the Mac Control specialist. Perform the requested action through your tools. "
        "Disruptive actions require confirmation — if a tool reports it needs confirmation, do "
        "NOT claim the action happened; report that it's ready and awaiting confirmation.",
    ),
    "memory": Specialist(
        name="memory",
        description="Stores and recalls user-approved facts and preferences.",
        categories=["memory"],
        system=_BASE
        + " You are the Memory specialist. Use your tools to remember, recall, or forget "
        "user-approved facts. Never store anything that looks like a secret.",
    ),
    "documents": Specialist(
        name="documents",
        description="Answers questions about the user's uploaded documents (PDF, DOCX, text) with citations.",
        categories=["documents"],
        system=_BASE
        + " You are the Documents specialist. Use search_documents (and list_documents when you need "
        "to know what's available) to find relevant passages, then answer strictly from what they contain, "
        "citing filename and page. If the documents don't cover it, say so — don't fill gaps from memory.",
    ),
    "code": Specialist(
        name="code",
        description="Reads, searches, writes, and edits code in the connected workspace; inspects git.",
        categories=["code"],
        system=_BASE
        + " You are the Code specialist working inside the user's connected project. Before changing "
        "anything, read the relevant files and understand the structure. Make focused, minimal edits "
        "with write_file/edit_file; match the surrounding code style. Use git_status/git_diff to check "
        "your work. If a write needs confirmation and it isn't granted, describe the change instead of "
        "claiming you made it. Never touch anything outside the workspace.",
    ),
    "productivity": Specialist(
        name="productivity",
        description="Email, calendar, and reminders — checks inbox, lists events, manages reminders.",
        categories=["productivity"],
        system=_BASE
        + " You are the Productivity specialist. Use your tools to check email, read the calendar, and "
        "manage reminders. Sending an email requires the user's confirmation — never send without it, and "
        "if a tool reports it needs confirmation, report that rather than claiming it was sent.",
    ),
    "general": Specialist(
        name="general",
        description="General reasoning and writing; can use any tool when needed.",
        categories=None,
        system=_BASE
        + " You are the General specialist. Reason, write, compute, and use any tool the subtask "
        "genuinely needs.",
    ),
}

# Names the planner is allowed to assign (general is always a safe fallback).
ROUTABLE = [s for s in SPECIALISTS if s != "general"]


def get(name: str) -> Specialist:
    """Resolve a specialist by name, falling back to the general worker."""
    return SPECIALISTS.get(name, SPECIALISTS["general"])


def catalog() -> list[dict]:
    """Serializable roster for the planner prompt and the /agents endpoint."""
    return [
        {"name": s.name, "description": s.description, "categories": s.categories or ["*"]}
        for s in SPECIALISTS.values()
    ]
