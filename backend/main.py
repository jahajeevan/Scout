"""JARVIS backend — FastAPI entry point (Phase 1).

Endpoints
---------
* ``GET  /health``   — liveness/readiness probe.
* ``GET  /stats``    — real system stats (CPU/RAM/GPU/battery) for the HUD gauges.
* ``POST /chat``     — send text, get JARVIS's full reply as text.
* ``WS   /ws/chat``  — send text, receive the reply streamed token-by-token.

Also provides ``voice_loop()`` which wires STT -> LLM -> TTS into a single async
conversation loop. Run it with::

    python3.11 -m backend.main --voice

so you can say "Hello JARVIS" and hear a spoken reply (Phase 1 done-criteria).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import re
import subprocess
import wave as wavemod
from datetime import datetime, timezone

import numpy as np
import psutil
from fastapi import FastAPI, File, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend import commands, llm
from backend.config import BACKEND_PORT, FRONTEND_PORT, PRODUCT_NAME, USER_NAME
from backend.memory.short_term import ShortTermMemory

app = FastAPI(title=PRODUCT_NAME, version="0.2.0")

# Allow the local Next.js HUD (frontend_port from config) to fetch /stats.
# Ports come only from config/jarvis.json — never hardcoded (spec §5).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{FRONTEND_PORT}",
        f"http://127.0.0.1:{FRONTEND_PORT}",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# A single process-wide conversation memory for the HTTP/WS chat surface.
_memory = ShortTermMemory()


@app.on_event("startup")
async def _warm_voice() -> None:
    """Warm Kokoro TTS in the background so the first voice reply isn't slowed by
    a one-time model load (keeps startup itself non-blocking)."""

    async def _bg() -> None:
        try:
            from backend.voice import stt, tts

            await asyncio.to_thread(tts.preload)
            # Load/download the Whisper model (small.en) up front so the first
            # spoken turn isn't blocked by a one-time model fetch.
            await asyncio.to_thread(stt._get_model)
        except Exception:
            pass

    asyncio.create_task(_bg())


@app.on_event("startup")
async def _start_scheduler() -> None:
    """Run recurring routines AND autonomy daemons when they come due.

    - Routines (spec §31): natural-language prompts on a schedule.
    - Daemons (autonomy gen-2): named Python coroutines with SAFE/PROPOSE gates.

    Both share the 60s tick.
    """

    # Eagerly import autonomy so @daemon decorators register before first tick.
    from backend.autonomy import engine as _autonomy_boot  # noqa: F401

    async def _loop() -> None:
        from backend.agents import orchestrator
        from backend.autonomy import engine as autonomy
        from backend.integrations import routines

        while True:
            try:
                for r in routines.due():
                    try:
                        res = await orchestrator.run(r["prompt"])
                        routines.record(r["id"], res.reply or "(no result)")
                    except Exception as exc:
                        routines.record(r["id"], f"(couldn't run: {str(exc)[:120]})")
            except Exception:
                pass
            try:
                await autonomy.tick()
            except Exception:
                pass
            await asyncio.sleep(60)

    asyncio.create_task(_loop())

# The model voice turns use — prefer Groq's blazing 8B (instant TTS handoff),
# fall back to gpt-oss-20b if GROQ_API_KEY isn't set. Talk should feel snappy
# regardless of which model the user picked for chat.
VOICE_MODEL = "qwen3-groq"
VOICE_MODEL_FALLBACK = "gpt-oss-20b"


async def _augment_with_memory(message: str) -> str:
    """Prepend relevant long-term memories to the prompt (Phase 5 recall).

    The original message is still what gets stored in short-term memory; only the
    prompt the LLM sees is augmented, and only when something relevant is found.
    """
    from backend.memory.long_term import get_memory

    try:
        mems = await get_memory().search(message, k=3)
    except Exception:
        mems = []
    if not mems:
        return message
    context = " | ".join(mems)
    return f"[Context you recall about the user: {context}]\n\n{message}"

# Prime psutil's CPU counter so the first /stats call returns a real delta.
psutil.cpu_percent(interval=None)

_GPU_UTIL_RE = re.compile(r'"Device Utilization %"=(\d+)')


def _read_gpu_percent() -> float:
    """Real Apple Silicon GPU utilisation via ioreg (no sudo required).

    Reads the AGXAccelerator PerformanceStatistics dictionary and returns the
    highest "Device Utilization %" found. Returns 0.0 if unavailable.
    """
    try:
        out = subprocess.run(
            ["ioreg", "-r", "-c", "AGXAccelerator", "-d", "1"],
            capture_output=True,
            text=True,
            timeout=2.0,
        ).stdout
        values = [int(m) for m in _GPU_UTIL_RE.findall(out)]
        return float(max(values)) if values else 0.0
    except Exception:
        return 0.0


def get_system_stats() -> dict[str, float]:
    """Collect real CPU / RAM / GPU / battery percentages for the HUD gauges."""
    battery = psutil.sensors_battery()
    return {
        "cpu": float(psutil.cpu_percent(interval=None)),
        "ram": float(psutil.virtual_memory().percent),
        "gpu": _read_gpu_percent(),
        "battery": float(battery.percent) if battery is not None else 100.0,
    }


class ChatRequest(BaseModel):
    message: str
    model: str | None = None  # optional catalog id; None = the active model


class ChatResponse(BaseModel):
    reply: str
    model: str


class ProviderRequest(BaseModel):
    provider: str


class ModelRequest(BaseModel):
    model: str  # catalog id, e.g. "glm-5.2"


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple health check — also reports which LLM brain is active."""
    return {
        "status": "ok",
        "service": "jarvis-backend",
        "user": USER_NAME,
        "provider": llm.active_provider(),
        "model": llm.active_model(),
    }


class AgentRequest(BaseModel):
    objective: str
    model: str | None = None
    agents: list[str] | None = None  # optional scope; None = all specialists


@app.get("/memory")
async def get_memory() -> dict[str, object]:
    """Current memories for Settings → Memory (spec §39/§40)."""
    from backend.memory import personal

    return {"configured": personal.configured(), "memories": await personal.list_current()}


class MemoryWrite(BaseModel):
    key: str
    value: str
    category: str = "other"


@app.post("/memory")
async def add_memory(req: MemoryWrite) -> dict[str, object]:
    from backend.memory import personal

    return await personal.remember(req.category, req.key, req.value, source="settings")


class MemoryEdit(BaseModel):
    value: str


@app.put("/memory/{mem_id}")
async def edit_memory(mem_id: str, req: MemoryEdit) -> dict[str, object]:
    from backend.memory import personal

    return await personal.edit_by_id(mem_id, req.value)


@app.delete("/memory/{mem_id}")
async def delete_memory(mem_id: str) -> dict[str, object]:
    from backend.memory import personal

    return await personal.delete_by_id(mem_id)


@app.get("/agents")
async def list_agents() -> dict[str, object]:
    """The roster of specialist agents JARVIS can coordinate (spec §7.5)."""
    from backend.agents import registry as agent_registry

    return {"agents": [a.as_dict() for a in agent_registry.all_specs()]}


@app.post("/agent")
async def agent_run(req: AgentRequest) -> dict[str, object]:
    """Run an objective through the orchestrator — tools included (spec §7.1).

    Returns the coherent reply plus a high-level activity log of what JARVIS did.
    """
    from backend.agents import orchestrator

    try:
        result = await orchestrator.run(req.objective, model=req.model, agent_names=req.agents)
    except Exception as exc:
        # Honest, human-readable failure instead of a raw 500 (spec §40).
        return {
            "reply": f"Scout couldn't complete that objective right now. ({str(exc)[:140]})",
            "activity": [],
            "state": "failed",
            "pending_confirmation": None,
            "model": req.model or llm.active_model(),
        }
    return result.as_dict()


