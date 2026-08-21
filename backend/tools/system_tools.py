"""SYSTEM tools — read-only machine state (all SAFE). Spec §5 SYSTEM group.

Reuses the same psutil/ioreg readings the HUD already trusts.
"""

from __future__ import annotations

import time
from datetime import datetime

import psutil

from backend.tools.base import PermissionLevel, Tool, ToolResult


def _get_system_info() -> ToolResult:
    from backend.main import get_system_stats  # reuse the HUD's exact readings

    stats = get_system_stats()
    return ToolResult(
        ok=True,
        summary=(
            f"CPU {stats['cpu']:.0f}%, RAM {stats['ram']:.0f}%, "
            f"GPU {stats['gpu']:.0f}%, battery {stats['battery']:.0f}%."
        ),
        data=stats,
    )


def _get_cpu_usage() -> ToolResult:
    pct = float(psutil.cpu_percent(interval=0.3))
    return ToolResult(ok=True, summary=f"CPU is at {pct:.0f}%.", data={"cpu": pct})


def _get_memory_usage() -> ToolResult:
    vm = psutil.virtual_memory()
    return ToolResult(
        ok=True,
        summary=f"Memory is at {vm.percent:.0f}% ({vm.used // 2**20} MB used).",
        data={"percent": vm.percent, "used_mb": vm.used // 2**20, "total_mb": vm.total // 2**20},
    )


def _get_battery_status() -> ToolResult:
    batt = psutil.sensors_battery()
    if batt is None:
        return ToolResult(ok=True, summary="No battery detected (desktop or unavailable).", data={"present": False})
    plugged = "charging" if batt.power_plugged else "on battery"
    return ToolResult(
        ok=True,
        summary=f"Battery at {batt.percent:.0f}%, {plugged}.",
        data={"present": True, "percent": batt.percent, "plugged": batt.power_plugged},
    )


def _get_network_status() -> ToolResult:
    stats = psutil.net_if_stats()
    up = [name for name, s in stats.items() if s.isup and name != "lo0"]
    online = len(up) > 0
    return ToolResult(
        ok=True,
        summary="Network is connected." if online else "Network appears offline.",
        data={"online": online, "interfaces_up": up},
    )


def _get_current_time() -> ToolResult:
    now = datetime.now()
    return ToolResult(
        ok=True,
        summary=now.strftime("It's %A, %B %-d, %Y at %-I:%M %p."),
        data={"iso": now.isoformat(), "epoch": time.time()},
    )


def register(registry) -> None:
    no_args = {"type": "object", "properties": {}, "required": []}
    for name, desc, handler in [
        ("get_system_info", "Get a snapshot of CPU, RAM, GPU and battery.", _get_system_info),
        ("get_cpu_usage", "Get current CPU utilization percentage.", _get_cpu_usage),
        ("get_memory_usage", "Get current RAM usage.", _get_memory_usage),
        ("get_battery_status", "Get battery charge level and charging state.", _get_battery_status),
        ("get_network_status", "Check whether the machine is online.", _get_network_status),
        ("get_current_time", "Get the current local date and time.", _get_current_time),
    ]:
        registry.register(
            Tool(
                name=name,
                description=desc,
                parameters=no_args,
                handler=handler,
                permission=PermissionLevel.SAFE,
                category="system",
            )
        )
