"""Document understanding (spec §14) — upload → extract → chunk → index → retrieve.

Scout ingests PDFs, Word docs, and text/data/code files into a local SQLite store,
chunked and (when Ollama is up) embedded, so the model can retrieve the relevant
passages instead of being handed a whole document. Retrieval degrades to lexical
scoring when embeddings are unavailable, so it works with or without Ollama.

Storage is SQLite-vector, never Chroma — the voice stack needs numpy>=2 while
chromadb pins numpy<2, so they can't share one environment ([[jarvis-requirements-numpy-conflict]]).
"""

from backend.documents import extract, store

__all__ = ["extract", "store"]