@app.get("/models")
async def models() -> dict[str, object]:
    """The selectable model catalog with per-model capabilities for the chat UI.

    Each entry carries ``vision``/``documents``/``tools`` flags so the chat can
    adapt its controls (e.g. show image/PDF upload only for vision models).
    """
    from backend.providers import registry

    return {"models": registry.list_models(), "active": llm.active_model()}


@app.post("/model")
async def select_model(req: ModelRequest) -> dict[str, object]:
    """Select which catalog model the chat uses (explicit — never auto-swaps)."""
    from backend.providers import registry

    return registry.set_active(req.model)


@app.post("/provider")
async def set_provider(req: ProviderRequest) -> dict[str, object]:
    """Back-compat: treat the value as a catalog model id and select it."""
    return llm.set_provider(req.provider)


@app.get("/stats")
async def stats() -> dict[str, float]:
    """Real system stats for the HUD gauges (CPU/RAM/GPU/battery, all 0–100)."""
    # ioreg runs a subprocess; keep the event loop responsive.
    return await asyncio.to_thread(get_system_stats)


@app.get("/weather")
async def weather() -> dict[str, object]:
    """Live weather for the configured city (Phase 4 — Open-Meteo, free)."""
    from backend.integrations import weather as weather_mod

    try:
        return await weather_mod.get_weather()
    except Exception:
        return {"city": "", "temp_c": None, "description": "unavailable", "emoji": "🌡️", "wind_kph": None}


@app.get("/news")
async def news() -> dict[str, object]:
    """Live top headlines (Phase 4 — Hacker News, free)."""
    from backend.integrations import news as news_mod

    try:
        return {"items": await news_mod.get_news(limit=5)}
    except Exception:
        return {"items": []}


@app.get("/gmail")
async def gmail() -> dict[str, object]:
    """Gmail unread summary (Phase 4). authorized=false until you run the auth flow."""
    from backend.integrations import gmail as gmail_mod

    try:
        return await asyncio.to_thread(gmail_mod.get_summary, 3)
    except Exception:
        return {"authorized": False, "unread": 0, "messages": []}


@app.get("/calendar")
async def calendar() -> dict[str, object]:
    """Upcoming calendar events (Phase 4)."""
    from backend.integrations import calendar as cal_mod

    try:
        return await asyncio.to_thread(cal_mod.get_upcoming, 5)
    except Exception:
        return {"authorized": False, "events": []}


@app.get("/spotify")
async def spotify() -> dict[str, object]:
    """Spotify now-playing (Phase 4)."""
    from backend.integrations import spotify as spotify_mod

    try:
        return await asyncio.to_thread(spotify_mod.get_now_playing)
    except Exception:
        return {"authorized": False, "playing": False}


@app.post("/spotify/control")
async def spotify_control(action: str) -> dict[str, bool]:
    """Playback control: play | pause | next | previous (Spotify Premium)."""
    from backend.integrations import spotify as spotify_mod

    ok = await asyncio.to_thread(spotify_mod.control, action)
    return {"ok": ok}


class VisionRequest(BaseModel):
    prompt: str | None = None


@app.post("/vision")
async def vision(req: VisionRequest) -> dict[str, object]:
    """Phase 6: capture the screen and describe it with local LLaVA (via Ollama)."""
    from backend.integrations import vision as vision_mod

    return await vision_mod.describe_screen(req.prompt)


@app.get("/homeassistant")
async def homeassistant() -> dict[str, object]:
    """Phase 6: list controllable smart-home entities (authorized=false until set up)."""
    from backend.integrations import home_assistant as ha

    try:
        return await ha.list_entities()
    except Exception:
        return {"authorized": False, "entities": []}


class HAControlRequest(BaseModel):
    entity_id: str
    action: str  # "on" | "off"


@app.post("/homeassistant/control")
async def homeassistant_control(req: HAControlRequest) -> dict[str, bool]:
    """Phase 6: turn a smart-home entity on or off."""
    from backend.integrations import home_assistant as ha

    ok = await ha.set_entity(req.entity_id, req.action.lower() == "on")
    return {"ok": ok}


@app.get("/phone")
async def phone_status() -> dict[str, object]:
    """Phase 7: is the phone reachable over ADB? (for HUD / diagnostics)."""
    from backend.integrations import phone

    return await phone.a_device_info()


class IRRequest(BaseModel):
    device: str  # e.g. "ac" | "fan"
    action: str = "power"  # "power" | "on" | "off" | "temp_up" | "temp_down" | "swing"


@app.post("/phone/ir")
async def phone_ir(req: IRRequest) -> dict[str, object]:
    """Phase 7: fire an IR command via the phone's blaster (OnePlus IR app)."""
    from backend.integrations import phone

    key = phone.match_device(req.device) or req.device
    action = req.action.lower()
    if action in ("on", "off"):
        return await phone.a_power(key, action == "on")
    return await phone.a_press(key, action)


# --- Phase 7 finale: live phone mirror + control ----------------------------


@app.get("/phone/size")
async def phone_size() -> dict[str, object]:
    """Phone display size (tap-coordinate space) for the mirror's click mapping."""
    from backend.integrations import phone

    info = await phone.a_device_info()
    if not info.get("connected"):
        return {"connected": False, "w": 0, "h": 0}
    size = await asyncio.to_thread(phone.screen_size, info.get("serial"))
    w, h = size or (0, 0)
    return {"connected": True, "w": w, "h": h}


@app.get("/phone/screen")
async def phone_screen() -> Response:
    """One live JPEG frame of the phone screen. Poll this to mirror the phone."""
    from backend.integrations import phone

    frame = await asyncio.to_thread(phone.screen_jpeg, 1000)
    if frame is None:
        return Response(status_code=503)
    data, w, h = frame
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            "X-Phone-W": str(w),
            "X-Phone-H": str(h),
            "Cache-Control": "no-store",
        },
    )


class TapRequest(BaseModel):
    x: int
    y: int


@app.post("/phone/tap")
async def phone_tap(req: TapRequest) -> dict[str, bool]:
    from backend.integrations import phone

    return {"ok": await asyncio.to_thread(phone.tap_xy, req.x, req.y)}


