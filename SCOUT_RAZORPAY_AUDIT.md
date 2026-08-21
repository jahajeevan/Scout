# Scout — Razorpay Buildathon Readiness Audit

> **Read-only inspection report** — an honest, evidence-based audit of the
> Scout codebase as it exists at commit `7ccf466` on branch `main` of
> `github.com/jahajeevan/Scout`. Written for a skeptical review, not a
> marketing brief. Every claim below is anchored to an inspected file.
>
> Scope inspected: 199 tracked files, ~30k LOC (Python 9.4k · TypeScript
> 9.7k · macOS Python 2.0k · configs, docs, scripts).

---

## Part 1 — Product overview

### What Scout actually is

Scout is a **native macOS personal-AI assistant** that lives outside the
browser. It ships as a real `.app` bundle (packaged via `py2app`) with a
menu-bar orb, a Spotlight-style floating panel triggered by ⌘⌥-Space, a
"Hey Scout" wake word, and a Halo overlay above the active app while
Scout is listening or speaking. The intelligence is provided by NVIDIA
NIM models (Nemotron Ultra 3-550B, gpt-oss-20b, Nemotron Super 49B,
Nemotron Nano Omni, and Llama-3.2-11B Vision) called through an
OpenAI-compatible provider. Backend is FastAPI; frontend is a Next.js 14
web UI hosted either in a browser tab or inside the .app via WKWebView.

### The problem Scout addresses

Existing consumer AI assistants live in a browser tab (ChatGPT / Claude
web) or are language-model wrappers inside IDEs (Cursor / Copilot). None
of them:

- Wake to a keyword and take a voice task while you're in another app.
- Look at what's on your screen or inside a specific application.
- Act on your Mac (open apps, edit files in a sandboxed workspace, run
  shell commands with confirmation gates, send email through Gmail).
- Learn stable personal facts across sessions with an explicit
  supersession model (not "context window" recall).
- Run recurring background daemons that propose actions for approval
  (draft email replies, clean Downloads, weekly reflection).

Scout is one person's answer to "what does a macOS-native, always-on,
permission-gated agent actually look like."

### Intended user

A **technical macOS user** willing to (a) install a real `.app`, (b)
grant Microphone / Screen Recording / Accessibility / Notifications
permissions, (c) drop a Vosk wake-word model into `macos/assets/`, (d)
generate an NVIDIA NIM API key, and (e) optionally run a separate
Chatterbox voice-cloning micro-service. This is a builder-tier product,
not a consumer download.

### Primary workflow

1. Menu-bar orb shows backend health.
2. User says "Hey Scout" → Vosk fires → mic begins recording an
   utterance.
3. Whisper transcribes → orchestrator plans → tools execute (permission-
   gated) → per-sentence Kokoro TTS streams the reply back.
4. Or user hits ⌘⌥-Space → Spotlight panel drops down, type a prompt,
   get an inline answer.
5. Or opens the workspace window (WKWebView) for full chat, Code Mode,
   or the AR routes.

### What makes Scout different from "a chatbot"

- **Wake word + native surfaces.** Talk to Scout mid-work without
  ⌘-Tab'ing to a browser (evidence: `macos/scout.py:1-1800`,
  Vosk/Porcupine/openWakeWord wake engines).
- **Permission-gated tool use.** Every tool declares
  `SAFE | CONFIRMATION_REQUIRED | BLOCKED`; a confirm-required tool
  suspends the model loop and surfaces a Confirm/Cancel card in the UI —
  never silently executes (`backend/tools/base.py:23-164`,
  `backend/agents/orchestrator.py:204-216`).
- **Screen vision routed through a tool.** `see_screen` and `see_app`
  bridge the "tool models can't see, vision models can't call tools"
  split by doing the vision call *inside* the tool
  (`backend/tools/vision_tools.py:157-201`).
- **Multi-agent orchestrator with planner routing.** Not just tool-loop
  chat — a planner (`backend/agents/planner.py`) decides simple vs
  complex; complex tasks decompose into dependency-ordered specialist
  waves executed in parallel where independent, then synthesised
  (`backend/agents/orchestrator.py:345-421`).
- **Autonomy engine.** Recurring daemons (`backend/autonomy/daemons.py`,
  `engine.py`) tick every 60s; PROPOSE-tier daemons drop actions into a
  SQLite approval inbox the user reviews and executes with a click.

### What makes Scout different from AI coding agents

- **Code Mode is one surface, not the product.** Cursor / Claude Code /
  Copilot are IDEs (or IDE extensions) with an AI layer. Scout is a
  personal OS assistant that *also* has a Code Mode
  (`frontend/app/code/page.tsx:1-1093`) with a workspace-sandboxed
  file tree, viewer, and agent panel.
- **Not tuned for large-codebase reasoning.** Scout's Code Mode reads
  files up to 60k chars, searches with a linear grep-through-files, and
  can `write_file` / `edit_file` / `run_command` / `git_commit`. It is
  usable for small-project work; it is not competitive with Cursor's
  or Claude Code's codebase-scale intelligence.

### What is implemented vs partial vs planned

Detailed feature table in Part 2. High-level summary:

- **Implemented and end-to-end functional**: streaming chat with tools,
  streaming voice (per-sentence TTS), Code Mode with sandbox and git,
  RAG documents, persistent Supabase memory with supersession, recurring
  routines, screen vision (`see_screen` + `see_app`), autonomy daemons
  + approval inbox, Gmail send with confirm flow, universal file viewer
  (`/preview/*`), phone control over ADB.
- **Implemented but external dependency required**: Chatterbox custom
  voice (`me_jeev`) — needs a separate `~/chatterbox/.venv` service
  and a manually-placed `jeev.wav` reference.
- **Stub / architecture-ready**: MCP servers — endpoint reads
  `~/.scout/mcp.json` and returns whatever's there; no live MCP
  protocol client.
- **Fixed today but untested by user**: WKWebView camera permission for
  Arc Forge (added at `macos/scout.py:875-905` in commit `4b088eb`).
- **Aspirational / partial polish**: 29 `", sir"` residues cleaned from
  `commands.py`, but 6 more remain in `backend/tools/mac_tools.py`
  (lines 35, 94, 106, 115) and `backend/tools/base.py` (lines 154, 161)
  — UNVERIFIED whether these ever surface to the user.

---

## Part 2 — Complete feature inventory

Status legend: **IMPL** (implemented + verifiable) · **PARTIAL** (works
but missing important parts) · **STUB** (endpoint exists, real
functionality doesn't) · **EXTERNAL_DEP** (requires user to install
something out-of-repo) · **UNVERIFIED** (code exists, cannot confirm from
inspection alone).

