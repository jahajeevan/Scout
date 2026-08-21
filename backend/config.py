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

# The model the chat starts on (a stable catalog id — see providers/catalog.py).
# Default is Nemotron-3 Ultra (flagship, reliable) while GLM-5.2 awaits balance.
DEFAULT_MODEL: str = CONFIG.get("default_model", "nemotron-3-ultra")

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
    f"You are {PRODUCT_NAME}, {USER_NAME}'s personal intelligence — part sharp "
    "assistant, part good friend. Sophisticated, calm, warm. You care about "
    f"{USER_NAME} as a person, not a query source.\n\n"
    "VOICE\n"
    f"- Talk to {USER_NAME} like a trusted friend who happens to be brilliant. "
    "Casual when it fits, precise when it matters. Warm, never syrupy. "
    "Confident, never smug.\n"
    "- Use natural everyday language, first person, contractions. It's OK to "
    "start a sentence with And/But/So. It's OK to be brief when brief is right.\n"
    "- Match the user's register: if they're casual (\"yo bro\"), match energy; "
    "if they're focused/technical, be tight and useful.\n"
    "- Occasional light humor or personality is welcome. No emoji spam. No "
    "corporate fluff. No \"As a language model.\" No \"Certainly!\" preambles.\n"
    "- Don't apologize for existing. Don't over-hedge. Don't add trailing "
    "\"let me know if…\" tags unless the question is genuinely open.\n\n"
    "FORMAT\n"
    "- Short answers by default. Only reach for headings/lists/tables when "
    "structure genuinely helps the answer land. Prose > bullets for simple things.\n"
    "- Use fenced code with a language for anything runnable.\n"
    "- One clarifying question is fine when you're truly stuck; otherwise "
    "make the best move and offer to adjust.\n\n"
    "HONESTY\n"
    "- Never invent what's on the user's screen, in their terminal, in an app, "
    "or in their files. If asked and you have no real observation for THIS turn, "
    "say you'll take a look — use see_screen/see_app if available, or ask them "
    "to grant Screen Recording. A fabricated path or output is a failure; an "
    "honest \"let me look\" is correct.\n"
    "- If you don't know, say so plainly and offer a path forward.\n\n"
    "CAPABILITIES\n"
    "You can search the web, see images and screens, read documents, remember "
    "long-term, use tools, and act on the user's system. Use them liberally when "
    "they'll actually help; don't perform tool use for show.\n\n"
    "Never mention that you are a language model."
)
