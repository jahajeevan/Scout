"""Document store + retrieval (spec §14) — SQLite-vector, Ollama-optional.

On upload a file is extracted, split into overlapping chunks, and (if Ollama is
reachable) embedded; chunks + embeddings live in ``config/scout_documents.db``.
Retrieval embeds the query and ranks by cosine similarity; when embeddings aren't
available for the query or a chunk, it falls back to lexical term-overlap scoring,
so document Q&A works with or without Ollama running.

Every returned chunk carries its filename and page, so answers can cite exactly
where a fact came from (spec §14 provenance).
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from dataclasses import dataclass

import httpx

from backend.config import EMBED_MODEL, OLLAMA_HOST, ROOT_DIR

_DB_PATH = ROOT_DIR / "config" / "scout_documents.db"
_TIMEOUT = httpx.Timeout(15.0)

_CHUNK_CHARS = 900
_CHUNK_OVERLAP = 150
_WORD_RE = re.compile(r"[a-z0-9]+")


@dataclass
class Retrieved:
    text: str
    filename: str
    page: int | None
    score: float

    def as_dict(self) -> dict:
        return {"text": self.text, "filename": self.filename, "page": self.page, "score": round(self.score, 3)}


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents ("
        "id TEXT PRIMARY KEY, filename TEXT, mime TEXT, pages INTEGER, chunks INTEGER, "
        "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS doc_chunks ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, filename TEXT, chunk_index INTEGER, "
        "page INTEGER, text TEXT NOT NULL, embedding TEXT)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_id)")
    conn.commit()
    return conn


_DB = _conn()


def _chunk(text: str) -> list[str]:
    """Split text into ~900-char chunks with overlap, preferring whitespace breaks."""
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= _CHUNK_CHARS:
        return [text] if text else []
    chunks: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        end = min(i + _CHUNK_CHARS, n)
        if end < n:
            brk = text.rfind(" ", i + _CHUNK_CHARS - _CHUNK_OVERLAP, end)
            if brk > i:
                end = brk
        chunk = text[i:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= n:
            break
        i = max(end - _CHUNK_OVERLAP, i + 1)
    return chunks


async def _embed(text: str) -> list[float] | None:
    """Embed text via local Ollama; None if Ollama is unavailable (graceful)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={"model": EMBED_MODEL, "prompt": text})
            resp.raise_for_status()
            emb = resp.json().get("embedding")
            return emb if emb else None
    except Exception:
        return None


async def add(filename: str, mime: str, data: bytes) -> dict:
    """Extract, chunk, embed, and store a document. Returns a summary dict.

    Raises ``documents.extract.ExtractError`` if the file can't be read as text.
    """
    from backend.documents.extract import extract

    segments = extract(filename, data)  # may raise ExtractError
    doc_id = uuid.uuid4().hex
    pages = max((s.page or 0) for s in segments) or None

    rows: list[tuple] = []
    idx = 0
    for seg in segments:
        for chunk in _chunk(seg.text):
            emb = await _embed(chunk)
            rows.append((doc_id, filename, idx, seg.page, chunk, json.dumps(emb) if emb else None))
            idx += 1

    if not rows:
        from backend.documents.extract import ExtractError

        raise ExtractError("No text could be indexed from this file.")

    _DB.execute(
        "INSERT INTO documents (id, filename, mime, pages, chunks) VALUES (?, ?, ?, ?, ?)",
        (doc_id, filename, mime, pages, len(rows)),
    )
    _DB.executemany(
        "INSERT INTO doc_chunks (doc_id, filename, chunk_index, page, text, embedding) VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    _DB.commit()
    embedded = any(r[5] for r in rows)
    return {"doc_id": doc_id, "filename": filename, "pages": pages, "chunks": len(rows), "embedded": embedded}


def _cosine(a: list[float], b: list[float]) -> float:
    import numpy as np

    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(va) * np.linalg.norm(vb)) + 1e-9
    return float(np.dot(va, vb) / denom)


def _lexical(query_terms: set[str], text: str) -> float:
    """Term-overlap score in [0,1] — the fallback when embeddings are absent."""
    if not query_terms:
        return 0.0
    words = set(_WORD_RE.findall(text.lower()))
    if not words:
        return 0.0
    return len(query_terms & words) / len(query_terms)


async def search(query: str, k: int = 5, doc_id: str | None = None, min_score: float = 0.05) -> list[Retrieved]:
    """Return the k chunks most relevant to the query, with filename/page citations."""
    query = (query or "").strip()
    if not query:
        return []
    sql = "SELECT filename, page, text, embedding FROM doc_chunks"
    params: tuple = ()
    if doc_id:
        sql += " WHERE doc_id = ?"
        params = (doc_id,)
    rows = _DB.execute(sql, params).fetchall()
    if not rows:
        return []

    qv = await _embed(query)
    q_terms = set(_WORD_RE.findall(query.lower()))
    scored: list[Retrieved] = []
    for filename, page, text, emb_json in rows:
        score = 0.0
        if qv is not None and emb_json:
            score = _cosine(qv, json.loads(emb_json))
        else:
            score = _lexical(q_terms, text)
        if score >= min_score:
            scored.append(Retrieved(text=text, filename=filename, page=page, score=score))
    scored.sort(key=lambda r: r.score, reverse=True)
    return scored[:k]


def list_documents() -> list[dict]:
    rows = _DB.execute(
        "SELECT id, filename, mime, pages, chunks, created_at FROM documents ORDER BY created_at DESC"
    ).fetchall()
    return [
        {"id": r[0], "filename": r[1], "mime": r[2], "pages": r[3], "chunks": r[4], "created_at": r[5]}
        for r in rows
    ]


def delete(doc_id: str) -> bool:
    cur = _DB.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    _DB.execute("DELETE FROM doc_chunks WHERE doc_id = ?", (doc_id,))
    _DB.commit()
    return cur.rowcount > 0


def count() -> int:
    return int(_DB.execute("SELECT COUNT(*) FROM documents").fetchone()[0])