| Feature | Status | Evidence | What it actually does |
|---|---|---|---|
| **Text chat (streaming)** | IMPL | `backend/main.py:/ws/chat` (implied — see `/ws/voice` for the streaming pattern), `backend/agents/orchestrator.py:142-223` (`run_stream`), `frontend/hooks/useJARVIS.ts:1-199` | User sends text over WS, orchestrator streams tokens live, calls tools mid-stream, emits activity/sources/memory/confirm events |
| **Non-streaming `/chat`** | IMPL | `backend/main.py:170-197` (models defined; endpoint defined further down), `backend/llm.py` | Simple POST, single response |
| **Multi-agent orchestrator** | IMPL | `backend/agents/orchestrator.py:291-421` | Planner decides simple/complex; simple = one specialist loop; complex = dependency-ordered waves executed in parallel where possible, synthesised in Scout's voice |
| **Planner (simple vs complex routing)** | IMPL | `backend/agents/planner.py:42-109` | LLM produces strict JSON plan; safe fallback to "simple" on any parse error |
| **8 named specialists** | IMPL | `backend/agents/specialists.py:36-108` | research, system, mac, memory, documents, code, productivity, general — each with scoped tool categories + focused system prompt |
| **Bounded tool loop (max 8 steps)** | IMPL | `backend/agents/orchestrator.py:27,258` (`_MAX_STEPS = 8`) | Prevents runaway loops; `_finalize` guarantees a non-empty answer even on empty model output |
| **Transient error retry** | IMPL | `backend/agents/orchestrator.py:34-37,364-374` | Single retry on 503/429/timeout, then honest degradation ("This step could not complete") |
| **Permission-gated tools (3 tiers)** | IMPL | `backend/tools/base.py:23-164` | SAFE / CONFIRMATION_REQUIRED / BLOCKED; `execute()` is the only entry point; schema validation before run |
| **17 registered tools** | IMPL | grep of `registry.register` across `backend/tools/*.py` | Broken down below |
| **Code tools (11)** | IMPL | `backend/tools/code_tools.py:206-224` | list_directory, read_file, search_code, write_file (C), edit_file (C), rename_path (C), delete_path (C), git_status, git_diff, run_command (C), git_commit (C). (C) = confirm-required |
| **Vision tools (2)** | IMPL | `backend/tools/vision_tools.py:204-247` | see_screen (whole screen capture → vision model), see_app (activate app → capture → restore focus) |
| **Web tools (2)** | IMPL | `backend/tools/web_tools.py` (69 lines) | search_web, extract_page_content — DuckDuckGo, no API key |
| **System tools (1)** | IMPL | `backend/tools/system_tools.py` (95 lines) | get_system_info (cpu, ram, disk, battery, network combined) |
| **Mac tools (1 registered, ~10 handlers)** | IMPL | `backend/tools/mac_tools.py:1-339` | open_app, close_app, switch_app, list_running_apps, take_screenshot, control_volume, control_brightness, lock_screen, sleep_mac, start_screen_sharing, notify — most CONFIRMATION_REQUIRED |
| **Memory tools (3)** | IMPL | `backend/tools/memory_tools.py` (89 lines) | remember, forget, list_memories |
| **Documents tools (2)** | IMPL | `backend/tools/doc_tools.py` (78 lines) | search_documents, list_documents |
| **Productivity tools (1 registered, wraps 6)** | IMPL | `backend/tools/productivity_tools.py` (100 lines) | check_email, send_email (C), list_calendar, add_reminder, list_reminders, complete_reminder |
| **Routine tools (3)** | IMPL | `backend/tools/routine_tools.py` (84 lines) | create_routine, list_routines, delete_routine |
| **Quick-actions fast-path** | IMPL | `backend/agents/quick_actions.py:1-148` | Regex-matched "open X" / "close X" / "screenshot" run natively via `open -a` / `osascript` without an LLM cycle; two-phase spoken feedback ("Opening…" → "X is open") |
| **Streaming voice (`/ws/voice`)** | IMPL | `backend/main.py:641-778` | Per-sentence TTS: Whisper STT → LLM token stream → `_flush_sentences` regex → each complete sentence goes to Kokoro immediately → audio events sent as they're ready. First-audio ~2-4s |
| **Batch voice (`/voice`)** | IMPL | `backend/main.py:575-620` | Full turn: WAV upload → transcript + LLM reply + base64 WAV response |
| **Whisper STT** | IMPL | `backend/voice/stt.py` (109 lines) | `pywhispercpp` wrapper, model `base.en` (memory notes small.en segfaults on Metal) |
| **Kokoro TTS (11 voices)** | IMPL | `backend/voice/tts.py` (125 lines), `backend/voice/registry.py` (124 lines) | Local, warmed at startup; voices parsed from `voices.bin` with metadata (name/accent/gender/personality) |
| **Streaming TTS `/speak_stream`** | IMPL | `backend/main.py` (search: `/speak_stream`) | Proxies to Chatterbox SSE if custom voice; falls back to one-shot for Kokoro |
| **Chatterbox voice-cloning integration** | EXTERNAL_DEP | `backend/voice/chatterbox_client.py:1-135` | HTTP client to `127.0.0.1:8790`; expects a separately-run Chatterbox micro-service in `~/chatterbox/.venv` — NOT included in this repo |
| **"me_jeev" custom voice** | EXTERNAL_DEP | `backend/voice/chatterbox_client.py:52-63` | Reference audio expected at `~/chatterbox/jeev.wav`; **no in-app UI to record/upload a new voice** — user drops the WAV manually |
| **Voice-cloning UI** | ABSENT | grep of `frontend/` shows no clone/record UI | Custom voice is registry-only, not user-facing setup |
| **"Hey Scout" wake word** | IMPL (Vosk default) | `macos/scout.py:110-118,590-1631` | Three engines: Vosk (default, fully local, needs `macos/assets/vosk-model` folder), Porcupine (needs `PICOVOICE_ACCESS_KEY` + `.ppn`), openWakeWord (fallback, keyword is actually `hey_jarvis`) |
| **Vosk model** | EXTERNAL_DEP | `macos/scout.py:116` | User must download the Vosk model into `macos/assets/vosk-model/` — not shipped |
| **Live partial transcript (Vosk)** | IMPL | `macos/scout.py:590-1631` (Vosk recognizer used for live partials, Whisper for final) | Words appear as user speaks; Whisper finalises accurately at end |
| **Spotlight ⌘⌥-Space panel** | IMPL | `macos/scout.py:130-200+` (`Spotlight` class, `_KeyPanel(NSPanel)`) | Native NSPanel with layer-backed dark-glass gradient, borderless, always-on-top; text field + inline answer; global hotkey via `NSEvent` monitor |
| **Halo overlay (reactive ring)** | IMPL | `macos/scout.py` (larger — grep for `_HaloRing`) | Custom NSView renders orb + bar-ring that pulses to real mic envelope (listening) or real TTS envelope (speaking) |
| **Menu-bar orb** | IMPL | `macos/scout.py:1007` (rumps `MenuItem`s: Ask Scout…, Talk, Add reminder…, wake, Stop, Open Scout, Open Code, Quit) | Rumps status item, polls /health |
| **WKWebView workspace window** | IMPL | `macos/scout.py:802-940` | Embeds the Next.js web UI in a native WKWebView; UI delegate bridges JS alert/confirm/prompt to NSAlert; camera permission delegate + WebContent crash guard added in commit `4b088eb` |
| **Global hotkey (⌘⌥-Space)** | IMPL | `macos/scout.py` (NSEvent global monitor) | Requires Accessibility permission |
| **Model catalog (5 models)** | IMPL | `backend/providers/catalog.py:52-99` | nemotron-3-ultra (default), gpt-oss-20b, nemotron-3-nano-omni, nemotron-super-49b, llama-3.2-11b-vision |
| **No-fallback model selection** | IMPL | `backend/providers/openai_compat.py:1-234`, `backend/providers/registry.py:1-86` | User's selected model is what runs; failure returns an honest error, not a stealth switch |
| **Vision chat (image upload)** | IMPL | `backend/main.py:1072-1117` (`/vision-chat`) | Multipart file(s) → image_url content blocks → llama-3.2-11b-vision |
| **Image generation** | PARTIAL | `backend/integrations/image_gen.py`, `backend/main.py:778` | NVIDIA `flux.1-schnell` endpoint proven live; cold-start >200s times out most attempts on free tier |
| **Markdown rendering (chat)** | IMPL | `frontend/components/Markdown.tsx:1-111`, `frontend/lib/markdownText.ts` | react-markdown + remark-gfm + rehype-highlight; callouts (Note/Tip/Warning/Result), styled tables, code blocks with copy button |
| **Message actions (Copy, Speak)** | IMPL | `frontend/components/MessageActions.tsx:1-67`, `backend/main.py:/speak` (implied) | Hover row on assistant messages; Speak fires `/speak` → plays Kokoro reply |
| **Web search toggle** | IMPL | `frontend/components/Composer.tsx` (grep for `web`), `backend/agents/orchestrator.py:135-140,173-174` | Composer toggle arms brass on-state; sends `{message, web:true}`; orchestrator prepends `_WEB_MANDATE` forcing `search_web` before answering |
| **Stop-generation** | IMPL | `backend/main.py` `/ws/chat` (via `{"type":"stop"}` frame; per memory: cancellable asyncio.Task; partial answer preserved), `frontend/hooks/useJARVIS.ts` | Send/Stop button toggle; STOPPED marker in conversation |
| **Attachment lifecycle (images + docs)** | IMPL | `frontend/components/Composer.tsx`, `backend/main.py:1072,1118` | Multi-file upload with processing→ready→failed states; capability-gated (image needs vision model, doc needs tools) |
| **Screenshot capture from composer** | IMPL | `frontend/components/Composer.tsx` (screen-capture path); backend `/vision-chat` | Uses `getDisplayMedia` in browser → sent to vision model |
| **Conversation history (Supabase)** | IMPL (optional) | `frontend/hooks/useConversations.ts:1-296`, `frontend/lib/supabase.ts:1-16` | Supabase-backed with localStorage fallback; syncs on message-complete (StrictMode dedup fixed) |
| **Sidebar (search, pin, delete)** | IMPL | `frontend/components/Sidebar.tsx:1-253` | Today/Yesterday/Pinned groups, ⋯ menu with rename/pin/archive/delete |
| **Persistent personal memory** | IMPL | `backend/memory/personal.py:1-156` | Supabase table with versioned supersession (`status ∈ {current,superseded}`); regex secret-refuser; injected as `context_block()` in system prompt |
| **Long-term semantic memory** | PARTIAL | `backend/memory/long_term.py:1-103` | Wraps a `_augment_with_memory` step in `/voice`; UNVERIFIED whether the embedding search is populated with real data |
| **Short-term memory** | IMPL | `backend/memory/short_term.py:1-38` | Per-process conversation history for the HTTP/WS chat surface |
| **Memory UI (view/edit/delete)** | IMPL | `frontend/components/Settings.tsx:524-560` (Memory section) | List with edit/delete, grouped by category |
| **Documents / RAG** | IMPL | `backend/documents/extract.py`, `backend/documents/store.py`, `backend/tools/doc_tools.py`, `backend/main.py:1118` | PDF (pypdf) · DOCX (python-docx) · text; SQLite chunked store with Ollama embedding OR lexical term-overlap fallback; citation with filename + page |
| **Code Mode 3-pane IDE** | IMPL | `frontend/app/code/page.tsx:1-1093` | File tree · viewer · agent panel; sessions persisted in localStorage; folder picker via native osascript |
| **Workspace path sandbox** | IMPL | `backend/workspace/service.py:1-156` | `realpath` check; refuses `../etc/passwd` (verified per memory) |
| **PLAN / AUTO / BYPASS modes** | IMPL | `frontend/app/code/page.tsx` (mode selector), `backend/main.py` `/code` endpoint | PLAN: propose only, no writes; AUTO: auto-confirm write_file/edit_file/rename_path/run_command/git_commit; BYPASS: same as AUTO minus plan prefix. delete_path ALWAYS confirms |
| **Universal file viewer** | IMPL | `backend/main.py:1014-1069`, `backend/documents/preview.py`, `frontend/components/FileViewer.tsx:1-332` | text · pdf (per-page PNG render via `render_pdf_page`) · image · video · audio (all via `/preview/raw` with `Content-Disposition: inline`) |
| **Recurring routines (NL scheduling)** | IMPL | `backend/integrations/routines.py`, `backend/main.py:889-922` | SQLite store, `_parse_schedule` handles "every morning", "hourly", "every friday 5pm", "daily at 7:30am"; scheduler polls every 60s; notifications queued for menu-bar delivery |
| **Routines UI (add/list/delete)** | IMPL | `frontend/components/Settings.tsx:478-520` (Routines section) | Add form + list with schedule + next-run + last-result + delete |
| **Autonomy daemons (4 shipping)** | IMPL | `backend/autonomy/daemons.py:1-221` | `downloads_cleaner` (weekly PROPOSE) · `bin_monitor` (daily SAFE banner if >1GB) · `weekly_summary` (Sunday 21:00 SAFE) · `email_drafter` (nightly PROPOSE — reads Gmail unread, drafts replies, drops proposal) |
| **Autonomy scheduler tick** | IMPL | `backend/autonomy/engine.py:181-195`, `backend/main.py:77-110` | Runs every 60s; SAFE daemons execute; PROPOSE daemons create rows in `config/scout_autonomy.db` |
| **Approval inbox** | IMPL | `backend/autonomy/proposals.py:1-50+`, `backend/main.py:955-970` | SQLite tables: proposals, daemon_runs, daemon_state; approve triggers `execute_proposal(pid)` which runs the encoded tool actions through the registry — nothing runs that isn't a real Scout tool |
| **Autonomy modes (Plan/Auto/Bypass)** | IMPL | `backend/main.py:976-990` | In-process state; Bypass auto-approves PROPOSE proposals; Plan requires user click |
| **Autonomy UI (drawer)** | IMPL | `frontend/components/Autonomy.tsx` (imported in `frontend/app/page.tsx:10`) | Daemon list, proposal inbox, mode selector; badge on main topbar shows pending count |
| **Gmail (read + send)** | IMPL | `backend/integrations/gmail.py`, `backend/tools/productivity_tools.py`, `backend/integrations/google_auth.py` | Real OAuth flow — user must place valid `config/google_credentials.json` and click Connect once; send requires confirmation gate |
| **Google Calendar (upcoming)** | IMPL | `backend/integrations/calendar.py`, wrapped by productivity tools | Lists upcoming events |
| **Google connector setup UI** | IMPL | `frontend/components/Settings.tsx:405-434` (Connectors section) | Connect/Disconnect buttons; browser consent |
| **Reminders (add/list/complete)** | IMPL | `backend/integrations/reminders.py`, `backend/main.py:843-889` | SQLite store, NL time via `dateparser`, native macOS notification on due |
| **Spotify (playback control)** | IMPL | `backend/integrations/spotify.py`, `backend/main.py:352-375` | Requires Premium + active device (per source) |
| **Weather** | IMPL | `backend/integrations/weather.py`, `backend/main.py:308-329` | Fixed to Bengaluru per `config/jarvis.json` |
| **News** | IMPL | `backend/integrations/news.py`, `backend/main.py:319` | UNVERIFIED whether source is live |
| **Home Assistant** | PARTIAL | `backend/integrations/home_assistant.py`, `backend/main.py:384-407` | Endpoint exists; requires `HOME_ASSISTANT_TOKEN` and a running HA instance |
| **Phone control (ADB)** | IMPL | `backend/integrations/phone.py:1-50+`, `backend/main.py:409-517` (8 phone routes) | Wakes OnePlus Nord 4, opens IR Remote app, drives it by coordinate taps; also `/phone/tap`, `/phone/swipe`, `/phone/key`, `/phone/text`, `/phone/screen`, `/phone/size`. Coordinate map lives in `config/ir_remote.json`. Fragile if the vendor app updates. |
| **Phone mirror UI** | IMPL | `frontend/components/PhoneMirror.tsx:1-267` | 3D-ish native-feel phone screen mirror with tap/swipe |
| **MCP servers** | STUB | `backend/main.py:997-1009` | Endpoint reads `~/.scout/mcp.json` and returns whatever's there. NO live MCP client. Frontend `frontend/components/Settings.tsx:475` renders "how to add a server" state when empty. |
| **Confirm/Cancel card flow** | IMPL | `backend/agents/orchestrator.py:204-216`, `frontend/hooks/useJARVIS.ts` (`confirm` event) | Fixed the send_email infinite-loop bug: run_stream stops on `needs_confirmation`, emits event, UI surfaces card; on approve, tool re-runs with `confirm=True` |
| **Theme system (light + dark)** | IMPL | `frontend/lib/tokens.ts` (all colors as `var(--…)`), `frontend/styles/globals.css` (`:root[data-theme=light|dark]`), `frontend/components/ThemeToggle.tsx:1-33` | No-flash inline script in layout; warm sand light / cool slate dark |
| **Serif hero + terracotta accent** | IMPL | `frontend/app/page.tsx` (Fraunces serif via next/font; time-based greeting) | Claude-inspired design |
| **Live system stats (CPU/RAM/GPU/battery)** | IMPL | `backend/main.py:140-167` (real Apple Silicon GPU via `ioreg AGXAccelerator`), `frontend/components/StatusBar.tsx` | Real ioreg parsing, not simulated |
| **Gauges (270° arcs)** | IMPL | `frontend/components/Gauge.tsx:1-100` | Original design, animated |
| **Orb / arc-reactor visual** | IMPL | `frontend/components/Orb.tsx:1-207` | Depth-shaded blue particle sphere with rings |
| **Voice wave / particles / boot sequence** | IMPL | `frontend/components/VoiceWave.tsx`, `Particles.tsx` | Some legacy components no longer wired into `page.tsx` |
| **Gesture control (hand tracking)** | PARTIAL / EXTERNAL_DEP | `backend/gesture/tracker.py`, `backend/gesture/ws_bridge.py`, `requirements-gesture.txt` | MediaPipe hand tracking classifies 10 gestures; must run in separate `.venv-gesture` (numpy<2). Not integrated into current main UI. |
| **Arc Forge (AR gauntlet)** | IMPL | `frontend/app/forge/page.tsx:1-512` | Real-time webcam → MediaPipe hand tracking → holographic gauntlet materialises on the user's hand, gesture-driven weapons (repulsor/overload/missiles/unibeam), particle engine, targeting HUD. 100% local. |
| **S.E.E. (Systems Engineering Environment)** | IMPL | `frontend/app/see/page.tsx:1-736` | 3D forearm gauntlet assembly using THREE.js; pinch/grab/seat/lock/power interactions with real hand tracking. Assemble parts onto a forearm armature. |
| **Autonomy component (drawer)** | IMPL | `frontend/components/Autonomy.tsx` (imported and rendered) | Real drawer showing daemons + proposals |
| **Settings modal** | IMPL | `frontend/components/Settings.tsx:1-707` | 6 sections: Voice, Connectors, MCP, Routines, Memory, About |
| **Global keyboard shortcut for Talk** | IMPL | via Spotlight `⌘⌥-Space` and menu-bar Talk item | User can pull up Scout without leaving current app |
| **Emergency stop** | IMPL | `macos/scout.py` menu "Stop" item, `useJARVIS.ts` stop, `useTalk.ts` interrupt | Halts recording + playback |
| **Notifications (native macOS)** | IMPL | `backend/tools/mac_tools.py:notify`, `macos/scout.py:@rumps.timer(30) _poll_reminders` | Polls `/reminders/due` and `/routines/notifications` every 30s → rumps.notification or osascript fallback |
| **`.env`-based configuration** | IMPL | `backend/config.py` (`_load_env_file()` auto-loads), `.env.example` documents everything | No `source .env` needed |
| **`run.sh` one-command dev** | IMPL | `run.sh` (repo root) | Frees ports 8000/3000; starts backend + frontend together; Ctrl-C stops both |
| **`start_scout.sh` / `stop_scout.sh`** | IMPL | Both in repo root | Detached start (backend + frontend + menubar via nohup) with logs to `/tmp/scout_*.log` |
| **Native app auto-start** | IMPL | `macos/com.scout.backend.plist`, `macos/install.sh` | LaunchAgent for backend; Scout.app as macOS Login Item |
| **Authentication** | LIMITED | Local-only (no cloud auth surface); Google OAuth for Gmail/Calendar; Supabase publishable key for memory | No user accounts; Scout is single-user by design |
| **CORS scoped to localhost** | IMPL | `backend/main.py:43-51` | Only `localhost:{FRONTEND_PORT}` allowed |
| **Error handling in agent loop** | IMPL | `backend/tools/base.py:104-112` (tool exception → ToolResult), `backend/agents/orchestrator.py:407-421` (synthesis fallback) | Tools cannot crash the loop |
| **Structured JSON schemas per tool** | IMPL | `backend/tools/base.py:71-96` | Lightweight `_validate` on parameters (types, required, enum) |
| **Tool activity high-level (not chain-of-thought)** | IMPL | `backend/agents/orchestrator.py:65-109` (`_LABELS` dict) | "Searching the web", "Reading a file", "Committing changes" — user-facing summaries |