class SwipeRequest(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int
    ms: int = 200


@app.post("/phone/swipe")
async def phone_swipe(req: SwipeRequest) -> dict[str, bool]:
    from backend.integrations import phone

    return {"ok": await asyncio.to_thread(phone.swipe, req.x1, req.y1, req.x2, req.y2, req.ms)}


class KeyRequest(BaseModel):
    key: str  # home | back | recents | power | wake | volume_up | volume_down | enter


@app.post("/phone/key")
async def phone_key(req: KeyRequest) -> dict[str, bool]:
    from backend.integrations import phone

    return {"ok": await asyncio.to_thread(phone.keyevent, req.key)}


class TextRequest(BaseModel):
    text: str


@app.post("/phone/text")
async def phone_text(req: TextRequest) -> dict[str, bool]:
    from backend.integrations import phone

    return {"ok": await asyncio.to_thread(phone.type_text, req.text)}


# Whisper.cpp emits non-speech annotations on silence/noise, e.g. "[BLANK_AUDIO]",
# "[ Silence ]", "[Music]", "(wind blowing)". These are internal states, never
# user speech — strip them so they never render as a user message (spec: show a
# proper state, not the raw token).
_NON_SPEECH_RE = re.compile(r"[\[(][^\])]*[\])]")


def _clean_transcript(text: str) -> str:
    cleaned = _NON_SPEECH_RE.sub(" ", text or "").strip()
    # If nothing but annotations/punctuation remained, it wasn't speech.
    if not re.search(r"[A-Za-z0-9]", cleaned):
        return ""
    return cleaned


def _decode_wav_to_mono16k(data: bytes) -> np.ndarray:
    """Decode WAV bytes to float32 mono @16kHz (what Whisper.cpp expects)."""
    with wavemod.open(io.BytesIO(data), "rb") as w:
        nch, sw, fr, n = (
            w.getnchannels(),
            w.getsampwidth(),
            w.getframerate(),
            w.getnframes(),
        )
        raw = w.readframes(n)
    if sw == 1:
        arr = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    elif sw == 4:
        arr = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:  # 16-bit
        arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if nch > 1:
        arr = arr.reshape(-1, nch).mean(axis=1)
    if fr != 16000 and arr.size:
        target = int(round(arr.size * 16000 / fr))
        if target > 0:
            arr = np.interp(
                np.linspace(0, 1, target, endpoint=False),
                np.linspace(0, 1, arr.size, endpoint=False),
                arr,
            ).astype(np.float32)
    return arr.astype(np.float32)


def _encode_wav_b64(samples: np.ndarray, sample_rate: int) -> str:
    """Encode float32 samples to a base64 16-bit PCM WAV string."""
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wavemod.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(pcm16.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


@app.post("/voice")
async def voice(file: UploadFile = File(...)) -> dict[str, object]:
    """Full browser voice turn: mic WAV → Whisper STT → LLM → Kokoro TTS → reply.

    Returns the transcript, JARVIS's text reply, and the spoken reply as a
    base64 WAV so the browser can play it and pulse the orb in time.
    """
    from backend.voice import stt, tts

    raw = await file.read()
    audio = _decode_wav_to_mono16k(raw)
    transcript = _clean_transcript(await asyncio.to_thread(stt.transcribe, audio))
    if not transcript:
        # No real speech (silence / [BLANK_AUDIO] / noise) — surface as an empty
        # transcript; the client shows a proper "no speech detected" state.
        return {"transcript": "", "reply": "", "audio": None, "sample_rate": 0}

    reply = await commands.handle_command(transcript)
    if reply is None:
        prompt = await _augment_with_memory(transcript)
        # Voice must feel instant: use the fastest model and ask for a short spoken
        # reply (less text → much faster speech synthesis). Groq first, gpt-oss fallback.
        voice_prompt = "[Voice reply: answer in 1–2 short spoken sentences, no markdown or lists.]\n\n" + prompt
        try:
            reply = await llm.chat(voice_prompt, history=_memory.history(), model=VOICE_MODEL)
        except Exception:
            reply = await llm.chat(voice_prompt, history=_memory.history(), model=VOICE_MODEL_FALLBACK)
    _memory.add_user(transcript)
    _memory.add_assistant(reply)

    from backend.voice import registry as voice_registry

    # Synthesise speech, but never let a TTS hiccup 500 the turn — if Kokoro fails
    # (e.g. empty/unspeakable text → "need at least one array to concatenate"),
    # still return the text reply so the client can show/speak it another way.
    audio_b64, sample_rate = None, 0
    if reply.strip():
        try:
            samples, sample_rate = await asyncio.to_thread(
                tts.synthesize, reply, voice_registry.get_default_voice()
            )
            audio_b64 = _encode_wav_b64(samples, sample_rate)
        except Exception as exc:
            import logging

            logging.getLogger("uvicorn.error").warning(f"TTS synthesis failed: {exc}")
            audio_b64, sample_rate = None, 0
    return {"transcript": transcript, "reply": reply, "audio": audio_b64, "sample_rate": sample_rate}


_SENT_SPLIT = re.compile(r"(.+?[.!?…])(\s+|$)", re.S)


def _flush_sentences(buf: str) -> tuple[list[str], str]:
    """Pull complete sentences out of a streaming buffer → (sentences, remainder).

    Lets streaming voice synthesise + speak each sentence the moment it finishes,
    instead of waiting for the whole reply (spec §17 fast speaking).
    """
    out: list[str] = []
    idx = 0
    for m in _SENT_SPLIT.finditer(buf):
        s = m.group(1).strip()
        if s:
            out.append(s)
        idx = m.end()
    return out, buf[idx:]


@app.websocket("/ws/voice")
async def ws_voice(websocket: WebSocket) -> None:
    """Streaming voice turn (spec §17): client sends utterance WAV bytes; server
    replies with a stream of events —
      {"type":"transcript","text"} · {"type":"text","text"} (reply tokens) ·
      {"type":"audio","audio","sample_rate"} (one per sentence, as it's ready) ·
      {"type":"done","reply"}.
    Scout starts speaking the first sentence while the rest is still generating.
    """
    from backend.config import SYSTEM_PROMPT
    from backend.providers import registry as pregistry
    from backend.voice import registry as voice_registry, stt, tts

    await websocket.accept()

    async def speak(text: str, voice: str) -> None:
        text = text.strip()
        if not text:
            return
        samples, sr = await asyncio.to_thread(tts.synthesize, text, voice)
        await websocket.send_json({"type": "audio", "audio": _encode_wav_b64(samples, sr), "sample_rate": sr})

    try:
        while True:
            raw = await websocket.receive_bytes()
            audio = _decode_wav_to_mono16k(raw)
            transcript = _clean_transcript(await asyncio.to_thread(stt.transcribe, audio))
            if not transcript:
                await websocket.send_json({"type": "transcript", "text": ""})
                await websocket.send_json({"type": "done", "reply": ""})
                continue
            await websocket.send_json({"type": "transcript", "text": transcript})
            voice = voice_registry.get_default_voice()

            # ---- FAST PATH: simple deterministic actions (open/close/switch/
            # screenshot) execute NOW via native macOS — no LLM cycle. Two-phase:
            # speak "Opening…" instantly (plays while macOS launches in parallel),
            # then verify and speak the result. Complex tasks return None and fall
            # through to the agent below.
            from backend.agents import quick_actions as _qa

            _action = _qa.match(transcript)
            if _action is not None:
                running = _qa.label_running(_action)
                await websocket.send_json({"type": "state", "state": "executing", "label": running})
                await websocket.send_json({"type": "text", "text": running})
                await speak(running, voice)  # immediate spoken acknowledgement
                ok, done_msg = await asyncio.to_thread(_qa.execute, _action)  # native + verify, off-loop
                await websocket.send_json({"type": "state", "state": "complete" if ok else "error", "label": done_msg})
                await websocket.send_json({"type": "text", "text": done_msg})
                await speak(done_msg, voice)
                _memory.add_user(transcript)
                _memory.add_assistant(done_msg)
                await websocket.send_json({"type": "done", "reply": done_msg})
                continue

            # Tell the Halo what Scout is about to do so it can show a real state
            # (vision / executing) instead of a generic "thinking" (Phase 2).
            _low = transcript.lower()
            from backend.tools.vision_tools import detect_app as _detect_app

            if _detect_app(transcript) or any(
                k in _low for k in ("my screen", "the screen", "look at", "look into", "looking at",
                                    "what's in my", "what is in my", "what do you see")
            ):
                await websocket.send_json({"type": "state", "state": "vision", "label": "Looking at your screen…"})
            elif any(
                k in _low for k in ("play ", "pause", "turn on", "turn off", "open ", "remind",
                                    "volume", "brightness", "lock screen", "go to sleep")
            ):
                await websocket.send_json({"type": "state", "state": "executing", "label": "Working…"})

            # Built-in commands answer directly (speak them sentence-by-sentence too).
            command_reply = await commands.handle_command(transcript)
            if command_reply is not None:
                await websocket.send_json({"type": "text", "text": command_reply})
                sents, rest = _flush_sentences(command_reply + " ")
                for s in sents:
                    await speak(s, voice)
                await speak(rest, voice)
                _memory.add_user(transcript)
                _memory.add_assistant(command_reply)
                await websocket.send_json({"type": "done", "reply": command_reply})
                continue

            # General requests go through the ORCHESTRATOR so voice can actually DO
            # things (open apps, look at the screen, check state, …) not just talk.
            # Tokens stream → spoken sentence-by-sentence; tool activity → Halo state.
            from backend.agents import orchestrator

            voice_prompt = (
                "[Voice: keep the spoken answer to 1–2 short sentences, no markdown or lists. "
                "If the user asks you to open/close/switch an app, control the Mac, or look at "
                "the screen, use your tools to actually do it.]\n\n" + transcript
            )
            model = websocket.query_params.get("model") or None
            state = {"buf": "", "full": ""}

            async def on_text(tok: str) -> None:
                state["full"] += tok
                state["buf"] += tok
                await websocket.send_json({"type": "text", "text": tok})
                sents, state["buf"] = _flush_sentences(state["buf"])
                for s in sents:
                    await speak(s, voice)

            async def on_activity(ev) -> None:
                cat = "vision" if (getattr(ev, "tool", "") or "").startswith("see_") else "executing"
                await websocket.send_json({"type": "state", "state": cat, "label": ev.label})

            # Voice agent pre-approves the sandboxed build tools so a multi-step
            # task ("create BubbleSort.java, run it, fix errors") executes end-to-end
            # without per-step prompts. File/command ops stay workspace-scoped +
            # dangerous-command-denylisted; destructive ops (delete) still need consent.
            _VOICE_AGENT_TOOLS = {"write_file", "edit_file", "rename_path", "run_command", "git_commit", "close_app"}
            try:
                await orchestrator.run_stream(
                    voice_prompt, history=_memory.history(), model=model,
                    on_text=on_text, on_activity=on_activity, auto_confirm=_VOICE_AGENT_TOOLS,
                )
            except Exception:
                if not state["full"]:
                    state["full"] = "Sorry, I couldn't do that right now."
                    await websocket.send_json({"type": "text", "text": state["full"]})
            if state["buf"].strip():
                await speak(state["buf"], voice)
            _memory.add_user(transcript)
            _memory.add_assistant(state["full"])
            await websocket.send_json({"type": "done", "reply": state["full"]})
    except WebSocketDisconnect:
        return


class ImageRequest(BaseModel):
    prompt: str


@app.post("/image")
async def generate_image(req: ImageRequest) -> dict[str, object]:
    """Text-to-image (spec §47) — FLUX.1-schnell via NVIDIA. Returns a data: URI."""
    from backend.integrations import image_gen

    try:
        uri = await image_gen.generate(req.prompt)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:200], "prompt": req.prompt}
    return {"ok": True, "image": uri, "prompt": req.prompt}


