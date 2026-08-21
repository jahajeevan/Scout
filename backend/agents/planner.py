"""Planner (spec §7 simple-vs-complex routing, §28 decomposition).

Given an objective, the planner decides whether it's a *simple* request (one worker
answers it) or a *complex* one that benefits from decomposition into subtasks across
specialists — and, if complex, returns an explicit dependency-ordered plan.

The plan is produced by the selected model under a strict JSON contract. This is the
one extra model call the multi-agent path spends up front; the streaming chat path
never calls it, so ordinary conversation stays fast and cheap. Any malformed plan
falls back to "simple" so a planner hiccup never blocks the user.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from backend.agents import specialists


@dataclass
class Step:
    id: int
    agent: str
    task: str
    depends_on: list[int] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"id": self.id, "agent": self.agent, "task": self.task, "depends_on": self.depends_on}


@dataclass
class Plan:
    mode: str               # "simple" | "complex"
    steps: list[Step] = field(default_factory=list)
    agent: str = "general"  # for simple mode: which single specialist handles it

    def as_dict(self) -> dict:
        return {"mode": self.mode, "agent": self.agent, "steps": [s.as_dict() for s in self.steps]}


def _planner_system() -> str:
    roster = "\n".join(f"- {c['name']}: {c['description']}" for c in specialists.catalog())
    return (
        "You are Scout's task planner. Decide how to handle the user's objective and reply with "
        "ONLY a JSON object — no prose, no code fences.\n\n"
        "Available specialists:\n" + roster + "\n\n"
        "If the objective is a single ask that one specialist (or plain reasoning) can handle, reply:\n"
        '{\"mode\":\"simple\",\"agent\":\"<specialist name>\"}\n\n'
        "If it genuinely has multiple parts that benefit from decomposition (e.g. research several "
        "things then compare, or gather state then act), reply:\n"
        '{\"mode\":\"complex\",\"steps\":[{\"id\":1,\"agent\":\"research\",\"task\":\"...\",\"depends_on\":[]},'
        '{\"id\":2,\"agent\":\"general\",\"task\":\"compare the findings and recommend\",\"depends_on\":[1]}]}\n\n'
        "Rules: keep it to at most 5 steps; use the fewest steps that do the job (don't invent work); "
        "'agent' must be one of the specialist names above; a step with an empty depends_on can run "
        "immediately; use 'general' for synthesis/reasoning/writing steps. Prefer 'simple' unless "
        "decomposition clearly helps."
    )


_VALID = set(specialists.SPECIALISTS.keys())


def _coerce(raw: dict) -> Plan:
    """Validate a parsed planner object into a Plan; raise on anything unusable."""
    mode = raw.get("mode")
    if mode == "simple":
        agent = raw.get("agent", "general")
        return Plan(mode="simple", agent=agent if agent in _VALID else "general")
    if mode == "complex":
        steps: list[Step] = []
        for s in raw.get("steps", []):
            sid = int(s["id"])
            agent = s.get("agent", "general")
            steps.append(
                Step(
                    id=sid,
                    agent=agent if agent in _VALID else "general",
                    task=str(s.get("task", "")).strip(),
                    depends_on=[int(d) for d in s.get("depends_on", []) if isinstance(d, (int, float))],
                )
            )
        steps = [s for s in steps if s.task][:5]
        if len(steps) <= 1:
            # A one-step "plan" is just a simple request.
            return Plan(mode="simple", agent=steps[0].agent if steps else "general")
        return Plan(mode="complex", steps=steps)
    raise ValueError(f"unknown plan mode {mode!r}")


async def plan(objective: str, *, model: str | None = None) -> Plan:
    """Produce a Plan for the objective. Falls back to a simple plan on any error."""
    from backend.providers import registry as pregistry

    provider, spec = pregistry.provider_for(model)
    try:
        completion = await provider.complete(
            [{"role": "user", "content": objective}],
            system=_planner_system(),
            model=spec.remote_id,
        )
        text = (completion.text or "").strip()
        # Tolerate a stray code fence or leading prose before the JSON object.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            return Plan(mode="simple", agent="general")
        return _coerce(json.loads(text[start : end + 1]))
    except Exception:
        return Plan(mode="simple", agent="general")
