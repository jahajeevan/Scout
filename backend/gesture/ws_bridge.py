"""WebSocket gesture broadcaster (Phase 3).

Runs a small WebSocket server on ``gesture_ws_port`` (from config/jarvis.json) and
broadcasts gesture events to every connected frontend client. The hand tracker
(tracker.py) runs the camera loop on a worker thread and pushes events here via
``broadcast_threadsafe``.

Event shape sent to clients:  {"gesture": "<name>" | null, "hands": <int>}

Runs in the isolated ``.venv-gesture`` environment (mediapipe needs numpy<2, which
conflicts with the main venv's numpy>=2 — see the requirements note).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import websockets
from websockets.server import WebSocketServerProtocol

from backend.config import GESTURE_WS_PORT


class GestureBridge:
    """Broadcasts gesture events to all connected WebSocket clients."""

    def __init__(self, host: str = "0.0.0.0", port: int = GESTURE_WS_PORT) -> None:
        self.host = host
        self.port = port
        self._clients: set[WebSocketServerProtocol] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def _handler(self, ws: WebSocketServerProtocol) -> None:
        """Register a client and keep the connection open (clients only receive)."""
        self._clients.add(ws)
        try:
            async for _ in ws:  # ignore anything the client sends
                pass
        finally:
            self._clients.discard(ws)

    async def start(self) -> None:
        """Start serving. Call from within the asyncio loop."""
        self._loop = asyncio.get_running_loop()
        await websockets.serve(self._handler, self.host, self.port)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        if not self._clients:
            return
        message = json.dumps(payload)
        await asyncio.gather(
            *(client.send(message) for client in list(self._clients)),
            return_exceptions=True,
        )

    def broadcast_threadsafe(self, payload: dict[str, Any]) -> None:
        """Broadcast from a non-async thread (the camera loop)."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(payload), self._loop)