# --- Connectors (spec §30) + Reminders (spec §31) ---------------------------


@app.get("/connectors")
async def connectors_status() -> dict[str, object]:
    """Status of the user's connectors for Settings → Connectors."""
    from backend.integrations import calendar as cal, gmail, reminders

    gm = await asyncio.to_thread(gmail.get_summary, 1)
    ca = await asyncio.to_thread(cal.get_upcoming, 1)
    return {
        "connectors": [
            {"id": "gmail", "name": "Gmail", "provider": "google",
             "connected": bool(gm.get("authorized")),
             "detail": f"{gm.get('unread', 0)} unread" if gm.get("authorized") else "Not connected"},
            {"id": "calendar", "name": "Google Calendar", "provider": "google",
             "connected": bool(ca.get("authorized")),
             "detail": "Connected" if ca.get("authorized") else "Not connected"},
            {"id": "reminders", "name": "Reminders", "provider": "local",
             "connected": True, "detail": f"{reminders.count()} active"},
        ]
    }


@app.post("/connectors/google/connect")
async def connect_google() -> dict[str, object]:
    """Run Google's browser consent flow on this Mac and cache the token."""
    from backend.integrations.google_auth import get_credentials

    try:
        creds = await asyncio.to_thread(get_credentials, True)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:220]}
    return {"ok": creds is not None}


@app.post("/connectors/google/disconnect")
async def disconnect_google() -> dict[str, object]:
    from backend.integrations.google_auth import _TOKEN_PATH

    try:
        if _TOKEN_PATH.exists():
            _TOKEN_PATH.unlink()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True}


class ReminderReq(BaseModel):
    text: str
    due: str | None = None


@app.get("/reminders")
async def get_reminders() -> dict[str, object]:
    from backend.integrations import reminders

    return {"reminders": reminders.list_all()}


@app.post("/reminders")
async def add_reminder_ep(req: ReminderReq) -> dict[str, object]:
    from backend.integrations import reminders

    return reminders.add(req.text, req.due)


@app.delete("/reminders/{rid}")
async def del_reminder(rid: str) -> dict[str, bool]:
    from backend.integrations import reminders

    return {"ok": reminders.remove(rid)}


@app.post("/reminders/{rid}/done")
async def done_reminder(rid: str) -> dict[str, bool]:
    from backend.integrations import reminders

    return {"ok": reminders.complete(rid)}


@app.get("/reminders/due")
async def reminders_due() -> dict[str, object]:
    """Reminders that have just come due (marks them fired). The macOS menu-bar
    helper polls this and raises a native notification (spec §31)."""
    from backend.integrations import reminders

    return {"due": reminders.due_now()}


# --- Routines (spec §31) — recurring proactive tasks ------------------------


class RoutineReq(BaseModel):
    prompt: str
    schedule: str
    title: str | None = None


@app.get("/routines")
async def get_routines() -> dict[str, object]:
    from backend.integrations import routines

    return {"routines": routines.list_all()}


@app.post("/routines")
async def add_routine_ep(req: RoutineReq) -> dict[str, object]:
    from backend.integrations import routines

    return routines.add(req.prompt, req.schedule, req.title)


@app.get("/routines/notifications")
async def routine_notifications() -> dict[str, object]:
    """Freshly-run routine results the menu-bar helper turns into notifications."""
    from backend.integrations import routines

    return {"notifications": routines.pending_notifications()}


@app.post("/routines/{rid}/toggle")
async def toggle_routine(rid: str, enabled: bool = True) -> dict[str, bool]:
    from backend.integrations import routines

    return {"ok": routines.set_enabled(rid, enabled)}


@app.delete("/routines/{rid}")
async def del_routine(rid: str) -> dict[str, bool]:
    from backend.integrations import routines

    return {"ok": routines.remove(rid)}


# ─── Autonomy: daemons + approval queue ────────────────────────────────────

@app.get("/autonomy/daemons")
async def autonomy_daemons() -> dict[str, object]:
    from backend.autonomy import engine as autonomy
    return {"daemons": autonomy.list_daemons()}


@app.post("/autonomy/daemons/{name}/toggle")
async def autonomy_daemon_toggle(name: str, enabled: bool = True) -> dict[str, bool]:
    from backend.autonomy import engine as autonomy, proposals
    if not autonomy.get_daemon(name):
        return {"ok": False}
    proposals.set_enabled(name, enabled)
    return {"ok": True}


@app.post("/autonomy/daemons/{name}/run")
async def autonomy_daemon_run(name: str) -> dict[str, object]:
    from backend.autonomy import engine as autonomy
    res = await autonomy.run_now(name)
    return {"ok": res.ok, "summary": res.summary, "created_proposal": bool(res.proposal)}


@app.get("/autonomy/daemons/{name}/runs")
async def autonomy_daemon_runs(name: str, limit: int = 25) -> dict[str, object]:
    from backend.autonomy import proposals
    return {"runs": proposals.recent_runs(name, limit)}


@app.get("/autonomy/proposals")
async def autonomy_proposals(all: bool = False, limit: int = 50) -> dict[str, object]:
    from backend.autonomy import proposals
    return {"proposals": proposals.list_all(limit) if all else proposals.list_pending()}


@app.post("/autonomy/proposals/{pid}/approve")
async def autonomy_proposal_approve(pid: str) -> dict[str, object]:
    from backend.autonomy import engine as autonomy
    return await autonomy.execute_proposal(pid)


@app.post("/autonomy/proposals/{pid}/reject")
async def autonomy_proposal_reject(pid: str, reason: str = "") -> dict[str, bool]:
    from backend.autonomy import engine as autonomy
    return {"ok": autonomy.reject_proposal(pid, reason)}


# ── Autonomy execution mode ── Plan / Auto / Bypass ──
# Persisted in-process; the scheduler and daemons read `autonomy_mode()` to
# decide whether to auto-execute PROPOSE-tier daemons or wait for approval.
_AUTONOMY_MODE = {"value": "plan"}  # plan | auto | bypass


