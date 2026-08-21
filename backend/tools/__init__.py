"""Global tool registry (spec §5, §7.5).

One registry, populated once, shared by the orchestrator and every agent. New
capability groups register themselves here; nothing else changes.
"""

from backend.tools.base import PermissionLevel, Tool, ToolRegistry, ToolResult
from backend.tools import (
    code_tools,
    doc_tools,
    gif_tools,
    mac_tools,
    memory_tools,
    productivity_tools,
    routine_tools,
    system_tools,
    vision_tools,
    web_tools,
)

registry = ToolRegistry()
system_tools.register(registry)
mac_tools.register(registry)
web_tools.register(registry)
memory_tools.register(registry)
doc_tools.register(registry)
code_tools.register(registry)
productivity_tools.register(registry)
routine_tools.register(registry)
vision_tools.register(registry)
gif_tools.register(registry)
# media_tools, vision_tools register here as they land.

__all__ = ["registry", "Tool", "ToolRegistry", "ToolResult", "PermissionLevel"]
