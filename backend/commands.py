"""Voice/text command routing for Phase 4 integrations.

Given a user utterance (typed or transcribed), detect a built-in command
(email, calendar, Spotify) and execute it, returning JARVIS's reply. Returns
None when nothing matched, so the caller falls through to the LLM for normal
conversation. Keyword-based on purpose — the LLM handles everything else.
"""

from __future__ import annotations

import asyncio
import re


def _has(text: str, *keys: str) -> bool:
    return any(k in text for k in keys)


async def handle_command(text: str) -> str | None:
    low = text.lower().strip().rstrip("?.!")

    # ---- Fast path: simple deterministic Mac actions (open/close/switch app,
    # screenshot) run natively with NO LLM cycle. Complex asks return None and
    # fall through to the agent. (Voice gets a two-phase spoken version in /ws/voice.)
    import asyncio as _asyncio

    from backend.agents import quick_actions as _qa

    _action = _qa.match(text)
    if _action is not None:
        _ok, _msg = await _asyncio.to_thread(_qa.execute, _action)
        return _msg

    # ---- Long-term memory: "remember (that) ..." -------------------------
    if low.startswith("remember"):
        from backend.memory.long_term import get_memory

        fact = re.sub(r"^(?:hey jarvis[, ]*)?remember (?:that )?", "", text.strip(), flags=re.I).strip().rstrip(".")
        if not fact:
            return "Remember what?"
        ok = await get_memory().add(fact)
        return "I'll remember that." if ok else "I couldn't save that to memory."

    # ---- Email ------------------------------------------------------------
    if _has(low, "unread email", "new email", "new mail", "any email", "any new",
            "check my email", "check my mail", "my inbox", "read my email", "emails"):
        from backend.integrations import gmail

        data = await asyncio.to_thread(gmail.get_summary, 3)
        if not data.get("authorized"):
            return "I'm not connected to your email yet."
        unread = int(data.get("unread", 0))
        msgs = data.get("messages", [])
        if unread == 0:
            return "Your inbox is clear — no unread emails."
        latest = "; ".join(f"{m['from']} — {m['subject']}" for m in msgs)
        return f"You have {unread} unread email{'s' if unread != 1 else ''}. The latest: {latest}."

    # ---- Calendar ---------------------------------------------------------
    if _has(low, "my calendar", "my schedule", "my agenda", "upcoming event",
            "next event", "on my calendar", "on my schedule", "what's next", "whats next"):
        from backend.integrations import calendar

        data = await asyncio.to_thread(calendar.get_upcoming, 5)
        if not data.get("authorized"):
            return "I'm not connected to your calendar yet."
        events = data.get("events", [])
        if not events:
            return "Nothing on your calendar coming up."
        listed = "; ".join(f"{e['time']} {e['title']}" for e in events)
        return f"Your upcoming events: {listed}."

    # ---- Spotify: play <something> ---------------------------------------
    match = re.match(r"(?:can you |please )?play (.+)", low)
    if match:
        query = match.group(1).strip()
        from backend.integrations import spotify

        ok = await asyncio.to_thread(spotify.play_search, query)
        return (
            f"Playing {query}."
            if ok
            else "I couldn't start playback — Spotify needs Premium and an active device."
        )

    # ---- Spotify: transport controls -------------------------------------
    if low in ("pause", "pause music", "pause the music", "stop music", "stop the music"):
        from backend.integrations import spotify

        ok = await asyncio.to_thread(spotify.control, "pause")
        return "Paused." if ok else "I couldn't pause."
    if low in ("next", "next song", "next track", "skip", "skip song", "skip this"):
        from backend.integrations import spotify

        ok = await asyncio.to_thread(spotify.control, "next")
        return "Skipping ahead." if ok else "I couldn't skip."
    if low in ("previous", "previous song", "previous track", "go back", "last song"):
        from backend.integrations import spotify

        ok = await asyncio.to_thread(spotify.control, "previous")
        return "Going back." if ok else "I couldn't do that."

    # ---- Spotify: what's playing -----------------------------------------
    if _has(low, "what's playing", "whats playing", "what song", "current song", "now playing"):
        from backend.integrations import spotify

        data = await asyncio.to_thread(spotify.get_now_playing)
        if not data.get("authorized"):
            return "I'm not connected to Spotify yet."
        if not data.get("playing"):
            return "Nothing is playing right now."
        return f"Now playing {data.get('track')} by {data.get('artist')}."

    # ---- Screen / app vision — real capture + vision model (works with ANY chat
    # model, including tool-less vision models). If the user names an app we bring
    # it forward, look, and return focus; otherwise we read the whole screen. This
    # is the fast-path so Scout SEES instead of guessing (spec §24). --------------
    from backend.tools.vision_tools import detect_app

    _app = detect_app(text)
    _vision_verb = _has(
        low, "look at", "look in", "look into", "look inside", "see ", "read ",
        "describe", "scan ", "what am i looking", "what's on", "whats on", "what is on",
        "what's in", "whats in", "what is in", "what do you see", "what can you see",
        "check my", "check the", "show me", "what's open", "whats open", "what is open",
        "what's showing", "whats showing",
    )
    _screen_ref = _has(low, "screen", "display", "my monitor", "this app", "current app",
                       "right now", "currently", "in front of me")
    # Standalone phrases that should always take a look (whole screen).
    _explicit = _has(low, "on my screen", "on the screen", "look at my screen",
                     "read my screen", "describe my screen", "scan my screen", "see my screen",
                     "what am i looking at", "what do you see", "what can you see")
    if _explicit or (_vision_verb and (_app or _screen_ref)):
        from backend.tools.vision_tools import _see_app, _see_screen

        if _app:
            result = await _see_app(_app, text)
        else:
            result = await _see_screen(text)
        return result.summary

    # ---- Phase 7: fan speed / boost (phone IR) ----------------------------
    if "fan" in low and _has(low, "boost"):
        from backend.integrations import phone

        result = await phone.a_press("fan", "boost")
        return "Boosting the fan." if result.get("ok") else f"I couldn't set the fan — {result.get('reason', 'the command failed')}."

    speed = re.search(r"fan speed (?:to )?([1-5])", low) or re.search(r"set (?:the )?fan (?:speed )?to ([1-5])", low)
    if speed:
        from backend.integrations import phone

        n = speed.group(1)
        result = await phone.a_press("fan", f"speed_{n}")
        return f"Fan speed {n}." if result.get("ok") else f"I couldn't set the fan — {result.get('reason', 'the command failed')}."

    # ---- Phase 7: AC temperature + swing (phone IR) -----------------------
    _is_ac = re.search(r"\b(a/?c|air ?condition\w*|air conditioner)\b", low) is not None
    if _is_ac:
        ac_btn = None
        if _has(low, "warmer", "hotter", "increase", "raise", "temp up", "temperature up"):
            ac_btn = ("temp_up", "Raising the AC temperature.")
        elif _has(low, "cooler", "colder", "decrease", "lower", "reduce", "temp down", "temperature down"):
            ac_btn = ("temp_down", "Lowering the AC temperature.")
        elif _has(low, "swing"):
            ac_btn = ("swing", "Toggling the AC swing.")
        if ac_btn:
            from backend.integrations import phone

            result = await phone.a_press("ac", ac_btn[0])
            return ac_btn[1] if result.get("ok") else f"I couldn't reach the AC — {result.get('reason', 'the command failed')}."

    # ---- Phase 6/7: on/off ("turn on the ac / fan / lamp") ----------------
    ha_match = re.match(r"(?:turn|switch) (on|off) (?:the )?(.+)", low)
    if ha_match:
        on = ha_match.group(1) == "on"
        device = ha_match.group(2).strip()

        # Phase 7: room AC/fan go through the phone's IR blaster (over ADB).
        from backend.integrations import phone

        ir_key = phone.match_device(device)
        if ir_key:
            result = await phone.a_power(ir_key, on)
            if result.get("ok"):
                label = "AC" if ir_key == "ac" else device
                if result.get("toggle"):
                    return f"Toggling the {label} power."
                return f"Turning {'on' if on else 'off'} the {label}."
            return f"I couldn't reach the {device} — {result.get('reason', 'the command failed')}."

        # Otherwise fall through to Home Assistant (Phase 6).
        from backend.integrations import home_assistant

        result = await home_assistant.set_by_name(device, on)
        if result.get("ok"):
            return f"Turning {'on' if on else 'off'} the {result.get('name')}."
        reason = result.get("reason")
        if reason == "not connected":
            return "I'm not connected to your smart home yet."
        if reason == "no matching device":
            return f"I couldn't find a device called '{device}'."
        return f"I couldn't do that — {reason or 'the command failed'}."

    return None