@app.get("/autonomy/mode")
async def autonomy_mode_get() -> dict[str, str]:
    return {"mode": _AUTONOMY_MODE["value"]}


@app.post("/autonomy/mode")
async def autonomy_mode_set(mode: str) -> dict[str, str]:
    m = (mode or "").lower().strip()
    if m not in ("plan", "auto", "bypass"):
        return {"mode": _AUTONOMY_MODE["value"], "error": "invalid mode"}
    _AUTONOMY_MODE["value"] = m
    return {"mode": m}


# ── MCP servers ── architecture-ready endpoint.
# Reads ~/.scout/mcp.json (a simple registry — no live connections yet). The
# frontend Settings→MCP section renders whatever's here and shows a clear
# "how to add a server" state when empty.
@app.get("/mcp/servers")
async def mcp_servers() -> dict[str, object]:
    from pathlib import Path as _P
    import json as _json
    p = _P.home() / ".scout" / "mcp.json"
    if not p.exists():
        return {"servers": [], "config_path": str(p), "configured": False}
    try:
        data = _json.loads(p.read_text(encoding="utf-8"))
        servers = data.get("servers", []) if isinstance(data, dict) else []
        return {"servers": servers, "config_path": str(p), "configured": True}
    except Exception as exc:
        return {"servers": [], "config_path": str(p), "configured": False, "error": str(exc)}


# ─── Universal File Viewer ─────────────────────────────────────────────────

@app.get("/preview/meta")
async def preview_meta(path: str) -> dict[str, object]:
    """Cheap metadata for a path — kind, size, mtime, mime."""
    from backend.documents import preview
    return preview.describe(path).as_dict()


@app.get("/preview")
async def preview_full(path: str) -> dict[str, object]:
    """Full inline preview payload (text/html/sheets/entries populated per kind)."""
    from backend.documents import preview
    return preview.build(path).as_dict()


@app.get("/preview/pdf-page")
async def preview_pdf_page(path: str, page: int = 0, zoom: float = 1.6) -> Response:
    """Render a single PDF page as PNG so it renders in Electron (no PDF plugin)."""
    from backend.documents import preview
    try:
        png, total = preview.render_pdf_page(path, page=page, zoom=zoom)
    except FileNotFoundError:
        return Response(status_code=404, content=b"not found")
    except Exception as exc:
        return Response(status_code=500, content=str(exc).encode())
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=60", "X-Total-Pages": str(total)},
    )


@app.get("/preview/raw")
async def preview_raw(path: str) -> Response:
    """Stream the raw bytes with the correct Content-Type — for pdf/image/video/audio.

    ``Content-Disposition: inline`` is essential — without it Chrome downloads PDFs
    instead of rendering them in the iframe, so the FileViewer would show a blank pane.
    """
    from backend.documents import preview
    from pathlib import Path as _P
    try:
        data, mime = preview.read_bytes(path)
    except FileNotFoundError:
        return Response(status_code=404, content=b"not found")
    except Exception as exc:
        return Response(status_code=500, content=str(exc).encode())
    fname = _P(path).name.replace('"', '')
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Cache-Control": "no-cache",
            "Content-Disposition": f'inline; filename="{fname}"',
            "X-Frame-Options": "SAMEORIGIN",
        },
    )


@app.post("/vision-chat")
async def vision_chat(
    files: list[UploadFile] = File(...),
    prompt: str = "",
    model: str | None = None,
) -> dict[str, object]:
    """Send one or more images (+ optional prompt) to a vision-capable model.

    The chat UI enables this only for models whose capabilities include vision,
    so the request always targets a model that can actually see. Each image is
    passed as an OpenAI ``image_url`` data-URI content block (spec §7/§8/§15) —
    multiple attachments in one message are supported.
    """
    import base64 as _b64

    from backend.providers import registry

    provider, spec = registry.provider_for(model)
    if "vision" not in spec.capabilities:
        return {
            "ok": False,
            "reply": f"{spec.label} can't read images, sir — pick a vision model.",
            "model": spec.id,
        }
    if not files:
        return {"ok": False, "reply": "No image was attached, sir.", "model": spec.id}

    text = prompt.strip() or ("Describe what you see, sir." if len(files) == 1 else "Describe these images, sir.")
    content: list[dict] = [{"type": "text", "text": text}]
    for f in files:
        raw = await f.read()
        mime = f.content_type or "image/png"
        data_uri = f"data:{mime};base64,{_b64.b64encode(raw).decode('ascii')}"
        content.append({"type": "image_url", "image_url": {"url": data_uri}})

    messages = [{"role": "user", "content": content}]
    try:
        result = await provider.complete(messages, system=None, model=spec.remote_id)
    except Exception as exc:
        return {"ok": False, "reply": f"Vision request failed: {exc}", "model": spec.id}
    return {"ok": True, "reply": result.text, "model": spec.id}


# --- GIF search (Giphy v2) --------------------------------------------------

@app.get("/gif/search")
async def gif_search(q: str, limit: int = 20) -> dict[str, object]:
    """Search Giphy for animated GIFs. Requires GIPHY_API_KEY in .env."""
    from backend.integrations import gif as _gif
    if not _gif.is_configured():
        return {"gifs": [], "configured": False, "error": "GIPHY_API_KEY not set."}
    try:
        gifs = await _gif.search(q, limit)
    except Exception as exc:
        return {"gifs": [], "configured": True, "error": f"Giphy error: {str(exc)[:140]}"}
    return {"gifs": gifs, "configured": True}


@app.get("/gif/trending")
async def gif_trending(limit: int = 20) -> dict[str, object]:
    """Popular GIFs — what the picker shows before you type anything."""
    from backend.integrations import gif as _gif
    if not _gif.is_configured():
        return {"gifs": [], "configured": False, "error": "GIPHY_API_KEY not set."}
    try:
        gifs = await _gif.trending(limit)
    except Exception as exc:
        return {"gifs": [], "configured": True, "error": f"Giphy error: {str(exc)[:140]}"}
    return {"gifs": gifs, "configured": True}


# --- Documents / RAG (spec §14) ---------------------------------------------


@app.post("/documents")
async def upload_document(file: UploadFile = File(...)) -> dict[str, object]:
    """Upload → extract → chunk → index a document into the RAG store.

    Returns a summary (doc_id, pages, chunks) so the composer can show a real
    processing→ready state. Honest failure for unreadable/unsupported files.
    """
    from backend.documents import store
    from backend.documents.extract import ExtractError

    raw = await file.read()
    try:
        result = await store.add(file.filename or "document", file.content_type or "", raw)
    except ExtractError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": f"Couldn't index the document: {str(exc)[:120]}"}
    return {"ok": True, **result}


@app.get("/documents")
async def list_documents_endpoint() -> dict[str, object]:
    """The uploaded documents (for the composer chips and Settings → Documents)."""
    from backend.documents import store

    return {"documents": store.list_documents()}


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, bool]:
    """Remove a document and all its chunks from the RAG store."""
    from backend.documents import store

    return {"ok": store.delete(doc_id)}


# --- Code mode / workspace (spec §18–21, §48) -------------------------------


class WorkspaceRequest(BaseModel):
    path: str


@app.get("/workspace")
async def get_workspace() -> dict[str, object]:
    """Current workspace + its file tree (for the Code mode file browser)."""
    from backend.workspace import service as ws

    data = ws.info()
    node = ws.tree() if ws.is_connected() else None
    data["tree"] = node.as_dict() if node else None
    return data


@app.post("/workspace")
async def set_workspace(req: WorkspaceRequest) -> dict[str, object]:
    """Connect a project folder as the workspace (must be an existing directory)."""
    from backend.workspace import service as ws

    return ws.set_root(req.path)