**Feature tallies (using strict definitions):**
- **IMPL: ~60**
- **PARTIAL: 4** (image generation, long-term memory, gesture control, Home Assistant)
- **STUB: 1** (MCP servers)
- **EXTERNAL_DEP: 3** (Chatterbox service, `me_jeev` reference audio, Vosk model)
- **ABSENT: 1** (voice-cloning UI — the custom voice registry is dev-only)

---

## Part 3 — Architecture

### Frontend

- **Framework**: Next.js 14 (App Router), React 18, TypeScript, Tailwind
  (present in config but styles are hand-authored in
  `frontend/styles/globals.css`).
- **Main UI architecture**: 4 routes.
  - `/` (`frontend/app/page.tsx`, 389 lines) — chat surface with
    sidebar, composer, conversation, autonomy drawer.
  - `/code` (`frontend/app/code/page.tsx`, 1093 lines) — 3-pane IDE
    (file tree · viewer · agent panel) with mode selector, sessions.
  - `/forge` (`frontend/app/forge/page.tsx`, 512 lines) — AR gauntlet
    via webcam + MediaPipe hand tracking.
  - `/see` (`frontend/app/see/page.tsx`, 736 lines) — 3D forearm
    gauntlet assembly with pinch-grab hand tracking.
- **State management**: React hooks only (no Redux/Zustand); Supabase +
  localStorage for conversation history; localStorage for code
  sessions; localStorage for theme.
