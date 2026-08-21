"""JARVIS Orchestrator (spec §7.1) — the coordinator that turns talk into action.

It runs the selected model in a tool-calling loop over the shared tool registry
(Phase B), executing each tool through the permission gate, and returns one
coherent answer plus a high-level activity log. Simple requests that need no
tools come back in a single model call (same latency as chat); requests that
need real state or an action drive the tools automatically.

Design guarantees:
* No unrestricted access — every action goes through ``tools.registry.execute``.
* CONFIRMATION_REQUIRED tools are NOT executed silently; they surface as a
  pending confirmation (spec §6, §7.12).
* Activity is high-level only — never hidden reasoning (spec §7.10).
* Never fabricates: tool results are real, and a failed tool is reported.
"""

from __future__ import annotations

import asyncio
import json
from typing import Awaitable, Callable

from backend.config import SYSTEM_PROMPT
from backend.agents.base import ActivityEvent, AgentResult, TaskState
from backend.agents import planner, registry as agents, specialists

_MAX_STEPS = 8  # room to explore a project AND act before the loop ends

# Tools that actually change something — used to summarise when the model returns
# no final text (reasoning models sometimes end with an empty content field).
_WRITE_TOOLS = {"write_file", "edit_file", "rename_path", "delete_path", "run_command", "git_commit", "remember", "forget"}


def _transient(exc: Exception) -> bool:
    """A provider hiccup worth one retry (rate limit / overload / timeout)."""
    s = str(exc).lower()
    return "503" in s or "429" in s or "timeout" in s or "resourceexhausted" in s


def _finalize(text: str | None, activity: list[ActivityEvent]) -> str:
    """Never hand back an empty answer — synthesise one from what actually happened."""
    t = (text or "").strip()
    if t:
        return t
    done = [a.detail for a in activity if a.ok and a.tool in _WRITE_TOOLS and a.detail]
    if done:
        return "Done:\n" + "\n".join(f"- {d}" for d in done)
    if any(a.ok for a in activity):
        return "I looked into that but didn't make a change. Try rephrasing, switch to Auto mode, or pick another model."
    return "The model returned no response for that. Try again, or choose a different model."

_SYSTEM = (
    SYSTEM_PROMPT
    + "\n\nYou can call tools to search the web, read machine state, and control the Mac. "
    "Call a tool ONLY when the request needs current/live information (news, prices, recent "
    "events), real system state, or a real action; otherwise answer directly. When you use "
    "web sources, synthesise a clear answer and cite them. Never invent tool results or claim "
    "you did something you didn't."
)

# tool category -> owning specialist (for activity attribution)
_CATEGORY_AGENT = {"system": "system", "apps": "mac", "mac": "mac", "vision": "vision", "web": "research", "memory": "memory", "documents": "documents", "code": "code", "productivity": "productivity"}

# friendly activity labels for known tools; fallback derives from the name
_LABELS = {
    "get_system_info": "Checking system status",
    "get_cpu_usage": "Checking CPU",
    "get_memory_usage": "Checking memory",
    "get_battery_status": "Checking battery",
    "get_network_status": "Checking network",
    "get_current_time": "Checking the time",
    "open_app": "Opening an application",
    "close_app": "Closing an application",
    "switch_app": "Switching applications",
    "list_running_apps": "Listing running apps",
    "take_screenshot": "Capturing the screen",
    "control_volume": "Adjusting volume",
    "control_brightness": "Adjusting brightness",
    "lock_screen": "Locking the screen",
    "sleep_mac": "Putting the Mac to sleep",
    "search_web": "Searching the web",
    "extract_page_content": "Reading a source",
    "search_documents": "Searching your documents",
    "list_documents": "Checking your documents",
    "list_directory": "Listing files",
    "read_file": "Reading a file",
    "search_code": "Searching the code",
    "write_file": "Writing a file",
    "edit_file": "Editing a file",
    "rename_path": "Renaming a file",
    "delete_path": "Deleting a file",
    "git_status": "Checking git status",
    "git_diff": "Reviewing changes",
    "run_command": "Running a command",
    "git_commit": "Committing changes",
    "check_email": "Checking your email",
    "send_email": "Sending an email",
    "list_calendar": "Checking your calendar",
    "add_reminder": "Adding a reminder",
    "list_reminders": "Checking your reminders",
    "complete_reminder": "Updating a reminder",
    "create_routine": "Setting up a routine",
    "list_routines": "Checking your routines",
    "delete_routine": "Removing a routine",
    "see_screen": "Looking at your screen",
    "remember": "Updating memory",
    "forget": "Updating memory",
    "list_memories": "Recalling memory",
}