@app.post("/workspace/pick")
async def pick_workspace() -> dict[str, object]:
    """Open a native macOS folder chooser and connect the selected folder.

    The browser can't hand the backend a real filesystem path, so we open Finder's
    'choose folder' dialog on the host (osascript) and use the POSIX path it returns.
    """
    from backend.workspace import service as ws

    script = (
        'set p to POSIX path of (choose folder with prompt "Select a project folder for Scout Code")\n'
        'return p'
    )
    try:
        out = await asyncio.to_thread(
            subprocess.run, ["osascript", "-e", script], capture_output=True, text=True, timeout=180
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    if out.returncode != 0:
        # User cancelled the dialog (or no GUI session) — not an error to shout about.
        return {"ok": False, "cancelled": True}
    path = out.stdout.strip()
    if not path:
        return {"ok": False, "cancelled": True}
    return ws.set_root(path)


@app.post("/workspace/disconnect")
async def disconnect_workspace() -> dict[str, object]:
    from backend.workspace import service as ws

    return ws.disconnect()


@app.get("/workspace/file")
async def read_workspace_file(path: str) -> dict[str, object]:
    """Read a file's text for the Code mode viewer (sandboxed to the workspace)."""
    from backend.workspace import service as ws
    from backend.workspace.service import WorkspaceError

    try:
        target = ws.resolve(path)
    except WorkspaceError as exc:
        return {"ok": False, "error": str(exc)}
    if not target.is_file():
        return {"ok": False, "error": "Not a file."}
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "path": path, "content": text[:200_000]}


# ── Code workspace panels: git, terminal, tasks ─────────────────────────

_WS_TERMINAL_HISTORY: list[dict] = []  # in-memory ring buffer of recent commands
_WS_TASKS: list[dict] = []              # tool-execution log for the Tasks panel
_HIST_MAX = 50