- **Important components**: `Composer.tsx`, `Conversation.tsx`,
  `ModelSelector.tsx`, `Markdown.tsx`, `Sidebar.tsx`, `Settings.tsx`
  (707 lines, 6 sections), `Autonomy.tsx`, `FileViewer.tsx` (332
  lines), `PhoneMirror.tsx` (267 lines), `StatusBar.tsx`, `Gauge.tsx`,
  `Orb.tsx`, `VoiceWave.tsx`, `Particles.tsx`, `ThemeToggle.tsx`.
- **Important hooks**: `useJARVIS` (chat WS, 199 lines), `useTalk`
  (streaming voice, 402 lines), `useVoice` (legacy batch voice, 303
  lines), `useModels` (catalog, 82 lines), `useConversations`
  (Supabase-first, 296 lines), `useLiveData` (system stats polling),
  `useGestures` (109 lines, hand-tracking bridge).

### Backend

- **Runtime**: Python 3.11, FastAPI (via `uvicorn[standard]`), asyncio.
- **~75 HTTP endpoints + 2 WebSockets** (`/ws/chat`, `/ws/voice`).
  Grouped: chat/memory/agents/models · voice/vision · phone (8) ·
  connectors/reminders/routines · autonomy (7) · preview (4) · MCP (1
  stub) · integrations (weather/news/gmail/calendar/spotify/HA).
- **Local services**: Kokoro TTS (warmed at startup), Whisper STT,
  Vosk (used inside `macos/scout.py`, not backend). Background
  scheduler ticks every 60s for routines + autonomy daemons.
- **Agent orchestration**: `backend/agents/orchestrator.py:1-422`
  provides `run` (non-streaming, planner-routed) and `run_stream`
  (streaming, with `on_confirm` callback). Shared `_agent_loop` engine.
  Complex plans execute in dependency-ordered waves (`_run_complex`
  with `asyncio.gather` per wave).
- **Tool execution**: `backend/tools/base.py:143-164` — every tool goes
  through `ToolRegistry.execute(name, args, confirm)`; permission gate,
  schema validation, exception boundary all here.
- **Streaming architecture**: WebSocket for chat and voice; SSE proxy
  for `/speak_stream` when Chatterbox is up. Per-sentence flushing
  regex `(.+?[.!?…])(\s+|$)` splits streamed model output for
  sentence-boundary TTS.

### AI

- **Models supported (5, all NVIDIA NIM)**:
  - `nemotron-3-ultra` (default, `nvidia/nemotron-3-ultra-550b-a55b`)
  - `gpt-oss-20b` (`openai/gpt-oss-20b`)
  - `nemotron-3-nano-omni` (`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`)
  - `nemotron-super-49b` (`nvidia/llama-3.3-nemotron-super-49b-v1.5`)
  - `llama-3.2-11b-vision` (`meta/llama-3.2-11b-vision-instruct`)
- **Provider seam**: `backend/providers/openai_compat.py` (234 lines)
  wraps both NVIDIA NIM and Z.AI endpoints under an OpenAI-compatible
  Chat Completions interface. `backend/providers/catalog.py` (112
  lines) is a single source of truth for capabilities
  (text/vision/documents/tools/reasoning).
- **Model selection**: explicit — no automatic fallback. User picks in
  UI (`ModelSelector.tsx`), server persists via `POST /model`, chat/
  voice both use the active model. Voice always uses `gpt-oss-20b`
  regardless of chat selection (for speed).
- **Prompts / context assembly**: `_system_with_memory()` combines
  `SYSTEM_PROMPT` + `personal.context_block()` (current memories);
  `_WEB_MANDATE` appended when web-search is toggled.
- **Tool calls**: OpenAI-format `tools=` schemas; tool_call deltas
  accumulated during streaming, resolved into `Tool.run()` calls;
  results returned as `tool` role messages.
- **Agent loops**: bounded 8 steps in both `run_stream` and
  `_agent_loop`. Transient errors get one retry. `_finalize` never
  returns empty text.

### Voice

