"""Scout autonomy engine (gen-2) — background daemons + approval queue.

A daemon is a named Python coroutine that runs on a schedule (or by event) and
either takes an action (SAFE) or drops a proposal into the user's approval
inbox (PROPOSE). Everything is auditable: every run is logged, every proposal
carries the exact actions it would take.

- ``engine``     — registry + scheduler tick + runner
- ``proposals``  — SQLite-backed approval queue
- ``daemons``    — the actual daemon implementations
"""

from backend.autonomy import daemons, engine, proposals

__all__ = ["daemons", "engine", "proposals"]
