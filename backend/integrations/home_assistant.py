"""Home Assistant smart-home integration (Phase 6).

Talks to a Home Assistant instance over its REST API using a long-lived access
token. The base URL lives in ``config/jarvis.json`` (``home_assistant_url``); the
token is read only from the ``HOME_ASSISTANT_TOKEN`` environment variable.

Until both are set, every call returns ``{"authorized": False, ...}`` so the HUD
and voice commands degrade gracefully — exactly like the Gmail/Spotify path.

REST API reference:
* ``GET  /api/states``                    → all entity states
* ``POST /api/services/<domain>/<service>`` with ``{"entity_id": ...}`` → act
"""

from __future__ import annotations

import httpx

from backend.config import HOME_ASSISTANT_TOKEN, HOME_ASSISTANT_URL

_TIMEOUT = httpx.Timeout(10.0)

# Domains we expose as simple on/off switchables via voice ("turn on the lamp").
_TOGGLEABLE = ("light", "switch", "fan", "input_boolean", "climate", "cover", "media_player")


def _configured() -> bool:
    return bool(HOME_ASSISTANT_URL) and bool(HOME_ASSISTANT_TOKEN)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {HOME_ASSISTANT_TOKEN}",
        "Content-Type": "application/json",
    }


def _base() -> str:
    return HOME_ASSISTANT_URL.rstrip("/")


async def list_entities() -> dict[str, object]:
    """Return a compact list of controllable entities and their state."""
    if not _configured():
        return {"authorized": False, "entities": []}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{_base()}/api/states", headers=_headers())
            resp.raise_for_status()
            states = resp.json()
    except Exception:
        return {"authorized": False, "entities": []}

    entities = []
    for s in states:
        entity_id = s.get("entity_id", "")
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        if domain not in _TOGGLEABLE:
            continue
        entities.append(
            {
                "entity_id": entity_id,
                "name": s.get("attributes", {}).get("friendly_name", entity_id),
                "state": s.get("state", "unknown"),
                "domain": domain,
            }
        )
    entities.sort(key=lambda e: str(e["name"]).lower())
    return {"authorized": True, "entities": entities}


async def call_service(domain: str, service: str, entity_id: str) -> bool:
    """Call an arbitrary HA service on a single entity. Returns success."""
    if not _configured():
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_base()}/api/services/{domain}/{service}",
                headers=_headers(),
                json={"entity_id": entity_id},
            )
            resp.raise_for_status()
            return True
    except Exception:
        return False


async def set_entity(entity_id: str, on: bool) -> bool:
    """Turn an entity on or off, inferring the domain from its id."""
    domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
    if not domain:
        return False
    service = "turn_on" if on else "turn_off"
    return await call_service(domain, service, entity_id)


async def set_by_name(name: str, on: bool) -> dict[str, object]:
    """Fuzzy-match a spoken name to an entity and toggle it.

    Returns ``{"ok": bool, "name": str|None, "reason": str|None}`` so the voice
    layer can say something specific ("Turning on the desk lamp, sir").
    """
    if not _configured():
        return {"ok": False, "name": None, "reason": "not connected"}
    listing = await list_entities()
    entities = listing.get("entities", [])
    target = (name or "").strip().lower()
    if not target:
        return {"ok": False, "name": None, "reason": "no name given"}

    # Prefer an exact friendly-name match, then a substring match.
    match = next((e for e in entities if str(e["name"]).lower() == target), None)
    if match is None:
        match = next((e for e in entities if target in str(e["name"]).lower()), None)
    if match is None:
        return {"ok": False, "name": None, "reason": "no matching device"}

    ok = await set_entity(str(match["entity_id"]), on)
    return {"ok": ok, "name": match["name"], "reason": None if ok else "command failed"}