- **Voice input**: mic → `sounddevice` (native) or `getUserMedia`
  (browser) → WAV bytes → Whisper STT (`pywhispercpp`, `base.en`).
  `_clean_transcript` strips non-speech annotations
  (`[BLANK_AUDIO]`, `(noise)`).
- **Voice output**: Kokoro (`kokoro-onnx==0.3.5`) for stock voices,
  routed to Chatterbox HTTP service for custom voices (`me_jeev`).
  Per-sentence flushing lets Scout speak sentence 1 while generating
  sentence 2.
- **Chatterbox integration**: `backend/voice/chatterbox_client.py`
  speaks to `127.0.0.1:8790`; the Chatterbox service itself lives in
  `~/chatterbox/.venv` (torch + MPS) — NOT in this repo. If Chatterbox
  is unreachable, TTS falls back to Kokoro (`backend/voice/tts.py:75`).
  Custom voice registry: `{"me_jeev": {ref_path:
  "~/chatterbox/jeev.wav"}}`.
- **Jeev's voice reference**: manually placed WAV file at
  `~/chatterbox/jeev.wav`. No UI to record or replace it. The path is
  never sent over any wire — the Chatterbox service reads it locally.
- **Production-ready or prototype**:
  - **Kokoro TTS + Whisper STT + Vosk wake**: production-ready in the
    sense that they run every day and have known failure modes handled.
  - **Chatterbox + custom voice**: prototype — external service, no
    self-serve setup, single hardcoded reference file.
  - **Streaming voice `/ws/voice`**: production-ready backend
    (verified per memory: first-audio 2.3-4.7s); frontend audio queue
    tested typechecks but real-mic barge-in only verified per code
    review, not on real hardware.

### Storage

- **Files**: `config/*.db` (SQLite), `~/Library/Application Support/Scout`
  (native app state), `/tmp/scout_*.log` (rotating logs).
- **Local storage**: conversation history (frontend fallback), code
  sessions, theme, active model preference.
- **Databases (all SQLite in `config/`)**:
  - `scout_documents.db` — RAG chunks + optional embeddings
  - `scout_reminders.db` — reminders with `due_at`, `fired` flags
  - `scout_routines.db` — recurring prompts + schedule
  - `scout_autonomy.db` — proposals, daemon_runs, daemon_state
  - `jarvis_memory.db` — legacy long-term memory (SQLite vector)
- **Supabase (optional)**: `memories` table (versioned supersession),
  `conversations` table (chat history). Uses publishable/anon key on
  frontend and same key on backend — enforces RLS.
- **Settings**: `config/jarvis.json` (non-secret) + `config/scout_settings.json`
  (voice preference).
- **Session/context persistence**: short-term (`ShortTermMemory` per
  process); long-term (`long_term.py` — UNVERIFIED whether populated);
  personal (Supabase supersession).

---

## Part 4 — Actual agent capability

### Is Scout an agent or a chat interface?

**Scout is genuinely an agent, not a chat wrapper.** The evidence:

- Tools are called mid-stream from the model, results are fed back, and
  the model can call more tools in the same turn (up to 8 rounds).
  Evidence: `backend/agents/orchestrator.py:179-217` (`run_stream` loop),
  `:258-288` (`_agent_loop`).
- There is a real planner that decomposes multi-part objectives into a
  DAG of specialist steps and runs them in parallel where independent
  (`backend/agents/planner.py`, `orchestrator.py:_run_complex`).
- Actions have side effects — write to disk, run shell commands, commit
  to git, send email — and every one is auditable through the
  permission gate.
- Autonomy daemons run without user input on schedule and can propose
  multi-action bundles the user approves in one click.

That said: **Scout is a *level-2* agent, not a *level-4*.** It doesn't
have long-horizon planning across sessions, no world-model that survives
restarts, no self-correcting behaviour beyond the 1x transient retry.
This is important for how you position it — see Part 7.

### Concrete capability audit

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Understand a task | YES | Planner produces a JSON plan (`planner.py:42-109`); specialist system prompts route intent |
| 2 | Inspect a repository | YES (small–medium) | `list_directory`, `search_code` (linear grep, max 40 hits), `read_file` (max 60k chars) |
| 3 | Read files | YES | `code_tools._read_file`; refuses binaries by extension |
| 4 | Modify files | YES | `write_file` (create/overwrite), `edit_file` (unique-snippet replace with count guard) |
| 5 | Execute commands | YES | `run_command` in workspace `cwd`, 90s timeout, denylist blocks `rm -rf /`, `sudo`, `curl`, `git push`, etc. |
| 6 | Observe command results | YES | stdout+stderr returned as tool result; `data.output` includes exit code |
| 7 | Reason over results | YES | Tool results become `role:tool` messages fed back to the model, which can call more tools |
| 8 | Continue iterating | YES (bounded) | `_MAX_STEPS=8`; enough for open→read→edit→verify→commit cycle |
| 9 | Test its changes | PARTIAL | Can call `run_command` with `pytest` / `npm test` / etc.; no dedicated "verify" tool, no automatic test-first behaviour |
| 10 | Recover from failures | LIMITED | Single transient retry (`_transient` on 503/429/timeout); no smarter recovery. If a `run_command` fails, the model can decide to retry or ask — but there's no built-in self-correction |
| 11 | Complete multi-step tasks autonomously | YES with caveats | Complex plans in `_run_complex` run to completion; delete_path always confirms; `run_command`/`git_commit`/`write_file` auto-run only in AUTO/BYPASS mode |

### The actual agent loop

`_agent_loop` is the engine. Simplified:

```
loop up to 8 times:
    completion = model.complete(messages, system, tools=schemas)
    if no tool_calls:
        return _finalize(completion.text, activity)
    append(assistant with tool_calls)
    for each tool_call:
        result = tools.execute(name, args, confirm=(name in auto_confirm))
        if needs_confirmation:
            pending = {tool, args, prompt}
            append(tool message = "ACTION NOT PERFORMED, ask user")
        else:
            append(tool message = result.summary)
        emit activity event
final = model.complete(messages, system)  # no tools this turn
return _finalize(final.text, activity)
```

`run_stream` is the streaming variant — same shape, but uses
`provider.stream_events` and calls `on_text` on each token,
`on_activity` per tool call, `on_confirm` when the loop suspends for
consent.

### Three concrete workflows Scout can actually perform

**1. Voice-triggered code fix in a connected project.**

- User: says "Hey Scout, in my Python project, add error handling to the
  `save_user` function in `db.py` and commit it."
- Vosk fires → mic records → Whisper transcribes.
- `run_stream` starts on `gpt-oss-20b`. Model calls `list_directory` →
  `read_file("db.py")` → `edit_file("db.py", "def save_user(...):",
  new_body)` — since AUTO is on for Code Mode, the edit auto-confirms.
  Model calls `git_commit("Add error handling to save_user")` — also
  auto-confirms.
- Kokoro streams sentence-by-sentence: "Wrapped `save_user` in a
  try/except. Committed as 'Add error handling to save_user'."
- Verifiable: `git log` shows the commit; the file has the edit.

**2. "What's on my screen?" analysis of a specific app.**

- User in Chat: "Look at my Terminal and tell me what the error
  message says."
- Orchestrator selects the vision-capable-through-tool path: `mac`
  specialist calls `see_app("Terminal", question="what does the error
  say?")`. That tool: activates Terminal → screencaptures → sends the
  JPEG to `llama-3.2-11b-vision` → returns text → reactivates the
  previous app.
- Reply: text explanation of the error.
- Bridges the "vision models can't call tools / tool models can't see"
  split cleanly.

**3. Nightly email drafts, morning approval.**

- 22:00: `email_drafter` daemon fires (autonomy scheduler).
- Reads Gmail (unread top 5), drafts a reply per message using
  `orchestrator.run` (a full LLM cycle per email).
- Composes a proposal: `[{tool: send_email, args: {to,subject,body}}]` ×
  N drafts. Drops into `scout_autonomy.db` as `pending`.
- Morning: user opens Autonomy drawer, reviews drafts, hits Approve →
  `execute_proposal(pid)` runs each `send_email` through the tool
  registry with `confirm=True` — actual send happens.

---

## Part 5 — Competitive analysis

### vs Cursor

- **Cursor does better**: full-project semantic understanding (indexed
  embeddings across the whole codebase), inline autocomplete,
  multi-file edits with diff-based UI, deep IDE integration (goto def,
  refs, hover types), a huge fine-tuned dataset on codebases, robust
  git-aware review flow, streaming autocomplete + chat + composer all
  in one editor with muscle-memory keybindings.