def _ws_run_git(*args: str, timeout: float = 6.0) -> tuple[bool, str]:
    from backend.workspace import service as ws
    root = ws.get_root()
    if not root:
        return False, "No workspace connected."
    try:
        out = subprocess.run(
            ["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout
        )
        return out.returncode == 0, (out.stdout or out.stderr)
    except Exception as exc:
        return False, str(exc)


@app.get("/workspace/git/status")
async def workspace_git_status() -> dict[str, object]:
    """Structured git status: list of changed files with their change type."""
    ok, txt = _ws_run_git("status", "--porcelain=v1", "--branch")
    if not ok:
        return {"ok": False, "error": txt[:200]}
    lines = (txt or "").splitlines()
    branch = ""
    files: list[dict] = []
    for line in lines:
        if line.startswith("## "):
            branch = line[3:].split("...")[0].strip()
            continue
        if len(line) < 3:
            continue
        code = line[:2]
        path = line[3:].strip()
        state = "modified"
        if code.strip() == "??":
            state = "untracked"
        elif "D" in code:
            state = "deleted"
        elif "A" in code:
            state = "added"
        elif "R" in code:
            state = "renamed"
        elif "M" in code:
            state = "modified"
        files.append({"path": path, "state": state, "code": code})
    return {"ok": True, "branch": branch, "files": files}


@app.get("/workspace/git/diff")
async def workspace_git_diff(path: str = "") -> dict[str, object]:
    """Full git diff for the workspace (or a single file)."""
    args = ["diff", "--no-color"]
    if path:
        args += ["--", path]
    ok, txt = _ws_run_git(*args, timeout=10.0)
    if not ok:
        return {"ok": False, "error": txt[:200]}
    return {"ok": True, "path": path, "diff": (txt or "")[:200_000]}


class WsRunReq(BaseModel):
    command: str


@app.post("/workspace/run")
async def workspace_run(req: WsRunReq) -> dict[str, object]:
    """Run a shell command in the workspace root; append to terminal history.

    Uses the same DANGEROUS filter as the code_tools.run_command tool so this
    can't be turned into an arbitrary-shell escape hatch.
    """
    from backend.workspace import service as ws
    from backend.tools.code_tools import _DANGEROUS

    root = ws.get_root()
    if not root:
        return {"ok": False, "error": "No workspace connected."}
    cmd = (req.command or "").strip()
    if not cmd:
        return {"ok": False, "error": "Empty command."}
    low = cmd.lower()
    if any(bad in low for bad in _DANGEROUS):
        return {"ok": False, "error": f"Command blocked: {cmd!r}"}
    started = datetime.now(timezone.utc).astimezone().isoformat()
    try:
        out = await asyncio.to_thread(
            subprocess.run, cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=90
        )
    except subprocess.TimeoutExpired:
        entry = {"cmd": cmd, "code": -1, "output": "(timed out after 90s)", "started": started}
        _WS_TERMINAL_HISTORY.insert(0, entry)
        del _WS_TERMINAL_HISTORY[_HIST_MAX:]
        return {"ok": False, "error": "timed out", **entry}
    body = (out.stdout or "") + (("\n" + out.stderr) if out.stderr else "")
    body = body[:80_000]
    entry = {"cmd": cmd, "code": out.returncode, "output": body, "started": started}
    _WS_TERMINAL_HISTORY.insert(0, entry)
    del _WS_TERMINAL_HISTORY[_HIST_MAX:]
    # Also record as a Task for the Tasks panel.
    _WS_TASKS.insert(0, {
        "kind": "command", "label": cmd,
        "ok": out.returncode == 0, "at": started,
    })
    del _WS_TASKS[_HIST_MAX:]
    return {"ok": out.returncode == 0, **entry}


@app.get("/workspace/terminal")
async def workspace_terminal() -> dict[str, object]:
    return {"history": _WS_TERMINAL_HISTORY[:_HIST_MAX]}


@app.get("/workspace/tasks")
async def workspace_tasks() -> dict[str, object]:
    return {"tasks": _WS_TASKS[:_HIST_MAX]}


def _log_workspace_task(kind: str, label: str, ok: bool = True) -> None:
    """Called from other code paths (e.g. code_tools) so writes/edits also show
    up in the Tasks panel. Safe to import — writes to the in-memory buffer only."""
    started = datetime.now(timezone.utc).astimezone().isoformat()
    _WS_TASKS.insert(0, {"kind": kind, "label": label, "ok": ok, "at": started})
    del _WS_TASKS[_HIST_MAX:]


# Code actions AUTO/BYPASS may run without asking; delete always confirms (spec §19).
_CODE_AUTO = {"write_file", "edit_file", "rename_path", "run_command", "git_commit"}


class CodeRequest(BaseModel):
    objective: str
    model: str | None = None
    mode: str = "plan"  # plan | auto | bypass
    # Prior conversation in this Code session, so switching Plan → Auto and
    # saying "proceed" carries the plan's context. Empty list = fresh turn.
    history: list[dict] = []


@app.post("/code")
async def code_run(req: CodeRequest) -> dict[str, object]:
    """Run a coding objective against the workspace with the given mode.

    PLAN proposes changes (writes surface as pending, nothing is modified); AUTO and
    BYPASS auto-approve create/edit/rename while delete still asks (spec §19).
    """
    from backend.agents import orchestrator
    from backend.workspace import service as ws

    if not ws.is_connected():
        return {"reply": "Connect a workspace folder first, sir.", "activity": [], "state": "failed",
                "pending_confirmation": None, "model": req.model or llm.active_model()}
    auto = _CODE_AUTO if req.mode in ("auto", "bypass") else set()
    if req.mode == "plan":
        prefix = (
            "[PLAN MODE] Read whatever files you need to understand the task, then present a clear, "
            "concise plan of the exact changes you would make — list each file and show the code — but "
            "do NOT call write_file, edit_file, rename_path, or delete_path. Propose only.\n\n"
        )
    else:
        prefix = (
            "[AUTO MODE] Make the change directly. Read a file at most once to understand it — do NOT list the "
            "same directory repeatedly. Then create/edit the needed files with write_file/edit_file. When the task "
            "implies running or committing (e.g. 'run it', 'commit'), use run_command and git_commit. Finish by "
            "briefly stating what you did.\n\n"
        )
    objective = prefix + req.objective
    # Sanitize history: keep only role/content pairs; drop anything the model
    # can't consume (activity blobs, state markers, images unless supported).
    history: list[dict] = []
    for m in (req.history or [])[-20:]:  # last 20 turns is plenty of context
        role = str(m.get("role", ""))
        content = str(m.get("text") or m.get("content") or "").strip()
        if not content:
            continue
        # Normalize the code page's "scout" role to the standard "assistant".
        if role == "scout":
            role = "assistant"
        if role in ("user", "assistant"):
            history.append({"role": role, "content": content})
    # Code mode uses its own dedicated brain (deeper reasoning) unless the
    # user has explicitly picked a different model in the Code topbar.
    from backend.config import CODE_MODEL
    from backend.providers import registry as pregistry
    from backend.providers.catalog import get_spec as _spec

    code_model = req.model
    if not code_model:
        # Only route to CODE_MODEL if its endpoint has a key configured — else
        # let the orchestrator fall through to the active chat model.
        spec = _spec(CODE_MODEL)
        ep = pregistry._ENDPOINTS.get(spec.endpoint) if spec else None
        if ep and ep.available:
            code_model = CODE_MODEL

    try:
        # code + documents tools: the agent can also read anything the user uploaded.
        result = await orchestrator.run(objective, model=code_model, agent_names=["code", "documents", "productivity"], auto_confirm=auto, history=history)
    except Exception as exc:
        return {"reply": f"Scout couldn't complete that in the workspace. ({str(exc)[:140]})", "activity": [],
                "state": "failed", "pending_confirmation": None, "model": req.model or llm.active_model()}
    return result.as_dict()


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None  # override for previews; else the saved default


@app.get("/voices")
async def voices() -> dict[str, object]:
    """List the actual TTS voices with names, personality, accent (spec §11–16)."""
    from backend.voice import registry as voice_registry

    return {
        "voices": voice_registry.list_voices(),
        "default": voice_registry.get_default_voice(),
    }


class VoiceSettingRequest(BaseModel):
    voice: str


@app.post("/settings/voice")
async def set_voice(req: VoiceSettingRequest) -> dict[str, object]:
    """Persist the default SCOUT voice (used by Speak and Talk)."""
    from backend.voice import registry as voice_registry

    return voice_registry.set_default_voice(req.voice)


@app.post("/speak")
async def speak(req: SpeakRequest) -> dict[str, object]:
    """Text-to-speech for the message 'Speak' action and voice previews (§17).

    Takes already-cleaned readable text (Markdown stripped by the client) and
    returns spoken audio as a base64 WAV, using the requested voice or the saved
    default.
    """
    from backend.voice import registry as voice_registry, tts

    text = (req.text or "").strip()
    if not text:
        return {"audio": None, "sample_rate": 0}
    voice = req.voice if (req.voice and voice_registry.is_valid(req.voice)) else voice_registry.get_default_voice()
    samples, sample_rate = await asyncio.to_thread(tts.synthesize, text[:2000], voice)
    return {"audio": _encode_wav_b64(samples, sample_rate), "sample_rate": sample_rate, "voice": voice}


@app.post("/speak_stream")
async def speak_stream(req: SpeakRequest):
    """Streaming TTS — proxies to the local Chatterbox /speak_stream endpoint
    so the frontend can start playing the first sentence in ~2s while the rest
    is still generating.

    For non-Chatterbox voices, we fall back to the one-shot /speak semantics by
    returning a single SSE event containing the full WAV — same wire format so
    the frontend has one code path.
    """
    import json as _json

    from fastapi.responses import StreamingResponse

    from backend.voice import chatterbox_client as _cb, registry as voice_registry, tts

    text = (req.text or "").strip()
    voice = req.voice if (req.voice and voice_registry.is_valid(req.voice)) else voice_registry.get_default_voice()

    async def gen():
        if not text:
            yield f"data: {_json.dumps({'done': True, 'total': 0})}\n\n"
            return

        # Chatterbox path: proxy the upstream SSE line-by-line.
        if _cb.is_custom_voice(voice) and _cb.is_up():
            import httpx

            ref_path = _cb._CUSTOM_VOICES[voice]["ref_path"]
            body = {"text": text[:5000], "voice_ref": ref_path}
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with client.stream(
                        "POST", f"{_cb.BASE_URL}/speak_stream", json=body,
                        headers={"Accept": "text/event-stream"},
                    ) as r:
                        async for line in r.aiter_lines():
                            if line:
                                yield f"{line}\n"
                            else:
                                yield "\n"
                return
            except Exception as exc:
                # Fall through to one-shot fallback below.
                print(f"[speak_stream] chatterbox stream failed: {exc}")

        # Fallback (Kokoro, or Chatterbox unreachable): synth once, emit as a
        # single SSE event so the frontend uses one playback path.
        samples, sr = await asyncio.to_thread(tts.synthesize, text[:2000], voice)
        b64 = _encode_wav_b64(samples, sr)
        payload = {"seq": 0, "total": 1, "audio_b64": b64, "sample_rate": sr}
        yield f"data: {_json.dumps(payload)}\n\n"
        yield f"data: {_json.dumps({'done': True, 'total': 1})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Receive text, return JARVIS's response text."""
    reply = await commands.handle_command(req.message)
    if reply is None:
        prompt = await _augment_with_memory(req.message)
        reply = await llm.chat(prompt, history=_memory.history(), model=req.model)
    _memory.add_user(req.message)
    _memory.add_assistant(reply)
    return ChatResponse(reply=reply, model=req.model or llm.active_model())


def _parse_ws(raw: str) -> tuple[str, str | None, bool, str | None]:
    """Decode a client frame → (message, model, web, control).

    Accepts a plain string (legacy) or JSON ``{message, model?, web?}``. A frame
    ``{"type":"stop"}`` is a control signal (returned as control="stop") the
    handler uses to cancel the in-flight generation (spec §5 Stop).
    """
    stripped = raw.lstrip()
    if stripped.startswith("{"):
        import json as _json

        try:
            obj = _json.loads(raw)
        except _json.JSONDecodeError:
            return raw, None, False, None
        if obj.get("type") in ("stop", "confirm_yes", "confirm_no"):
            return "", None, False, obj["type"]
        return obj.get("message", raw), obj.get("model"), bool(obj.get("web", False)), None
    return raw, None, False, None


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket) -> None:
    """Real-time streaming chat with cooperative cancellation (spec §5/§12).

    Protocol: client sends a user message (plain text or ``{message, model?, web?}``)
    and the server streams ``{"type":"chunk"|"activity"|"sources"|"memory"}`` events
    then a final ``{"type":"done", "text", "stopped"?}``. A ``{"type":"stop"}`` frame
    cancels the current turn; the partial answer is kept and finalized honestly.

    Only one generation runs at a time (spec §4): a new prompt arriving mid-turn is
    ignored server-side (the composer keeps it safely in the draft).
    """
    await websocket.accept()
    current: asyncio.Task | None = None
    pending: dict = {}  # a confirm-gated action awaiting the user's yes/no

    async def confirm_action(approve: bool) -> None:
        action = pending.pop("action", None)
        if not action:
            return
        if not approve:
            msg = "Okay — cancelled. I didn't do it."
            _memory.add_assistant(msg)
            await websocket.send_json({"type": "chunk", "text": msg})
            await websocket.send_json({"type": "done", "text": msg})
            return
        from backend.tools import registry as tools

        result = await tools.execute(action["tool"], action["args"], confirm=True)
        text = result.summary or ("Done." if result.ok else "That didn't work.")
        _memory.add_assistant(text)
        await websocket.send_json({"type": "chunk", "text": text})
        await websocket.send_json({"type": "done", "text": text})

    async def run_turn(message: str, model: str | None, web: bool) -> None:
        # Built-in commands (email/calendar/spotify) answer directly, no stream.
        command_reply = await commands.handle_command(message)
        if command_reply is not None:
            _memory.add_user(message)
            _memory.add_assistant(command_reply)
            await websocket.send_json({"type": "done", "text": command_reply})
            return

        history = _memory.history()
        prompt = await _augment_with_memory(message)
        collected: list[str] = []

        async def on_text(t: str) -> None:
            collected.append(t)
            await websocket.send_json({"type": "chunk", "text": t})

        async def on_activity(ev) -> None:
            await websocket.send_json({"type": "activity", "label": ev.label, "ok": ev.ok})

        async def on_sources(srcs: list) -> None:
            await websocket.send_json({"type": "sources", "sources": srcs})

        async def on_memory(note: str) -> None:
            await websocket.send_json({"type": "memory", "note": note})

        async def on_confirm(info: dict) -> None:
            pending["action"] = {"tool": info["tool"], "args": info["args"]}
            await websocket.send_json(
                {"type": "confirm", "tool": info["tool"], "args": info["args"], "prompt": info["prompt"]}
            )

        # Route chat through the orchestrator: streams tokens live AND can use
        # tools (web search, system, Mac) in the same turn (spec §9/§13/§19).
        from backend.agents import orchestrator

        try:
            reply = await orchestrator.run_stream(
                prompt, history=history, model=model, force_web=web,
                on_text=on_text, on_activity=on_activity, on_sources=on_sources, on_memory=on_memory,
                on_confirm=on_confirm,
            )
        except asyncio.CancelledError:
            # User pressed Stop — keep whatever streamed so far and finalize honestly.
            reply = "".join(collected).strip()
            _memory.add_user(message)
            _memory.add_assistant(reply)
            with contextlib.suppress(Exception):
                await websocket.send_json({"type": "done", "text": reply, "stopped": True})
            return
        except Exception as first_exc:
            # Upstream 5xx / auth on the selected model: retry once on the default
            # tool-capable model. If that also fails, fall through to the honest
            # error handler below.
            status = getattr(getattr(first_exc, "response", None), "status_code", None)
            from backend.config import DEFAULT_MODEL
            transient = (status is not None and status >= 500) or "timeout" in str(first_exc).lower()
            if transient and model and model != DEFAULT_MODEL:
                fb_notice = f"⚠️ {model} is unreachable ({status or 'error'}). Falling back to {DEFAULT_MODEL}…\n\n"
                await websocket.send_json({"type": "chunk", "text": fb_notice})
                collected.append(fb_notice)
                try:
                    reply = await orchestrator.run_stream(
                        prompt, history=history, model=DEFAULT_MODEL, force_web=web,
                        on_text=on_text, on_activity=on_activity, on_sources=on_sources, on_memory=on_memory,
                        on_confirm=on_confirm,
                    )
                    reply = (fb_notice + reply).strip()
                    _memory.add_user(message)
                    if reply:
                        _memory.add_assistant(reply)
                    await websocket.send_json({"type": "done", "text": reply, "awaiting_confirm": bool(pending.get("action"))})
                    return
                except Exception as fb_exc:
                    first_exc = fb_exc  # fall into the honest error handler below
            exc = first_exc  # keep the variable name the block below expects
            # Meaningful error even when the exception carries no message
            # (common for httpx HTTPStatusError). Include the status/kind so
            # the user can act — switch model, retry, check network.
            kind = type(exc).__name__
            detail = str(exc).strip()
            # httpx.HTTPStatusError exposes .response.status_code
            status = getattr(getattr(exc, "response", None), "status_code", None)
            hint = ""
            if status:
                if status >= 500:
                    hint = " The model provider is having trouble (5xx). Try again in a moment, or switch to another model."
                elif status == 429:
                    hint = " Rate-limited — wait a few seconds and retry."
                elif status == 401 or status == 403:
                    hint = " The provider rejected the request (auth). Check API keys in Settings → Connectors."
                elif status == 404:
                    hint = " The selected model isn't available on this provider — pick a different one from the model menu."
            elif not detail:
                detail = kind  # fall back to exception class name
            print(f"[chat] error: {kind}: {detail!r} status={status}", flush=True)
            body = detail[:200] if detail else kind
            reply = f"Scout couldn't complete that request right now. ({body}){hint}"
            await websocket.send_json({"type": "chunk", "text": reply})
        reply = reply.strip()
        _memory.add_user(message)
        if reply:
            _memory.add_assistant(reply)
        await websocket.send_json({"type": "done", "text": reply, "awaiting_confirm": bool(pending.get("action"))})

    try:
        while True:
            raw = await websocket.receive_text()
            message, model, web, control = _parse_ws(raw)

            if control == "stop":
                if current and not current.done():
                    current.cancel()
                continue

            if control in ("confirm_yes", "confirm_no"):
                asyncio.create_task(confirm_action(control == "confirm_yes"))
                continue

            # One generation at a time — drop prompts that arrive mid-turn (spec §4).
            if current and not current.done():
                continue

            current = asyncio.create_task(run_turn(message, model, web))
    except WebSocketDisconnect:
        if current and not current.done():
            current.cancel()
        return


