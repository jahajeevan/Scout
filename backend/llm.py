"""LLM facade over the model catalog + provider registry.

Keeps the historical public surface (``stream_chat``, ``chat``, ``active_model``,
``active_provider``) so ``main.py``/``commands.py`` keep working, and adds an
optional ``model`` argument so a chat turn can target any catalog model the user
picked in the UI (spec §20). Model metadata/selection lives in
``backend/providers`` — this module just routes.
"""

from __future__ import annotations

from typing import AsyncIterator

from backend.config import SYSTEM_PROMPT
from backend.providers import Message, registry


def _conversation(prompt: str, history: list[Message] | None) -> list[Message]:
    messages: list[Message] = list(history) if history else []
    messages.append({"role": "user", "content": prompt})
    return messages


def active_provider() -> str:
    """Endpoint currently serving (e.g. 'zai' or 'nvidia')."""
    return registry.active_name()


def active_model() -> str:
    """Catalog id of the currently-selected model (what the UI shows)."""
    return registry.active_spec().id


def set_provider(name: str, model: str | None = None) -> dict:
    """Back-compat shim: select a catalog model by id."""
    return registry.set_active(model or name)


async def stream_chat(
    prompt: str, history: list[Message] | None = None, model: str | None = None
) -> AsyncIterator[str]:
    """Stream JARVIS's reply from the selected (or given) catalog model."""
    provider, spec = registry.provider_for(model)
    async for chunk in provider.stream(
        _conversation(prompt, history), system=SYSTEM_PROMPT, model=spec.remote_id
    ):
        yield chunk


async def chat(
    prompt: str, history: list[Message] | None = None, model: str | None = None
) -> str:
    """Return the full reply from the selected (or given) catalog model."""
    provider, spec = registry.provider_for(model)
    result = await provider.complete(
        _conversation(prompt, history), system=SYSTEM_PROMPT, model=spec.remote_id
    )
    return result.text