- **Scout does better**: nothing on the code side.
- **Scout does worse**: everything on the code side. Scout's Code Mode
  is a proof of concept. `search_code` is a linear grep across files
  capped at 40 hits — Cursor's codebase-aware retrieval is in a
  different league.
- **Defensible idea**: Scout doesn't compete with Cursor. It shouldn't
  try to.
- **Reinventing**: Scout's Code Mode duplicates a subset of Cursor's
  functionality without the polish. Do not lead with Code Mode when
  pitching to Razorpay.

### vs Claude Code (this session's runtime)

- **Claude Code does better**: agent quality (Claude Sonnet/Opus is
  meaningfully better than Nemotron 3 Ultra at codebase reasoning),
  MCP ecosystem, TodoWrite-style task tracking, subagent spawning,
  cloud sandboxes, integration with Anthropic's tool ecosystem,
  reliable long-horizon runs.
- **Scout does better**: native macOS presence, voice loop, wake
  word, screen vision, permission-gated *native* Mac actions
  (open app, control volume, brightness, screen sharing), autonomy
  daemons with a schedulable + approval-inbox architecture.
- **Scout does worse**: intelligence quality, MCP (Scout has a stub),
  Windows / Linux support (none — macOS only).
- **Defensible idea**: Scout is a *desktop* Claude Code. If Claude
  Code is your terminal, Scout wants to be your Siri.
- **Reinventing**: some of the Code Mode work overlaps with what
  Claude Code already does better.

### vs GitHub Copilot

- **Copilot does better**: inline autocomplete (Scout has zero),
  IDE-plugin distribution to millions of developers, model tuning for
  code completion specifically, price-per-value at scale.
- **Scout does better**: agentic actions (Copilot is largely
  completion + chat), Mac control, voice, memory.
- **Scout does worse**: distribution, autocomplete UX.
- **Defensible idea**: Copilot is a tool for typing code faster;
  Scout is a tool for talking to your Mac. Different products.
- **Reinventing**: nothing directly — non-overlapping.

### vs Windsurf

- **Windsurf does better**: same story as Cursor — codebase intel,
  inline autocomplete, multi-file diffs, Cascade agent loop with
  better model reasoning.
- **Scout does better / worse**: mirror of the Cursor comparison.
- **Reinventing**: same as Cursor.

### vs OpenAI Codex-style coding agents (e.g. Devin, SWE-agent, OpenAI's Codex)

- **Codex agents do better**: sandboxed VM execution with rollback,
  automated test-driven loops (write test → verify → fix), long-
  horizon runs (hours of work), git-aware branching and PR creation,
  benchmark performance on SWE-bench.
- **Scout does better**: voice interface, screen vision, Mac control,
  UI-agnostic (not tied to a repo).