async def voice_loop(wake: bool = False) -> None:
    """Wire STT -> LLM -> TTS into one continuous spoken conversation loop.

    Blocking audio calls (mic capture, playback) are pushed onto threads so the
    async LLM streaming is never starved. Ctrl-C to stop. With ``wake=True`` the
    loop stays dormant until it hears "Hey JARVIS" (Phase 5 wake word).
    """
    # Imported lazily so the HTTP server can start without audio dependencies.
    from backend.voice import stt, tts

    memory = ShortTermMemory()

    # Warm up models up front so the first reply isn't delayed by the one-time
    # load (~seconds), and so any load failure surfaces now.
    print("[JARVIS] Warming up speech models...")
    await asyncio.to_thread(tts.preload)
    if wake:
        from backend.voice import wake as wake_mod

        await asyncio.to_thread(wake_mod.preload)

    # Audible startup greeting — an immediate self-test that audio output works.
    greeting = f"{PRODUCT_NAME} online. All systems operational, {USER_NAME}."
    print(f"[{PRODUCT_NAME}] {greeting}")
    await asyncio.to_thread(tts.speak, greeting)

    if wake:
        print("[JARVIS] Wake mode. Say 'Hey JARVIS' to activate (Ctrl-C to quit).")
    else:
        print("[JARVIS] Voice loop ready. Say something (Ctrl-C to quit).")

    while True:
        if wake:
            from backend.voice import wake as wake_mod

            print("[JARVIS] Waiting for 'Hey JARVIS'...")
            await asyncio.to_thread(wake_mod.wait_for_wake)
            await asyncio.to_thread(tts.speak, "Yes, sir?")

        print("[JARVIS] Listening...")
        text = await asyncio.to_thread(stt.listen)
        if not text:
            continue
        print(f"[you] {text}")

        reply = await commands.handle_command(text)
        if reply is None:
            prompt = await _augment_with_memory(text)
            reply = await llm.chat(prompt, history=memory.history())
        memory.add_user(text)
        memory.add_assistant(reply)
        print(f"[JARVIS] {reply}")

        print("[JARVIS] Speaking...")
        await asyncio.to_thread(tts.speak, reply)


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="JARVIS backend")
    parser.add_argument(
        "--voice",
        action="store_true",
        help="Run the spoken STT->LLM->TTS conversation loop instead of the server.",
    )
    parser.add_argument(
        "--wake",
        action="store_true",
        help="With --voice: stay dormant until 'Hey JARVIS' is heard (Phase 5).",
    )
    args = parser.parse_args()

    if args.voice:
        try:
            asyncio.run(voice_loop(wake=args.wake))
        except KeyboardInterrupt:
            print("\n[JARVIS] Powering down voice loop.")
    else:
        import uvicorn

        uvicorn.run(app, host="0.0.0.0", port=BACKEND_PORT)


if __name__ == "__main__":
    _main()