async def _system_with_memory() -> str:
    """Base system prompt plus the user's current memories (spec §46)."""
    from backend.memory import personal

    block = await personal.context_block()
    return f"{_SYSTEM}\n\n{block}" if block else _SYSTEM


def _label(tool_name: str) -> str:
    return _LABELS.get(tool_name, "Working: " + tool_name.replace("_", " "))


def _assistant_tool_msg(text: str, calls: list) -> dict:
    return {
        "role": "assistant",
        "content": text or "",
        "tool_calls": [
            {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
            for tc in calls
        ],
    }


_WEB_MANDATE = (
    "\n\nThe user has explicitly enabled Web Search for THIS message. You MUST call "
    "the search_web tool with a focused query before answering, then base your answer "
    "on those results and cite the sources. Do not answer from prior knowledge alone."
)


async def run_stream(
    objective: str,
    *,
    history: list[dict] | None = None,
    model: str | None = None,
    force_web: bool = False,
    on_text: Callable[[str], Awaitable[None]],
    on_activity: Callable[[ActivityEvent], Awaitable[None]] | None = None,
    on_sources: Callable[[list], Awaitable[None]] | None = None,
    on_memory: Callable[[str], Awaitable[None]] | None = None,
    on_confirm: Callable[[dict], Awaitable[None]] | None = None,
    auto_confirm: set[str] | None = None,
) -> str:
    """Agentic streaming for the chat: stream tokens live while calling tools in
    the same turn (spec §19). Returns the full final text. Tools are only offered
    to models that actually support them (spec §28).

    ``on_confirm`` — when a tool needs the user's explicit consent (e.g. send_email),
    the turn stops and this is called with the pending action so the UI can offer
    Confirm/Cancel; the caller re-runs the tool with confirm=True on approval.

    ``force_web`` is the composer's Web Search toggle (spec §12): when set (and the
    model supports tools) Scout is instructed to search the web before answering.
    """
    from backend.providers import registry as pregistry
    from backend.tools import registry as tools

    provider, spec = pregistry.provider_for(model)
    supports_tools = "tools" in spec.capabilities
    schemas = tools.schemas() if supports_tools else None
    system = await _system_with_memory()
    if force_web and supports_tools:
        system += _WEB_MANDATE

    messages: list[dict] = list(history or []) + [{"role": "user", "content": objective}]
    full: list[str] = []

    for _ in range(_MAX_STEPS):
        round_text: list[str] = []
        calls = None
        async for ev in provider.stream_events(messages, system=system, tools=schemas, model=spec.remote_id):
            if ev["type"] == "text":
                round_text.append(ev["text"])
                full.append(ev["text"])
                await on_text(ev["text"])
            elif ev["type"] == "tool_calls":
                calls = ev["calls"]
        if not calls:
            return "".join(full)

        messages.append(_assistant_tool_msg("".join(round_text), calls))
        for tc in calls:
            confirm = bool(auto_confirm and tc.name in auto_confirm)
            result = await tools.execute(tc.name, tc.arguments, confirm=confirm)
            tool = tools.get(tc.name)
            agent = _CATEGORY_AGENT.get(tool.category, "") if tool else ""
            if on_activity:
                await on_activity(ActivityEvent(label=_label(tc.name), tool=tc.name, agent=agent, ok=result.ok, detail=result.summary))
            if tc.name == "search_web" and on_sources and result.data.get("sources"):
                await on_sources(result.data["sources"])
            if tc.name in ("remember", "forget") and on_memory and result.ok:
                await on_memory(result.summary)
            if result.needs_confirmation:
                # Stop and hand the pending action to the UI for an explicit yes/no
                # (spec §19/§42) — this is the only way a confirm-gated tool runs.
                if on_confirm is not None:
                    await on_confirm({"tool": tc.name, "args": tc.arguments, "prompt": result.summary})
                    return "".join(full)
                content = (
                    f"ACTION NOT PERFORMED. '{tc.name}' needs the user's explicit confirmation. "
                    "Tell the user you're ready and ask them to confirm — do NOT say it's done."
                )
            else:
                content = result.summary
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})

    # Ran out of tool rounds — one final streamed answer, no tools.
    async for ev in provider.stream_events(messages, system=system, model=spec.remote_id):
        if ev["type"] == "text":
            full.append(ev["text"])
            await on_text(ev["text"])
    return "".join(full)


