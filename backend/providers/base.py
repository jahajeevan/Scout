"""AIProvider — the single seam between JARVIS and any LLM backend.

Everything above this line (agents, tool router, chat, voice) talks to an
``AIProvider``; everything below it (NVIDIA GLM-5.2, Ollama, Claude) is an
interchangeable implementation. Adding a new brain means adding one file here
and registering it — no call sites change (spec §2, §21).

Two verbs cover how JARVIS actually uses a model:

* ``stream()``   — yield text chunks as they arrive. Used for conversation and
  voice, where perceived latency is everything.
* ``complete()`` — return the whole answer at once, including any structured
  ``tool_calls``. Used by the agent/tool router, which needs the full decision
  before it can act.

Messages use the OpenAI chat shape (``{"role", "content"}``). ``content`` may be
a plain string or a list of content blocks (text + ``image_url``) so the very
same interface carries vision (spec §7/§8) without a second code path.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

# {"role": "user"|"assistant"|"system"|"tool", "content": str | list[block]}
Message = dict[str, Any]


@dataclass
class ToolCall:
    """A single tool the model asked JARVIS to run (already JSON-parsed)."""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class Completion:
    """The full result of a non-streaming turn."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    model: str = ""
    usage: dict[str, int] = field(default_factory=dict)
    finish_reason: str = ""


class AIProvider(ABC):
    """Contract every LLM backend implements. Stateless per call."""

    #: Stable identifier used in config and the /provider toggle.
    name: str = "base"

    @abstractmethod
    def model(self) -> str:
        """The concrete model id this instance will call."""

    @property
    def available(self) -> bool:
        """True when this provider is usable right now (e.g. key present).

        The registry uses this to fall back safely instead of hard-failing a
        turn — a misconfigured provider should never take JARVIS offline.
        """
        return True

    @property
    def supports_tools(self) -> bool:
        return False

    @property
    def supports_vision(self) -> bool:
        return False

    @abstractmethod
    def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream the reply text chunk-by-chunk. (async generator)

        ``model`` selects among the models this endpoint hosts; None uses the
        instance default.
        """
        raise NotImplementedError

    @abstractmethod
    async def complete(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> Completion:
        """Return the full reply, including any tool calls, in one shot."""
        raise NotImplementedError
