"""LLM provider abstraction (spec §1, §2, §21).

The rest of JARVIS imports the interface and the registry from here; it never
imports a concrete provider directly, so brains stay swappable.
"""

from backend.providers.base import AIProvider, Completion, Message, ToolCall
from backend.providers import registry

__all__ = ["AIProvider", "Completion", "Message", "ToolCall", "registry"]
