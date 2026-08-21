"""Google Calendar integration (Phase 4) — upcoming events for the HUD.

Reads the account authorized via backend.integrations.google_auth. Synchronous
(googleapiclient); the FastAPI layer runs it on a worker thread.
"""

from __future__ import annotations

import datetime

from backend.integrations.google_auth import build_service


def _format_start(start: str) -> str:
    """ISO start → 'HH:MM' for timed events, 'All day' for date-only events."""
    if len(start) == 10:  # YYYY-MM-DD (all-day)
        return "All day"
    try:
        dt = datetime.datetime.fromisoformat(start)
        return dt.strftime("%H:%M")
    except ValueError:
        return start[11:16] if len(start) >= 16 else start


def get_upcoming(limit: int = 5) -> dict[str, object]:
    """The next `limit` upcoming events on the primary calendar."""
    service = build_service("calendar", "v3")
    if service is None:
        return {"authorized": False, "events": []}

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    resp = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=now,
            singleEvents=True,
            orderBy="startTime",
            maxResults=limit,
        )
        .execute()
    )
    events: list[dict[str, str]] = []
    for e in resp.get("items", []):
        start = e.get("start", {})
        raw = start.get("dateTime", start.get("date", ""))
        events.append({"time": _format_start(raw), "title": e.get("summary", "(busy)")})
    return {"authorized": True, "events": events}
