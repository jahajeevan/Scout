"""WEB tools (spec §4/§13/§25) — real search + page extraction for the agent.

Registered under the "web" category, which the Research agent owns. Results are
returned as structured sources (for UI source cards) plus a readable summary the
model uses to synthesize an answer with citations. Never fabricates: an empty
result set is reported honestly (spec §49).
"""

from __future__ import annotations

from backend.tools.base import PermissionLevel, Tool, ToolResult


async def _search_web(query: str) -> ToolResult:
    from backend.integrations import websearch

    results = await websearch.search(query, max_results=6)
    if not results:
        return ToolResult(
            ok=False,
            summary=f"No web results for '{query}' — search may be unavailable right now.",
            data={"query": query, "sources": []},
        )
    lines = [f"[{i + 1}] {r['title']} — {r['url']}\n{r['snippet']}" for i, r in enumerate(results)]
    return ToolResult(
        ok=True,
        summary="Web sources found:\n" + "\n\n".join(lines),
        data={"query": query, "sources": results},
    )


async def _extract_page_content(url: str) -> ToolResult:
    from backend.integrations import websearch

    text = await websearch.fetch_page(url, max_chars=3500)
    if not text:
        return ToolResult(ok=False, summary=f"Couldn't read {url}.", data={"url": url})
    return ToolResult(ok=True, summary=text, data={"url": url, "length": len(text)})


def register(registry) -> None:
    registry.register(
        Tool(
            name="search_web",
            description="Search the web for current information and return sources. Use for news, prices, recent events, or anything that needs up-to-date facts.",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "The search query."}},
                "required": ["query"],
            },
            handler=_search_web,
            permission=PermissionLevel.SAFE,
            category="web",
        )
    )
    registry.register(
        Tool(
            name="extract_page_content",
            description="Fetch a web page and return its readable text, to read a source in depth.",
            parameters={
                "type": "object",
                "properties": {"url": {"type": "string", "description": "The page URL."}},
                "required": ["url"],
            },
            handler=_extract_page_content,
            permission=PermissionLevel.SAFE,
            category="web",
        )
    )
