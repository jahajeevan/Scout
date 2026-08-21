"""Short-term memory: in-context conversation store.

Per the spec this is simply the last N turns held in Python (no database). It
backs the ``context_window`` config value so the LLM sees recent dialogue. A
"turn" here is one message with a role of ``user`` or ``assistant``; the window
counts messages, and we keep the most recent ``2 * context_window`` messages so
that roughly ``context_window`` full user+assistant exchanges survive.
"""

from __future__ import annotations

from collections import deque
from typing import Deque

from backend.config import CONTEXT_WINDOW

Message = dict[str, str]


class ShortTermMemory:
    """A bounded rolling buffer of recent conversation turns."""

    def __init__(self, context_window: int = CONTEXT_WINDOW) -> None:
        # Keep user+assistant pairs, so allow twice the configured turn count.
        self._messages: Deque[Message] = deque(maxlen=context_window * 2)

    def add_user(self, content: str) -> None:
        self._messages.append({"role": "user", "content": content})

    def add_assistant(self, content: str) -> None:
        self._messages.append({"role": "assistant", "content": content})

    def history(self) -> list[Message]:
        """Return the recent turns as a plain list (safe copy)."""
        return list(self._messages)

    def clear(self) -> None:
        self._messages.clear()
