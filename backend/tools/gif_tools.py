"""GIF tools — let Scout reply with a contextual GIF when the vibe fits.

send_gif(query, reason) searches Tenor and returns a GIF URL that the chat UI
renders inline (as an image). Marked SAFE — it only fetches; nothing writes
state. If TENOR_API_KEY isn't set, the tool returns an honest "GIFs need
setup" message instead of failing.

Scout is instructed (in SYSTEM_PROMPT) to use this when the moment is playful
— celebrations, teasing, empathy, quick reactions — NOT in serious/technical
answers.
"""
from __future__ import annotations

from backend.tools.base import PermissionLevel, Tool, ToolResult


async def _send_gif(query: str, reason: str = "") -> ToolResult:
    from backend.integrations import gif as _gif

    if not _gif.is_configured():
        return ToolResult(
            ok=False,
            summary=(
                "GIFs aren't set up yet — add TENOR_API_KEY to .env "
                "(free Google Cloud key) to enable this."
            ),
            error="not_configured",
        )
    q = (query or "").strip()
    if not q:
        return ToolResult(ok=False, summary="I need a search phrase for the GIF.")
    try:
        gifs = await _gif.search(q, limit=8)
    except Exception as exc:
        return ToolResult(ok=False, summary=f"Tenor search failed: {str(exc)[:120]}", error="tenor")
    if not gifs:
        return ToolResult(ok=True, summary=f"(No GIFs matched '{q}'.)")
    pick = gifs[0]
    url = pick["url"]
    # The summary is what gets fed back to the model — include the URL AND a
    # Markdown image so it appears inline when the model quotes it back.
    # The `data` payload carries the URL for any client that wants to render
    # it separately as a rich attachment.
    return ToolResult(
        ok=True,
        summary=f"![{pick.get('title', 'gif')}]({url})",
        data={"gif_url": url, "query": q, "reason": reason},
    )


def register(registry) -> None:
    registry.register(
        Tool(
            name="send_gif",
            description=(
                "Reply with an animated GIF from Tenor that matches the moment. "
                "Use for casual reactions — celebrating a win, gentle teasing, "
                "empathy, quick 'lol' / 'oh no' / 'nice' vibes. DO NOT use in "
                "serious, technical, sensitive, or error-related replies. Pass "
                "a short search query (e.g. 'celebrate', 'thinking', 'oh no', "
                "'high five') and a one-line reason. Returns Markdown that "
                "renders as an inline animated image in the chat."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Tenor search phrase (2-5 words). Examples: 'celebrate', 'oh no', 'thinking hard', 'high five', 'nice'."},
                    "reason": {"type": "string", "description": "One line — why this GIF fits the moment."},
                },
                "required": ["query"],
            },
            handler=_send_gif,
            permission=PermissionLevel.SAFE,
            category="mac",   # reuse existing routing; category doesn't gate visibility here
        )
    )
