"""Document tools (spec §14) — the model's window into uploaded documents.

``search_documents`` retrieves the passages most relevant to a query, each tagged
with its filename and page so the model can cite provenance. ``list_documents``
tells the model what's available (so "summarise the PDF I uploaded" can find it).
Both are read-only and SAFE — they only read the local document store.
"""

from __future__ import annotations

from backend.tools.base import PermissionLevel, Tool, ToolResult


async def _search_documents(query: str) -> ToolResult:
    from backend.documents import store

    if store.count() == 0:
        return ToolResult(ok=True, summary="No documents have been uploaded yet, sir.", data={"results": []})
    results = await store.search(query, k=5)
    if not results:
        return ToolResult(
            ok=True,
            summary=f"No relevant passages found for '{query}' in the uploaded documents.",
            data={"results": []},
        )
    blocks, sources = [], []
    for r in results:
        cite = r.filename + (f", p.{r.page}" if r.page else "")
        blocks.append(f"[{cite}]\n{r.text}")
        sources.append({"filename": r.filename, "page": r.page})
    summary = "Relevant passages from the uploaded documents:\n\n" + "\n\n".join(blocks)
    return ToolResult(ok=True, summary=summary, data={"results": [r.as_dict() for r in results], "sources": sources})


def _list_documents() -> ToolResult:
    from backend.documents import store

    docs = store.list_documents()
    if not docs:
        return ToolResult(ok=True, summary="No documents have been uploaded yet, sir.", data={"documents": []})
    listed = "; ".join(
        f"{d['filename']}" + (f" ({d['pages']}pp)" if d.get("pages") else "") + f" — {d['chunks']} chunks"
        for d in docs
    )
    return ToolResult(ok=True, summary=f"Uploaded documents: {listed}.", data={"documents": docs})


def register(registry) -> None:
    registry.register(
        Tool(
            name="search_documents",
            description=(
                "Search the user's uploaded documents (PDFs, Word docs, text/data files) for passages "
                "relevant to a query, and get them back with filename/page citations. Use this whenever "
                "the user asks about a document they uploaded, or to ground an answer in their files."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to look for in the documents."}
                },
                "required": ["query"],
            },
            handler=_search_documents,
            permission=PermissionLevel.SAFE,
            category="documents",
        )
    )
    registry.register(
        Tool(
            name="list_documents",
            description="List the documents the user has uploaded (filenames, pages, chunk counts).",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=_list_documents,
            permission=PermissionLevel.SAFE,
            category="documents",
        )
    )
