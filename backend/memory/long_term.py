"""Long-term memory (Phase 5) — SQLite + local embeddings.

The spec called for ChromaDB, but chromadb 0.5.3 pins numpy<2 while the voice
stack (kokoro-onnx) needs numpy>=2 — they can't share one environment. So this
uses SQLite (stdlib) for storage and Ollama's local embedding model for the
vectors: fully local, no dependency conflict, and light enough that a linear
cosine scan is plenty for a personal assistant's memory.

Facts are embedded on write; recall embeds the query and returns the closest
stored facts by cosine similarity. Cross-session (the DB file persists).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import httpx
import numpy as np

from backend.config import EMBED_MODEL, OLLAMA_HOST

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "jarvis_memory.db"
_TIMEOUT = httpx.Timeout(15.0)


class LongTermMemory:
    """Persistent, embedding-backed fact store."""

    def __init__(self, db_path: Path = _DB_PATH) -> None:
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS memories ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "text TEXT NOT NULL, "
            "embedding TEXT NOT NULL, "
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        self._conn.commit()

    async def _embed(self, text: str) -> list[float] | None:
        """Embed text via the local Ollama embedding model (None on failure)."""
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    f"{OLLAMA_HOST}/api/embeddings",
                    json={"model": EMBED_MODEL, "prompt": text},
                )
                resp.raise_for_status()
                emb = resp.json().get("embedding")
                return emb if emb else None
        except Exception:
            return None

    async def add(self, text: str) -> bool:
        """Store a fact. Returns False if it couldn't be embedded."""
        text = text.strip()
        if not text:
            return False
        emb = await self._embed(text)
        if emb is None:
            return False
        self._conn.execute(
            "INSERT INTO memories (text, embedding) VALUES (?, ?)",
            (text, json.dumps(emb)),
        )
        self._conn.commit()
        return True

    async def search(self, query: str, k: int = 3, min_score: float = 0.55) -> list[str]:
        """Return up to k stored facts most relevant to the query."""
        rows = self._conn.execute("SELECT text, embedding FROM memories").fetchall()
        if not rows:
            return []
        q = await self._embed(query)
        if q is None:
            return []
        qv = np.asarray(q, dtype=np.float32)
        qn = qv / (np.linalg.norm(qv) + 1e-9)

        scored: list[tuple[float, str]] = []
        for text, emb_json in rows:
            v = np.asarray(json.loads(emb_json), dtype=np.float32)
            score = float(np.dot(qn, v / (np.linalg.norm(v) + 1e-9)))
            if score >= min_score:
                scored.append((score, text))
        scored.sort(key=lambda s: s[0], reverse=True)
        return [text for _score, text in scored[:k]]

    def count(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0])


_instance: LongTermMemory | None = None


def get_memory() -> LongTermMemory:
    """Process-wide singleton."""
    global _instance
    if _instance is None:
        _instance = LongTermMemory()
    return _instance
