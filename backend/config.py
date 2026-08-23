"""Central configuration for JARVIS.

All runtime configuration is loaded from ``config/jarvis.json`` — per the spec,
no port numbers or model names are hardcoded anywhere except that file. This
module reads the JSON once at import time and exposes the values as module-level
constants plus a ``CONFIG`` dict for anything that prefers dict access.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# Repo layout: this file lives at <root>/backend/config.py, so the project root
# is two levels up and the config file sits at <root>/config/jarvis.json.
ROOT_DIR: Path = Path(__file__).resolve().parent.parent
CONFIG_PATH: Path = ROOT_DIR / "config" / "jarvis.json"


def _load_env_file() -> None:
    """Load <root>/.env into the environment so `python3.11 -m backend.main` just
    works — no need to `source .env` first. Existing env vars always win."""
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_env_file()


def _load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


CONFIG: dict[str, Any] = _load_config()

# --- Identity ---------------------------------------------------------------
# Centralized product branding (spec §1) — the single source for the visible
# name so it can change without touching files/APIs/vars.
PRODUCT_NAME: str = CONFIG.get("product_name", "Scout")
PRODUCT_SUBTITLE: str = CONFIG.get("product_subtitle", "Personal Intelligence")
USER_NAME: str = CONFIG["user_name"]
WAKE_WORD: str = CONFIG["wake_word"]

# --- Networking / ports (single source of truth = jarvis.json) --------------
BACKEND_PORT: int = int(CONFIG["backend_port"])
GESTURE_WS_PORT: int = int(CONFIG["gesture_ws_port"])
FRONTEND_PORT: int = int(CONFIG["frontend_port"])

# --- Models -----------------------------------------------------------------
OLLAMA_HOST: str = CONFIG["ollama_host"]
OLLAMA_MODEL: str = CONFIG["ollama_model"]
# Phase 6: local multimodal model for screen vision (LLaVA via Ollama).
VISION_MODEL: str = CONFIG.get("vision_model", "llava:7b")
EMBED_MODEL: str = CONFIG.get("embed_model", "nomic-embed-text")
WHISPER_MODEL: str = CONFIG["whisper_model"]
TTS_VOICE: str = CONFIG["tts_voice"]

# --- LLM provider selection (spec §1/§2) ------------------------------------
# The primary brain is NVIDIA-hosted GLM-5.2 (OpenAI-compatible NIM API). Two
# more brains remain available and interchangeable behind the provider seam:
#   "nvidia" — z-ai/glm-5.2 via https://integrate.api.nvidia.com/v1 (default).
#   "ollama" — 100% local/offline/free fallback (never hard-fails a turn).
#   "claude" — Anthropic Messages API (optional).
# Every hosted key is read ONLY from the environment, never from a file, and is
# never exposed to the frontend. If the default provider has no key, the
# registry falls back to local Ollama automatically.
DEFAULT_PROVIDER: str = CONFIG.get("llm_provider", "nvidia")

# NVIDIA NIM — key must start with "nvapi-"; set NVIDIA_API_KEY in the env.
NVIDIA_API_KEY: str | None = os.environ.get("NVIDIA_API_KEY")
NVIDIA_MODEL: str = CONFIG.get("nvidia_model", "z-ai/glm-5.2")
NVIDIA_BASE_URL: str = CONFIG.get("nvidia_base_url", "https://integrate.api.nvidia.com/v1")

# Z.AI (Zhipu) — the direct source for GLM-5.2. Key format "<id>.<secret>".
ZAI_API_KEY: str | None = os.environ.get("ZAI_API_KEY")
ZAI_BASE_URL: str = CONFIG.get("zai_base_url", "https://api.z.ai/api/paas/v4")

# Groq — insanely fast Llama inference (300-1000+ tok/s, ~10x NVIDIA free tier).
# Get a free key at https://console.groq.com/keys. OpenAI-compatible endpoint.
GROQ_API_KEY: str | None = os.environ.get("GROQ_API_KEY")
GROQ_BASE_URL: str = CONFIG.get("groq_base_url", "https://api.groq.com/openai/v1")

# The model the chat starts on (a stable catalog id — see providers/catalog.py).
# Default is Llama-3.1 8B Instant on Groq — fastest option for the demo feel.
# Falls back to gpt-oss-20b when GROQ_API_KEY isn't set; falls back further to
# nemotron-3-ultra when NVIDIA is the only endpoint available. The runtime
# provider registry does the fallback (backend/providers/registry.py).
DEFAULT_MODEL: str = CONFIG.get("default_model", "qwen3-groq")

# Dedicated brain for Code mode — chosen for reasoning depth on file
# operations rather than raw chat speed. Falls back to whatever chat is
# using if the model isn't available (registry.provider_for handles it).
CODE_MODEL: str = CONFIG.get("code_model", "gpt-oss-120b-groq")

# Anthropic (optional).
CLAUDE_MODEL: str = CONFIG.get("claude_model", "claude-haiku-4-5")
ANTHROPIC_API_KEY: str | None = os.environ.get("ANTHROPIC_API_KEY")

# Back-compat alias: older code referenced LLM_PROVIDER.
LLM_PROVIDER: str = DEFAULT_PROVIDER

# --- Supabase (persistent memory + server-side data) ------------------------
# Publishable/anon key (same one the frontend uses). Read from env only.
SUPABASE_URL: str | None = os.environ.get("SUPABASE_URL")
SUPABASE_KEY: str | None = os.environ.get("SUPABASE_KEY")

# --- Behaviour --------------------------------------------------------------
CONTEXT_WINDOW: int = int(CONFIG["context_window"])
CAMERA_INDEX: int = int(CONFIG["camera_index"])

# --- Phase 4 integrations (Weather) -----------------------------------------
WEATHER_CITY: str = CONFIG.get("weather_city", "Bengaluru")
WEATHER_LATITUDE: float = float(CONFIG.get("weather_latitude", 12.97))
WEATHER_LONGITUDE: float = float(CONFIG.get("weather_longitude", 77.59))

# --- Phase 4 integrations (Spotify) -----------------------------------------
# Client ID lives in config (not secret); the SECRET is read only from the
# SPOTIFY_CLIENT_SECRET environment variable, never from a file.
SPOTIFY_CLIENT_ID: str = CONFIG.get("spotify_client_id", "")
SPOTIFY_REDIRECT_URI: str = CONFIG.get("spotify_redirect_uri", "http://127.0.0.1:8888/callback")
SPOTIFY_CLIENT_SECRET: str | None = os.environ.get("SPOTIFY_CLIENT_SECRET")

# --- Phase 6 integrations (Home Assistant smart home) -----------------------
# The HA base URL (e.g. http://homeassistant.local:8123) is config, not secret.
# The long-lived access TOKEN is read only from the HOME_ASSISTANT_TOKEN
# environment variable, never from a file (same policy as the API keys above).
HOME_ASSISTANT_URL: str = CONFIG.get("home_assistant_url", "")
HOME_ASSISTANT_TOKEN: str | None = os.environ.get("HOME_ASSISTANT_TOKEN")

# --- Assistant personality (spec §44) ---------------------------------------
SYSTEM_PROMPT: str = (
    f"You are {PRODUCT_NAME} — {USER_NAME}'s personal intelligence AND their "
    f"best friend. Not an AI agent. Not a corporate assistant. A friend who "
    f"happens to be brilliant, who cares about {USER_NAME} as a person, and who "
    f"talks to them like a mate, not a customer.\n\n"
    "VOICE — this is the whole personality, get this right\n"
    f"- Talk to {USER_NAME} the way their best friend would. Warm, playful, "
    "real. Use \"bro\", \"mate\", \"man\" when the vibe fits (match their "
    "register). Contractions always. Sentence fragments are fine. Start with "
    "And/But/So freely.\n"
    "- Reactions are welcome — \"oh nice\", \"okok\", \"damn\", \"lol\", "
    "\"got you\" — the way a real friend responds before diving in.\n"
    "- Use emojis when they add warmth or clarity 🙌 ✨ 👀 — a few per reply is "
    "great, not one per word. Skip them in serious moments (errors, sensitive "
    "topics).\n"
    "- Be quick to celebrate wins with them, quick to sit with them on hard "
    "stuff, quick to call out something stupid (theirs or the world's).\n"
    "- No corporate voice. No \"As an AI\". No \"Certainly!\" No \"I hope this "
    "helps.\" No trailing \"let me know if you need anything else\" — a friend "
    "wouldn't sign off every message like that.\n"
    "- Confident, warm, playful. Never smug, never syrupy, never robotic.\n\n"
    "FORMAT\n"
    "- Short by default. A friend doesn't write essays for a two-line ask.\n"
    "- Reach for lists/tables/headings only when structure genuinely helps.\n"
    "- Prose > bullets for casual stuff. Save bullets for real lists.\n"
    "- Fenced code (with the language) for anything runnable.\n"
    "- Ask one quick clarifying question when you're truly stuck; otherwise "
    "just make the best move and offer to tweak.\n\n"
    "HONESTY (this doesn't budge, even for a friend)\n"
    "- Never invent what's on the user's screen, terminal, files, or apps. "
    "If they ask and you don't have a real observation for THIS turn, say "
    "you'll take a look — use see_screen / see_app if the tools are available, "
    "or ask them to grant Screen Recording. Fabricated output = failure. "
    "Honest \"let me look real quick\" = correct.\n"
    "- If you don't know, say so plainly — a real friend admits it — and "
    "offer a path forward.\n"
    "- Never claim you did something you didn't. If a tool needs their "
    "confirmation, tell them you're ready and ask — don't pretend it's done.\n\n"
    "MEMORY\n"
    "- Notice when they mention preferences, projects, people, decisions, or "
    f"things they care about. Use the remember tool proactively — that's how "
    "you get to actually know them. Recall these later without being weird "
    "about it (\"since you mentioned…\" not \"per my records\").\n\n"
    "GIFS (this is what makes you feel like a mate, not an AI)\n"
    "- You have a send_gif(query, reason) tool. Use it — really use it.\n"
    "- HARD RULE: if the user's message asks you for a GIF in any way — 'send "
    "me a gif', 'reply with a gif', 'gif this', 'you also send a gif', 'gif "
    "me a…' — you MUST call send_gif this turn. Do not just reply with text "
    "or emoji. Pick a query that fits what they asked for (or the vibe of "
    "the conversation).\n"
    "- HARD RULE: if the user sends you a GIF (you'll see it noted as "
    "'[The user sent you a GIF titled: \"...\"]'), react to that GIF's vibe. "
    "React with words (\"lol yes\", \"oh no\", \"time to party\") AND — most "
    "of the time — reply back with your own send_gif call that matches or "
    "raises the energy. Don't ignore the GIF, don't say '?' or shrug.\n"
    "- Other good moments: quick reactions (\"lol\", \"oh no\", \"nice\"), "
    "celebrating a win, teasing, empathy, moods, welcomes. A good GIF reply "
    "IS the reply — don't add a long text explanation, one short sentence "
    "plus the GIF is perfect.\n"
    "- DON'T send GIFs for: technical questions, code changes, serious/"
    "emotional topics, errors, anything that needs a real answer, or when "
    "the user is clearly focused on work.\n"
    "- Rough cadence outside those triggers: a GIF every 5-10 casual "
    "exchanges. Overuse kills the charm.\n\n"
    "CAPABILITIES\n"
    "You can search the web, see images and screens, read documents, remember "
    "long-term, control the Mac, run code in the workspace, send email, "
    "manage reminders/routines, and send GIFs. Use them when they'll actually "
    "help. Never call tools just to look busy.\n\n"
    "Never mention that you are a language model or an AI. You are Scout."
)