- **Scout does worse**: autonomy quality, no sandboxed VM (Scout runs
  on the user's actual machine), no PR flow, no benchmark evidence.
- **Defensible idea**: Scout targets *personal* work (open apps, read
  screen, manage email, take voice notes, run recurring routines) —
  the intersection Codex agents don't touch.
- **Reinventing**: Scout's Code Mode plays in Codex territory with
  none of Codex's autonomy depth. Again, do not lead with Code Mode.

---

## Part 6 — Razorpay AI Buildathon evaluation (Open Track)

Scoring is deliberately harsh. Razorpay's stated rubric: **problem
taste · build quality · AI judgment · failure recovery**.

| # | Dimension | Score | Reasoning |
|---|---|---:|---|
| 1 | Problem importance | **6/10** | "OS-native AI assistant" is a real category (Rewind, Rabbit, Humane failed at it); Apple Intelligence is Apple's stated direction. Not a fake problem, but not a bleeding-obvious one for a payments company. |
| 2 | Originality | **6/10** | The *combination* (wake word + native shell + orchestrator + autonomy + permission gate + Chatterbox voice clone + Code Mode + AR gauntlet) is unusual. No single piece is genuinely novel. |
| 3 | AI depth | **7/10** | Real multi-agent orchestrator with planner routing, streaming with tool use, 5-model catalog with capability metadata, retrieval + citation, screen vision routed through a tool. Deeper than most "chatbot with tools" submissions. |
| 4 | Agentic capability | **6/10** | Genuine agent (bounded loop, tools, permissions), but no long-horizon planning, no self-correction beyond a single retry, no sandboxed execution. Level 2, not level 4. |
| 5 | Technical complexity | **8/10** | ~30k LOC across three languages/runtimes (Python backend, Next.js frontend, PyObjC/AppKit native shell). WKWebView + Spotlight NSPanel + Halo NSView + Vosk wake word + streaming voice + orchestrator + permission gate + autonomy daemons + SQLite persistence + Supabase — genuinely hard integration work. |
| 6 | Product quality | **5/10** | Docs are strong. Actual polish is uneven: 6 leftover `", sir"` strings in production tool messages; jarvis.json still lists dead models (`z-ai/glm-5.2`, `qwen2.5:14b`, `llava:7b`); MCP is a stub the UI displays; Chatterbox needs a repo-external setup; the Vosk wake model isn't included. |
| 7 | UX | **6/10** | Beautiful design system (light + dark, terracotta accent, serif hero). Warm and distinctive. But: no onboarding flow (user hits `run.sh` and has to figure out permissions + folder connect + voice grant + model key). Menu-bar orb is small; Spotlight requires learning a shortcut. |
| 8 | Reliability | **5/10** | Confirm flow is well-tested. But: image generation cold-starts >200s; NVIDIA free tier throws 503 under parallel load; Chatterbox is prone to being down; native app requires 4+ system permissions granted before core features work; py2app rebuild required for many changes. |
| 9 | Real-world usefulness | **6/10** | If it were running, a technical macOS user could use it every day. Nothing here is a toy — the Gmail send, calendar list, code edits, screen vision, autonomy daemons all do real work. |
| 10 | Differentiation | **6/10** | On the "native macOS AI shell" axis, differentiated (nothing else this integrated ships open-source). On any single axis in isolation (chat, code, voice, memory), competing products are better. Sum is bigger than parts. |
| 11 | Demo potential | **8/10** | Voice + wake + Halo + screen vision + code fix + git commit + AR gauntlet is a *very* recordable demo. If the video captures wake→see→fix→commit in one voice command, that's a shortlist moment. |
| 12 | Evidence of actual usage | **2/10** | No usage metrics. No users other than the developer. No case studies. The commit history is 3 commits (initial + polish + build cache) — no time-in-service. |
| 13 | Scalability | **3/10** | Single-user by design (Supabase RLS is anon-full-access, workspace is a single connected folder, autonomy daemons are per-machine). Not designed to scale to N users; would need auth + multi-tenant refactor. |
| 14 | Engineering quality | **7/10** | Sandboxed workspace path resolver, permission gate, tool exception boundary, no-fallback model semantics, honest error surfaces, comprehensive `.gitignore` and secrets hygiene (audited this session). SQLite migration handled for reminders `due_at`. Structured provider seam. Docs are current. Genuine engineering discipline. |
| 15 | Overall competitiveness | **6/10** | Better than most solo/hobby submissions; likely below teams shipping payments-adjacent tooling that hits Razorpay's core tracks. |

**Total: 87/150.**

**Classification: COMPETITIVE (borderline STRONG).**

**Why not STRONG:** engineering depth is genuine but the product story
is diffuse ("native macOS AI assistant that does many things") vs.
sharp ("solves one specific problem better than anyone"). Razorpay
judges under an Open Track will look for either (a) technical audacity
that surprises them or (b) obvious real-world utility. Scout has some
of (a) — the autonomy engine + permission gate + native shell — but
weakens (b) by scope-scattering across code/voice/AR/phone-control.

**Why not WEAK:** the code holds up to scrutiny. The orchestrator is
real. The permission gate is real. The tool registry is real. The
native app builds. This is not a demo-ware submission.

---

## Part 7 — The harsh truth

### What would make a Razorpay judge reject Scout

1. **They can't run it.** Judge opens the repo, sees `pip install`,
   `npm install`, download-vosk-model, generate-NVIDIA-key, run separate
   Chatterbox service, `py2app` build, grant 4 permissions. That's 30+
   minutes before they see anything. Most judges won't get there.
2. **No usage evidence.** The repo has 3 commits and one contributor.
   No metrics. No screenshots of long use. No "I've been using this
   daily for 6 months and here's what changed" story.
3. **Scope scattering.** AR gauntlet (`/forge`), 3D gauntlet assembly
   (`/see`), phone control over ADB, image generation, universal file
   viewer — impressive individually, but reads as "kitchen-sink" not
   "focused product."
4. **Not payments-adjacent.** Razorpay's four other tracks are all
   payments/finance. Open Track exists for lateral ideas, but a payments
   company will still look kindly at anything that plausibly touches
   their world. Scout doesn't.
5. **Chatterbox voice clone is theatre.** The `me_jeev` voice sounds
   great in a demo, but it requires an out-of-repo `~/chatterbox/`
   service and a manually-placed WAV. If a judge tries to reproduce it,
   they'll fail — and if they can't reproduce the "wow" moment, the
   demo becomes suspect.

### Scout's 5 biggest weaknesses

1. **Distribution hostility.** The setup burden is enormous relative to
   any web app. Nothing works in a browser tab you send to a friend.
2. **Model quality ceiling.** Nemotron Ultra is capable but not
   Sonnet/Opus tier. When Scout's answers are shallow, users blame
   Scout, not the model. Free-tier flakiness compounds this.
3. **No evaluation harness.** There is no `pytest` suite that proves
   the agent loop, tools, or planner behave. Every fix is "I ran it and
   it worked." A judge scanning `tests/` will find nothing.
4. **Voice clone requires external service.** The single most
   demo-magic feature isn't in the repo.
5. **Single-user architecture.** Supabase RLS is anon-full-access,
   workspace is a single folder, autonomy state is a single SQLite.
   You cannot invite a second user without a real auth/multi-tenant
   pass.

### Impressive but NOT actually valuable

- **Arc Forge** (AR gauntlet, `/forge`) — technically neat, wow-factor
  in a demo, but has zero productive use. It's a party trick.
- **S.E.E.** (3D gauntlet assembly, `/see`) — same category. A THREE.js
  showcase, not a product.
- **Phone control over ADB via OnePlus IR Remote coordinate taps** —
  brittle, unreproducible for anyone with a different phone, dependent
  on a vendor app's UI layout. Impressive engineering, near-zero
  transferable value.
- **Live partial transcript via Vosk while Whisper finalises** — cool
  detail, but users won't notice or care.

### Mostly cosmetic

- **Serif hero + terracotta accent + theme system** — beautiful, but
  doesn't move any evaluation axis.
- **Orb / arc-reactor / VoiceWave / Particles / Gauge components** —
  most are no longer wired into the current main UI (`page.tsx` was
  rewritten in the "chat-first redesign v2"). They exist as leftover
  polish from earlier phases.
- **Boot sequence, particle effects, "premium light UI redesign"** —
  same story.

### Genuinely technically impressive

- **Permission gate architecture** (`backend/tools/base.py`) — cleanly
  enforced at one point, three tiers, exception boundary, schema
  validation. Real engineering.
- **Confirm/Cancel flow in a streaming loop** (fixed the send_email
  infinite-loop bug) — subtle bug, elegant fix using an `on_confirm`
  callback that suspends the model loop.
- **Screen vision as a tool routing to a vision model**
  (`vision_tools._see_app`) — clever bridge for the "tool models
  can't see" problem.
- **Autonomy engine + approval inbox** — full daemon registry,
  scheduler tick, SQLite persistence, proposal → execute_proposal flow
  where approvals run through the same permission-gated tool
  registry. Genuinely thoughtful.
- **Streaming voice with per-sentence flushing** — real latency
  engineering (`_flush_sentences` at `backend/main.py:622-638`),
  ~3.5s saved on multi-sentence replies.
- **Native app identity forcing** (`_force_scout_identity()` before
  AppKit builds NSApplication) — obscure but correct macOS trick.

### Genuinely differentiated

- The **combination** of wake word + native shell + orchestrator +
  permission gate + autonomy daemons is not something a reviewer will
  have seen before as one system, even if they've seen each piece.
- The **approval inbox** for background daemons is the most novel
  primitive here. It's a real answer to "how do you make an agent
  proactive without being scary."

### Claims you should NOT make in the application

- ❌ "Scout is production-ready." It isn't. Free-tier NVIDIA + Chatterbox
  external service + Vosk external model + `py2app` rebuild for changes
  = not production-ready.
- ❌ "Fully autonomous agent." Scout is level 2. Level 4 is Devin. Don't
  compete on autonomy depth.
- ❌ "MCP integration." Scout has a stub endpoint. Don't claim
  integration.
- ❌ "Voice cloning built-in." The custom voice requires an external
  service and a manually-placed reference file. It works, but "built-in"
  overclaims.
- ❌ "Replaces Cursor/Copilot for coding." It doesn't. Scout's Code Mode
  is a proof of concept.
- ❌ "Scalable to teams." Single-user by architecture. Would need real
  auth work.

### What a strong competitor would have that Scout doesn't

1. **A hosted, browseable demo.** Judge clicks a link and it just works.
2. **Test coverage + a CI badge.** Even a bare `pytest` on the tool
   registry moves the "engineering quality" score meaningfully.
3. **A single sharp story.** "Scout is the fastest way to \_\_\_" —
   one blank. Scout can't fill it today.
4. **Metrics.** Any number: minutes-of-use, tasks-completed, tokens-
   saved-vs-Cursor, anything.
5. **A visible, real user.** Even one testimonial from someone who
   isn't the developer.

### Is Scout currently good enough to submit?

**Yes, but with narrow chances of shortlist without pre-submission
work.** The 15 days to Sept 5 are best spent on:

1. **The video.** 5 minutes, one voice-triggered end-to-end demo that
   captures wake→see→fix→commit. This is the single highest-leverage
   thing.
2. **The "what broke" answer.** Draft the send_email confirm-loop or
   the screen-vision-fast-path war story with real code diffs. This
   is what they actually read first.
3. **Cutting scope in the pitch.** Don't mention `/forge`, `/see`,
   phone control, image generation. Lead with: **native macOS agent
   with voice, screen vision, sandboxed tool use, and autonomy
   daemons**. That's the sharp story.
4. **A `pytest` suite for the orchestrator + tool registry.** Even
   20 tests moves the engineering quality perception meaningfully.
5. **Kill the MCP section** in Settings, or make it link to setup
   docs — right now it advertises "how to add a server" for something
   that has no client.

### Exactly what must change before submission

**Must-fix:**
- Clean the 6 remaining `", sir"` residues (mac_tools.py, base.py).
- Update `config/jarvis.json` to remove `z-ai/glm-5.2`,
  `qwen2.5:14b`, `llava:7b` fossils (they're not used but they lie).
- Add a top-of-README **"5-minute setup" quick path** that assumes
  everything (Vosk model download link, Chatterbox skip / Kokoro
  default, NVIDIA key, run.sh).
- Write the "what broke and how you got out" answer for the form.

**Should-fix:**
- Add a `docs/DEMO.md` walkthrough matching the video.
- Add a real screenshot or GIF to the README (the current README has
  a placeholder path `docs/hero.gif` that doesn't exist).
- Rename the AR routes so they're not surface-level — either move
  them under `/labs/` or a hidden feature flag; they distract.

**Nice-to-have (skip if time-boxed):**
- `pytest` tests for the tool registry permission gate.
- Cover onboarding for camera + Screen Recording + Accessibility.
- Fix the sunset image-gen UX (loading state, retry).

---

## Part 8 — Killer 3-minute demo (implemented features only)

Assume the demo is recorded on the developer's Mac with Scout.app,
backend, and frontend all running. All features cited here exist in
the code.

### 00:00 – 00:20 · The claim

**Show:** Full desktop. Menu bar with the Scout orb visible.
**Say:** *"This is Scout — a macOS AI assistant that lives outside the
browser. It hears me across the whole system, understands what's on my
screen, and can act on my Mac. Everything with a permission gate. Let
me show you."*

**Why it works:** anchors the frame. Doesn't overpromise. Sets up the
demo with the three concrete capabilities you'll actually show.

### 00:20 – 01:00 · Voice + wake + screen vision

**Show:** Open VS Code with a Python file that has an obvious bug (a
`ZeroDivisionError` on execution). Have Terminal beside it showing the
traceback.
**Do:** Say *"Hey Scout"* out loud. Halo overlay appears above VS Code.
Continue: *"Look at my Terminal and tell me what's wrong."*
**Watch:** Scout activates Terminal, screencaptures, restores focus,
speaks the answer sentence-by-sentence: *"Your `save_stats` function
tried to divide by zero because the list was empty."*

**Why it works:** three things at once — wake word + native voice loop
+ `see_app` tool. Real capabilities from `macos/scout.py` +
`backend/tools/vision_tools.py:_see_app`.

### 01:00 – 02:00 · Code Mode action + git commit

**Show:** Switch to the Scout web UI, `/code` route. Workspace already
connected to the project.
**Do:** Type in the code panel: *"Add a guard for empty lists in
`save_stats` and commit it."* Mode set to **AUTO**.
**Watch:** Activity chips fire: "Reading a file" → "Editing a file" →
"Committing changes". The viewer auto-refreshes; the file now has the
guard. Run `git log` in a Terminal window on the side — the commit is
there.

**Why it works:** shows the real agent loop, real file mutation, real
git action, all inside the workspace sandbox. Verifiable end-to-end.

### 02:00 – 02:40 · Autonomy inbox

**Show:** Back to `/` chat. Open the Autonomy drawer via the topbar
button (with the pending-count badge).
**Do:** Show the pending "Email drafts" proposal from last night's
`email_drafter` daemon run. Expand one draft. Hit **Approve**.
**Watch:** Approval fires `execute_proposal(pid)` — the encoded
`send_email` action runs through the permission-gated tool registry.
Gmail send happens (fake it against a test address). Proposal marked
resolved.

**Why it works:** shows the *proactive* dimension of Scout — an agent
that works while the user sleeps and defers to consent. This is the
most distinctive primitive here.

### 02:40 – 03:00 · Close

**Show:** Back on the desktop with menu-bar orb.
**Say:** *"Scout is one system: voice + vision + tools + a permission
gate + a scheduler. It runs entirely on my machine on NVIDIA's free
model tier. Everything you saw is in the repo — link in the
description."*

**Why it works:** grounds the pitch. Reinforces "local, real, verifiable."

**Total: 3:00.** No AR gauntlet. No S.E.E. No phone control. No image
generation. Just the three things Scout does that a chat product
cannot: **hear you across the OS**, **see what's on your screen**,
**do work in your files while asking permission for the risky stuff**.

---

## Part 9 — What to build next (ranked by impact)

### #1 — A working evaluation harness (~2–3 days)

- **Current problem:** Zero automated tests. Every claim in the audit
  rests on code inspection, not passing tests. A judge searching for
  `tests/` finds nothing.
- **Proposed solution:** `tests/` directory with pytest coverage for:
  (a) `tools.registry.execute` permission gate (SAFE runs, CONFIRM
  suspends, BLOCKED refuses); (b) `workspace.service.resolve` refuses
  `../` traversal; (c) planner falls back to simple on malformed JSON;
  (d) `_finalize` never returns empty; (e) `_flush_sentences` splits
  at boundaries. Add GitHub Actions to run on push.
- **Why it matters:** the single biggest engineering-quality signal.
  Also: catches regressions in the 15 days before submission.
- **Difficulty:** Low — mostly writing pytest fixtures for existing code.
- **Impact:** Moves engineering quality from 7 → 8, reliability from
  5 → 6.

### #2 — A shipped, working `me_jeev` voice clone (~1 day)

- **Current problem:** The single most demo-magic feature (talk in
  your own voice) requires an external Chatterbox service and a
  manually-placed reference WAV. A judge cannot reproduce this.
- **Proposed solution:** Either (a) ship the Chatterbox setup as
  `docker-compose up` with the reference WAV as a one-line upload UI,
  or (b) swap to a smaller local voice-clone model (RVC / XTTS-v2)
  that runs in the main venv. Add a Settings → Voice tab that lets
  the user record 60s of their voice and creates the reference file
  on the fly.
- **Why it matters:** removes the "unreproducible magic trick" objection.
- **Difficulty:** Medium — Chatterbox docker packaging is easy; XTTS-v2
  swap is a day of integration.
- **Impact:** Turns the voice clone from theatre to product. Big demo
  win.

### #3 — A "5-minute quick start" that actually works (~1 day)

- **Current problem:** README lists prereqs; ~30 minutes before a new
  user sees anything.
- **Proposed solution:** `scripts/setup.sh` that downloads the Vosk
  model, sets up the venv, prompts for the NVIDIA key, seeds
  `config/jarvis.json`, and launches. Screencast of the first 5
  minutes in the README.
- **Why it matters:** Razorpay judges are humans; if they can try it,
  they will judge it more favorably.
- **Difficulty:** Low.
- **Impact:** Product quality 5 → 7; distribution-friction is the #1
  weakness.

### #4 — One killer real-usage story with metrics (~ongoing until Sept 3)

- **Current problem:** No evidence of actual usage. "I've used this
  every day for 6 months" is the strongest signal you can send.
- **Proposed solution:** Use Scout for real work in the 14 days
  before submission. Log: minutes-of-use, tasks completed, memories
  stored, autonomy proposals approved, emails drafted. Include the
  raw log in the submission. Screenshot the memory table showing 30+
  real entries.
- **Why it matters:** Evidence of actual usage went from 2 → 6 or 7
  moves the total by 4-5 points.
- **Difficulty:** No implementation — just discipline.
- **Impact:** Highest ROI relative to time spent.

### #5 — Sharpen the story: kill AR, hide phone control, foreground autonomy (~half day)

- **Current problem:** README/pitch surface too many features. Reads
  as "kitchen sink."
- **Proposed solution:** Rewrite the README hero to lead with three
  bullets — **voice**, **vision + tools**, **autonomy inbox**. Move
  AR routes under `/labs/`. Delete or hide Phone control unless a
  reviewer specifically clicks in. Rewrite ARCHITECTURE.md's
  "Status" section to lead with the three-thing story.
- **Why it matters:** Judges spend seconds on the README before
  deciding whether to look deeper. A sharp story survives that scan;
  a diffuse one doesn't.
- **Difficulty:** Low.
- **Impact:** Differentiation 6 → 7; overall competitiveness 6 → 7.

**Explicitly NOT recommended:** more visual polish, another AR
feature, another integration, another model in the catalog, another
frontend component library. Every hour spent on these before Sept 5
is an hour not spent on the five items above.

---

## Part 10 — Final verdict

**CURRENT SCOUT SCORE: 6.5/10**

Genuinely built. Genuinely thoughtful in places (permission gate,
autonomy engine, screen-vision-as-a-tool). Falls short on
reproducibility, evidence of usage, and story focus.

**RAZORPAY COMPETITIVENESS: 6/10**

Better than a hobby submission. Behind teams shipping payments-
adjacent tools or hosted demos with metrics. Open Track's "surprise
us" framing gives Scout a shot at the shortlist if the video and the
"what broke" answer land.

**CURRENT SELECTION OUTLOOK:**

- If submitted **as-is** today: **~15–25% shortlist probability.** The
  code holds up under review but the pitch surface (no video, generic
  README, no metrics, no test suite) will underperform.
- If submitted **after the 5 items in Part 9 (~7 days of focused work
  + 5 days of daily-usage logging)**: **~40–55% shortlist probability.**
  The engineering is there; what's missing is presentation and
  evidence — both fixable in the time available.
- Neither range accounts for the strength of other submissions, which
  is unknowable.

### "If I were a Razorpay judge and saw Scout today, would I shortlist it?"

**Probably not, and here's the honest why:**

I would open the repo, read the README, see a comprehensive project
with a lot of surfaces, notice **no tests**, **no demo video**, and
**no usage evidence**. I would open the "What broke" answer on the
form (their stated tie-breaker) — Scout hasn't drafted one yet. I
would skim the code and find the orchestrator, be impressed for 3-4
minutes, then remember I have 400 other submissions to review. I
would probably move on.

**What would flip me:** a 5-minute video that shows the wake word +
screen vision + code fix + autonomy approval end-to-end in one take,
with real files and a real git log at the end. A "what broke" answer
with the send_email confirm-loop debug trail written honestly. A
README that opens with a screenshot and a one-sentence pitch, not a
prose paragraph.

**The gap is not code.** The gap is presentation and evidence.
Everything needed to close it is achievable in the 14 days remaining
before September 5.

---

*End of audit. Repository state at time of writing:
`main @ 7ccf466`, 199 tracked files, ~30k LOC.*