async def _agent_loop(
    user_content: str,
    *,
    categories: list[str] | None,
    system: str,
    model: str | None,
    provider,
    spec,
    agent_label: str,
    on_event: Callable[[ActivityEvent], None] | None,
    auto_confirm: set[str] | None = None,
    history: list[dict] | None = None,
) -> tuple[str, list[ActivityEvent], dict | None]:
    """One worker's bounded tool-loop over its allowed tool categories.

    This is the shared engine both the simple path and every step of the complex
    path run on — the only route to the machine is still ``tools.execute`` (the
    permission gate holds). ``auto_confirm`` is the set of tool names the caller has
    pre-authorised (Code mode AUTO/BYPASS) so their CONFIRMATION_REQUIRED writes run
    without a round-trip; anything not in the set still surfaces as pending.
    Returns (text, activity, pending_confirmation).
    """
    from backend.tools import registry as tools

    supports_tools = "tools" in spec.capabilities
    schemas = tools.schemas(categories) if supports_tools else None
    # Prepend prior conversation so replies like "yes proceed" have context.
    prior: list[dict] = [m for m in (history or []) if m.get("role") in ("user", "assistant") and m.get("content")]
    messages: list[dict] = list(prior) + [{"role": "user", "content": user_content}]
    activity: list[ActivityEvent] = []
    pending: dict | None = None

    for _ in range(_MAX_STEPS):
        completion = await provider.complete(messages, system=system, tools=schemas, model=spec.remote_id)
        if not completion.tool_calls:
            return _finalize(completion.text, activity), activity, pending

        messages.append(_assistant_tool_msg(completion.text or "", completion.tool_calls))
        for tc in completion.tool_calls:
            confirm = bool(auto_confirm and tc.name in auto_confirm)
            result = await tools.execute(tc.name, tc.arguments, confirm=confirm)
            tool = tools.get(tc.name)
            agent = agent_label or (_CATEGORY_AGENT.get(tool.category, "") if tool else "")
            if result.needs_confirmation:
                pending = {"tool": tc.name, "args": tc.arguments, "prompt": result.summary}
                activity.append(
                    ActivityEvent(label=f"Awaiting confirmation: {_label(tc.name)}", tool=tc.name, agent=agent, ok=False, detail=result.summary)
                )
                content = (
                    f"ACTION NOT PERFORMED. '{tc.name}' needs the user's explicit confirmation "
                    "before it can run. Tell the user you're ready and ask them to confirm — "
                    "do NOT say it is done."
                )
            else:
                activity.append(ActivityEvent(label=_label(tc.name), tool=tc.name, agent=agent, ok=result.ok, detail=result.summary))
                content = result.summary
            if on_event:
                on_event(activity[-1])
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})

    # Ran out of tool steps — force a final answer with no tools.
    final = await provider.complete(messages, system=system, model=spec.remote_id)
    return _finalize(final.text, activity), activity, pending


async def run(
    objective: str,
    *,
    model: str | None = None,
    agent_names: list[str] | None = None,
    on_event: Callable[[ActivityEvent], None] | None = None,
    auto_confirm: set[str] | None = None,
    history: list[dict] | None = None,
) -> AgentResult:
    """Coordinate specialists to fulfil ``objective`` and return one coherent result.

    Routing (spec §7 simple-vs-complex, §28 decomposition):
    * ``agent_names`` given → run one scoped loop over those agents' tools (legacy).
    * else the planner decides: a *simple* objective runs on a single specialist;
      a *complex* one is decomposed into steps that run across specialists (parallel
      where independent) and then synthesised into one answer.
    """
    from backend.providers import registry as pregistry

    provider, spec = pregistry.provider_for(model)
    base_system = await _system_with_memory()

    # Explicit scoping keeps the old /agent {agents:[...]} contract working.
    if agent_names:
        text, activity, pending = await _agent_loop(
            objective, categories=agents.categories_for(agent_names), system=base_system,
            model=model, provider=provider, spec=spec, agent_label="", on_event=on_event,
            auto_confirm=auto_confirm, history=history,
        )
        return AgentResult(
            reply=text, activity=activity,
            state=TaskState.REQUIRES_CONFIRMATION if pending else TaskState.COMPLETED,
            pending_confirmation=pending, model=spec.id,
        )

    plan = await planner.plan(objective, model=model)

    if plan.mode == "simple":
        sp = specialists.get(plan.agent)
        text, activity, pending = await _agent_loop(
            objective, categories=sp.categories, system=base_system,
            model=model, provider=provider, spec=spec,
            agent_label=(sp.name if sp.name != "general" else ""), on_event=on_event,
            auto_confirm=auto_confirm,
        )
        return AgentResult(
            reply=text, activity=activity,
            state=TaskState.REQUIRES_CONFIRMATION if pending else TaskState.COMPLETED,
            pending_confirmation=pending, model=spec.id,
        )

    return await _run_complex(objective, plan, model=model, provider=provider, spec=spec, base_system=base_system, on_event=on_event, auto_confirm=auto_confirm)


async def _run_complex(objective, plan, *, model, provider, spec, base_system, on_event, auto_confirm=None) -> AgentResult:
    """Execute a multi-step plan: dependency-ordered waves, parallel where possible,
    then a single synthesis pass in Scout's voice (spec §28 structured hand-off)."""
    activity: list[ActivityEvent] = [
        ActivityEvent(label=f"Planning — {len(plan.steps)} steps", tool="", agent="planner", ok=True)
    ]
    if on_event:
        on_event(activity[0])

    results: dict[int, str] = {}
    pending: dict | None = None
    remaining = {s.id: s for s in plan.steps}

    async def _run_step(step):
        sp = specialists.get(step.agent)
        ctx = "\n\n".join(f"[Result of step {d}]\n{results.get(d, '')}" for d in step.depends_on if d in results)
        user_content = step.task if not ctx else f"{step.task}\n\nContext from earlier steps:\n{ctx}"
        # A single specialist failing (e.g. a transient provider 503) must not sink
        # the whole objective — retry once on a transient error, then degrade honestly.
        for attempt in range(2):
            try:
                text, act, pend = await _agent_loop(
                    user_content, categories=sp.categories, system=sp.system,
                    model=model, provider=provider, spec=spec, agent_label=step.agent, on_event=on_event,
                    auto_confirm=auto_confirm,
                )
                return step.id, text, act, pend
            except Exception as exc:
                if attempt == 0 and _transient(exc):
                    await asyncio.sleep(1.5)
                    continue
                ev = ActivityEvent(label=f"The {step.agent} step couldn't complete", tool="", agent=step.agent, ok=False, detail=str(exc)[:160])
                if on_event:
                    on_event(ev)
                return step.id, f"(This step could not complete: {str(exc)[:160]})", [ev], None

    while remaining:
        ready = [s for s in remaining.values() if all(d in results for d in s.depends_on)]
        if not ready:  # unsatisfiable/cyclic deps — run the rest, don't deadlock
            ready = list(remaining.values())
        wave = await asyncio.gather(*[_run_step(s) for s in ready])
        for sid, text, act, pend in wave:
            results[sid] = text
            activity.extend(act)
            if pend and not pending:
                pending = pend
            remaining.pop(sid, None)

    synth_context = "\n\n".join(
        f"[Step {s.id} · {s.agent}] {s.task}\nResult: {results.get(s.id, '')}" for s in plan.steps
    )
    synth = [
        {
            "role": "user",
            "content": (
                f"Objective: {objective}\n\n"
                f"You coordinated specialists who produced these results:\n\n{synth_context}\n\n"
                "Write the final, coherent answer for the user from these results. Cite source URLs "
                "if a research step provided them. Do not mention the internal steps or agents."
            ),
        }
    ]
    try:
        final = await provider.complete(synth, system=base_system, model=spec.remote_id)
        reply = final.text or ""
        activity.append(ActivityEvent(label="Composing the answer", tool="", agent="", ok=True))
    except Exception as exc:
        # Synthesis failed — don't lose the work; hand back the step results plainly.
        reply = "I gathered these results but couldn't compose the summary:\n\n" + synth_context
        activity.append(ActivityEvent(label="Couldn't compose the final answer", tool="", agent="", ok=False, detail=str(exc)[:160]))
    return AgentResult(
        reply=reply,
        activity=activity,
        state=TaskState.REQUIRES_CONFIRMATION if pending else TaskState.COMPLETED,
        pending_confirmation=pending,
        model=spec.id,
    )
