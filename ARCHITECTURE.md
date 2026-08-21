# Scout — Architecture

This document is the "how it actually works" reference for the Scout codebase.
It replaces the older phase-by-phase `ARCHITECTURE_MIGRATION.md`, which is
kept for historical context but no longer reflects current state.

## Table of contents

1. [Design goals](#design-goals)
2. [Directory layout](#directory-layout)
3. [Provider seam (LLM abstraction)](#provider-seam)
4. [Tool registry & permission model](#tool-registry--permission-model)
5. [Orchestrator (planner → specialists → synthesis)](#orchestrator)
6. [Request flows](#request-flows)
7. [Voice pipeline](#voice-pipeline)
8. [Native macOS shell](#native-macos-shell)
9. [Persistent memory](#persistent-memory)
10. [RAG / documents](#rag--documents)
11. [Code Mode](#code-mode)
12. [Recurring routines](#recurring-routines)
13. [Model catalog](#model-catalog)
14. [Status matrix](#status)
15. [Known limits](#known-limits)

---

## Design goals

- **Live in the OS, not the tab.** Wake word, screen vision, menu-bar
  presence, permission-gated tool use — the assistant should be reachable
  and useful without opening a browser.
- **Answer honestly, or don't answer.** If the selected model is down, say
  so. No silent fallback to a different model that hallucinates a plausible
  answer under someone else's name.
- **Every side-effect is user-approved.** Read-only tools run; anything that
  writes files, sends email, or runs shell needs explicit consent. The
  permission gate is enforced in one place (`tools/base.py`) and threaded
  through both the streaming and non-streaming paths.
- **Modular provider seam.** LLM/vision/embedding/TTS/STT all sit behind
  small abstractions so a model swap or a new provider is a config change,
  not a rewrite.

---

## Directory layout

```
scout/
├── backend/                    # FastAPI app, orchestrator, tools, integrations
│   ├── main.py                 # /health · /chat · /ws/chat · /ws/voice · /agent · /code · /image · /workspace · /documents · /memory · /connectors · /routines
│   ├── config.py               # loads .env, jarvis.json, exposes PRODUCT_NAME
│   ├── commands.py             # keyword fast-path (screen-vision, weather, spotify) — runs BEFORE the orchestrator
│   ├── llm.py                  # thin facade over providers/
│   ├── providers/              # AIProvider seam: OpenAICompatibleProvider (NVIDIA + Z.AI)
│   ├── agents/
│   │   ├── base.py             # AgentSpec, TaskState, ActivityEvent, AgentResult
│   │   ├── registry.py         # 8 specialists (research/system/mac/code/documents/memory/productivity/vision)
│   │   ├── planner.py          # model-driven simple-vs-complex routing (strict JSON, safe fallback)
│   │   ├── specialists.py      # per-specialist system prompts + scoped tool categories
│   │   ├── orchestrator.py     # run / run_stream + _agent_loop (bounded tool-use loop)
│   │   └── quick_actions.py    # deterministic "open app / close app / screenshot" fast-path
│   ├── tools/
│   │   ├── base.py             # Tool registry + SAFE / CONFIRMATION_REQUIRED / BLOCKED gate
│   │   ├── system_tools.py     # cpu, memory, disk, battery, network
│   │   ├── mac_tools.py        # open_app, close_app, screenshot, lock_screen, notify
│   │   ├── code_tools.py       # list_dir, read_file, write_file, edit_file, run_command, git_status, git_diff, git_commit
│   │   ├── web_tools.py        # search_web (DuckDuckGo, no key), extract_page_content
│   │   ├── memory_tools.py     # remember, forget, list_memories
│   │   ├── doc_tools.py        # search_documents, list_documents (SQLite RAG)
│   │   ├── vision_tools.py     # see_screen (screencap → llama-3.2-11b-vision)
│   │   ├── productivity_tools.py  # check_email, send_email, list_calendar, reminders
│   │   └── routine_tools.py    # create_routine, list_routines, delete_routine
│   ├── voice/
│   │   ├── stt.py              # Whisper (base.en) — small.en SEGFAULTs on Metal, don't use
│   │   ├── tts.py              # Kokoro-onnx + voice registry (11 voices)
│   │   └── registry.py         # parses voices.bin → af/am/bf/bm + personality metadata
│   ├── documents/
│   │   ├── extract.py          # PDF (pypdf) · DOCX (python-docx) · text
│   │   └── store.py            # SQLite chunked store + Ollama-or-lexical embedding
│   ├── memory/
│   │   └── personal.py         # Supabase-backed, versioned supersession, secret regex refuse
│   ├── workspace/
│   │   └── service.py          # single connected project root + realpath sandbox
│   └── integrations/           # gmail, calendar, google_auth, spotify, weather, reminders, routines, image_gen, websearch
│
├── frontend/                   # Next.js 14 · React 18 · TypeScript · Tailwind
│   ├── app/
│   │   ├── page.tsx            # Chat surface (sidebar + main)
│   │   └── code/page.tsx       # 3-pane IDE (tree · viewer · agent panel)
│   ├── components/
│   │   ├── Composer.tsx        # primary input hub: text · +Add (image/screen/doc) · web toggle · image toggle · model selector · Talk · Send/Stop
│   │   ├── Conversation.tsx    # renders text · markdown · activity chips · source chips · confirm cards · memory notes · attachments
│   │   ├── ModelSelector.tsx   # capability-aware popover (align left/right, up/down)
│   │   ├── Markdown.tsx        # react-markdown + callouts + code blocks with copy
│   │   ├── Sidebar.tsx         # Supabase conversations (search, pin, archive, delete)
│   │   ├── Settings.tsx        # Voice · Memory · Routines · Connectors · About
│   │   └── ThemeToggle.tsx     # light (warm sand) / dark (cool slate) with no-flash inline script
│   ├── hooks/
│   │   ├── useJARVIS.ts        # WS: message events (text, activity, sources, memory, confirm, done)
│   │   ├── useTalk.ts          # streaming voice state machine (idle · listening · thinking · speaking) with barge-in
│   │   ├── useVoice.ts         # legacy batch voice
│   │   ├── useModels.ts        # /models catalog + capabilities
│   │   └── useConversations.ts # Supabase-first, localStorage fallback
│   └── lib/                    # tokens · brand · markdownText · speech · supabase
│
├── macos/
│   ├── scout.py                # rumps menu-bar + AppKit Spotlight panel + NSView Halo overlay + Vosk wake word
│   ├── setup_app.py            # py2app scaffold → dist/Scout.app
│   ├── run_backend.sh          # LaunchAgent entrypoint
│   ├── com.scout.backend.plist # auto-start backend on login
│   └── assets/vosk-model/      # local "Hey Scout" model (gitignored — download separately)
│
├── config/                     # jarvis.json (non-secret) · google_credentials.json (gitignored) · SQLite DBs (gitignored)
├── docs/                       # additional docs (setup guides, native app, video)
└── run.sh                      # dev entry: kills stale ports, starts backend + frontend together
```

---

## Provider seam

`backend/providers/OpenAICompatibleProvider` speaks the OpenAI Chat
Completions schema. Two endpoints share the class:

- **NVIDIA NIM** — `https://integrate.api.nvidia.com/v1` (free tier).
- **Z.AI** — `https://api.z.ai/api/paas/v4` (GLM-5.2, paid).

`backend/providers/catalog.py` lists every model as a `ModelSpec` with
capability flags (`text`, `vision`, `documents`, `tools`, `reasoning`).
Adding a model is one entry; the frontend automatically picks it up via
`GET /models` and adjusts UI gating (image/PDF upload only appears on
vision-capable models; web-search toggle only on tool-capable models).

**No automatic fallback.** If the user selected `nemotron-3-ultra` and the
free tier throws `503 Worker local total request limit reached`, we surface
that error, not a stealth response from a different model.

---

## Tool registry & permission model

Every tool declares one of three permission tiers in `tools/base.py`:

| Tier | Behaviour | Examples |
|---|---|---|
| `SAFE` | Executes immediately | `get_cpu_usage`, `search_web`, `read_file`, `list_directory`, `see_screen` |
| `CONFIRMATION_REQUIRED` | Executes only when `confirm=True`; otherwise returns `needs_confirmation` | `write_file`, `edit_file`, `run_command`, `git_commit`, `send_email`, `open_app`, `close_app` |
| `BLOCKED` | Never executes (denylist) | `rm -rf /`, `mkfs`, `sudo`, `git push`, `curl <url> | sh` |

The gate is enforced at `tools.execute(name, args, confirm=bool)`. Neither
the orchestrator nor a specialist can bypass it — they can only *ask* for
confirmation to be granted, which happens outside the model loop.

Code Mode adds a mode selector:

- **PLAN** — `auto_confirm=∅`. Model is prompted to propose only. No writes.
- **AUTO** — `auto_confirm={write_file, edit_file, rename_path, run_command, git_commit}`. Delete still confirms.
- **BYPASS** — same as AUTO, minus the "propose plan" system-prompt prefix. For power users.

---

## Orchestrator

`backend/agents/orchestrator.py` is the model loop. Two entry points:

- `run(objective, model, agents)` — used by `/agent` and Code Mode. Returns
  a final `AgentResult` after the full plan-execute-synthesise cycle.
- `run_stream(message, model, on_confirm)` — used by `/ws/chat` and
  `/ws/voice`. Streams `{text}` tokens as the model generates, emits
  `{activity}` when tools start, `{sources}` when web tools finish,
  `{memory}` on remember/forget, and yields to `on_confirm` when a
  confirmation-required tool is called mid-stream.

Both share the private `_agent_loop`: a bounded (max 8 steps) tool-calling
loop with a `_transient` retry on 503/429/timeout and a `_finalize` that
guarantees a non-empty user-facing answer (summarises tool results if the
model returns nothing coherent).

The planner (`planner.py`) does model-driven routing: it asks the LLM to
return strict JSON `{complexity: "simple"|"complex", agents: [...]}` and
falls back to `simple` on any parse error. Simple asks run one specialist;
complex asks build a dependency wave that runs specialists in parallel
(where independent) and synthesises the results back through the general
Scout system prompt.

---

## Request flows

### Chat (streaming, with tools)

```
POST /ws/chat  ─┐
                │
                ▼
        ┌───────────────┐
        │ commands.py   │  keyword fast-path (weather, spotify,
        │ (fast-path)   │  see_screen). If it handles, return.
        └──────┬────────┘
               │ else
               ▼
      orchestrator.run_stream
               │
               ▼
        _agent_loop (max 8 steps)
        model → tool call → tool run → repeat
               │
               ├── {text}       stream tokens as generated
               ├── {activity}   "Searching the web", "Reading a file", ...
               ├── {sources}    web search citations
               ├── {memory}     remember/forget notes
               ├── {confirm}    → suspend, surface Confirm/Cancel card
               └── {done}       stream ended (may carry awaiting_confirm)
```

### Voice (streaming per-sentence)

```
Client: WAV bytes over WS  ──▶  /ws/voice
                                    │
                                    ▼
                              Whisper base.en
                                    │
                              {transcript}   ← emitted to client
                                    │
                                    ▼
             provider.stream(gpt-oss-20b, "[Voice reply: 1-2 short sentences] ...")
                                    │
                              accumulated text → _flush_sentences regex
                                    │
                              per sentence  ─▶  Kokoro tts.synthesize
                                    │
                              {text}, {audio} for each sentence
                                    │
                                    ▼
                                 {done}
```

**Why per-sentence:** first-audio latency drops from ~8s to ~2-4s because
sentence 1 plays while the model is still generating sentence 2.

### Code Mode

```
POST /code {objective, model, mode}
     │
     ▼
orchestrator.run(objective, model, agents=["code","documents","productivity"],
                 auto_confirm=_CODE_AUTO if mode!=PLAN else ∅)
     │
     ▼
Code specialist prompted with workspace root + PLAN/AUTO prefix
     │
     ▼
Tool calls: list_directory → read_file → edit_file / write_file / run_command / git_commit
     │  (all path-sandboxed via workspace.service.resolve)
     ▼
AgentResult { activity[], final_text }
```

---

## Voice pipeline

- **Wake:** `Vosk` "Hey Scout" model runs locally in `macos/scout.py`. No
  network. `Porcupine` and `openWakeWord` are fallback engines (set
  `SCOUT_WAKE_ENGINE`).
- **STT:** `pywhispercpp` (whisper.cpp bindings), model `base.en`.
  `small.en` **segfaults** on Metal due to a missing shader — do not use.
- **LLM:** the currently-selected chat model, but `/voice` and `/ws/voice`
  force `VOICE_MODEL="gpt-oss-20b"` (fastest, ~0.5s first token) and
  prepend `"[Voice reply: 1-2 short spoken sentences]"` for snappy replies.
- **TTS:** `kokoro-onnx` with 11 voices (parsed from `voices.bin`). Warmed
  at FastAPI startup so the first `/voice` call isn't cold.
- **Barge-in:** `useTalk.ts` keeps the mic open during playback with
  `echoCancellation`. Detected user speech clears the audio queue and
  starts a new capture; a `turnActiveRef` guard drops stale audio from the
  interrupted turn.

---

## Native macOS shell

`macos/scout.py` is the app. Packaged as a real py2app bundle at
`/Applications/Scout.app` (bundle id `com.scout.app`).

**Why py2app and not a shell wrapper:** LaunchServices suppresses the
menu-bar status item and shows "Python" in ⌘-Tab for anything that isn't a
real binary bundle. Wrapping `python scout.py` in an `.app` folder fails
both. `py2app` produces a genuine app bundle with its own executable, which
LaunchServices treats as first-class.

**Bundle-aware assets:** `_ASSETS` and `_STATE_DIR` in `scout.py` route
resource paths (Vosk model, orb graphics) to `Contents/Resources` when
frozen, and user state (settings, wake toggle) to
`~/Library/Application Support/Scout`.

**Auto-start:** `com.scout.backend.plist` LaunchAgent runs the backend on
login using an explicit `.venv/bin/python3.11`. Scout.app is a macOS
**Login Item** — the app itself is the menu-bar app (an older
`com.scout.menubar` LaunchAgent was removed once the bundle worked).

---

## Persistent memory

Backed by Supabase table `memories` (schema in `docs/supabase-schema.sql`):
`(id, category, key, value, status, confidence, source, timestamps)` with
`status ∈ {current, superseded}`.

`backend/memory/personal.py` exposes:
- `remember(category, key, value)` — supersedes any existing `current` row
  with the same `key`, inserts a new `current`.
- `forget(id)`, `edit(id, value)`, `delete(id)`.
- `context_block()` — injected into the system prompt on every turn, only
  uses `current` rows.
- A regex secret-refuser: won't store anything that looks like an API key
  or credential.

Tools `remember`, `forget`, `list_memories` let the *model* decide when
to persist. Every store/forget emits a `{memory}` WebSocket event so the
frontend can render a "Remembered:" chip inline.

---

## RAG / documents

Local SQLite store at `config/scout_documents.db`. No `chromadb`.

- **Extract** — `documents/extract.py`: PDF via `pypdf` (per-page), DOCX via
  `python-docx`, any UTF-8 text/code file. Handles both binary and text
  uploads through `/documents` (multipart).
- **Chunk** — ~900 characters with 150-char overlap. Filename + page kept
  per chunk for citation.
- **Embed** — Ollama's `nomic-embed-text` when reachable; **lexical
  term-overlap fallback** when not. The fallback is good enough for a
  personal document set (verified across a codeword-lookup test and an
  ACME report Q3 revenue question).
- **Retrieve** — top-k by cosine (embeddings) or overlap (lexical), returned
  with filename + page for citation.

The `documents` specialist and `search_documents` tool make this available
in chat, in Code Mode, and in `/agent` runs.

---

## Code Mode

`backend/workspace/service.py` holds the currently-connected project root
(persisted to `config/scout_workspace.json`). The path resolver:

```python
def resolve(path: str) -> Path:
    root = self._root.resolve(strict=True)
    target = (root / path).resolve()
    if root not in target.parents and target != root:
        raise PermissionError(f"path outside workspace: {path}")
    return target
```

Verified: `resolve("../etc/passwd")` raises. The tool layer never sees an
unresolved path.

- **File tree** — gitignore-aware, streamed to the frontend as a recursive
  `Tree` component.
- **Viewer** — read-only source view; auto-refreshes after a write tool
  completes.
- **Agent panel** — full multi-step orchestrator, with the mode selector
  (PLAN / AUTO / BYPASS) controlling which tools auto-confirm.
- **Native folder picker** — `POST /workspace/pick` runs osascript
  `choose folder` on the host, returning a POSIX path. Browsers can't hand
  you an absolute path from a file input, so we bypass the browser for
  this one step.
- **Sessions** — per-tab conversation history in localStorage (`scout-code-sessions`).

---

## Recurring routines

`backend/integrations/routines.py` — SQLite store
`config/scout_routines.db`. `_parse_schedule` handles natural language:

| Input | Parsed |
|---|---|
| "every morning" | daily at 08:00 |
| "every friday 5pm" | weekly, Fri 17:00 |
| "hourly" / "every 2 hours" | interval |
| "daily at 7:30am" | daily at 07:30 |

A FastAPI `@app.on_event('startup')` loop polls `routines.due()` every
60 seconds and runs each due routine through `orchestrator.run(prompt)`,
recording the result. `pending_notifications()` surfaces once-delivered
notifications to `/routines/notifications`, which the menu-bar app polls
and delivers as a native macOS notification.

---

## Model catalog

Five verified-working NVIDIA models. Removed 4 that timed out or 500'd on
free tier (deepseek-v4-flash, llama-3.3-70b, llama-3.2-90b-vision,
nemotron-nano-vl).

| Model | Latency | Capabilities |
|---|---|---|
| `nemotron-3-ultra` (default) | ~1.1s | text, tools, reasoning |
| `gpt-oss-20b` | ~0.7s | text, tools |
| `nemotron-super-49b` | ~4.6s | text, tools, reasoning |
| `nemotron-3-nano-omni` | ~3.2s | text, tools |
| `llama-3.2-11b-vision` | ~0.5s | text, vision, documents |

Voice always uses `gpt-oss-20b` for speed regardless of the selected chat
model — see [Voice pipeline](#voice-pipeline).

---

## Status

**Verified end-to-end:**
- Chat streaming with tools (web search, memory, documents, code)
- Multi-agent orchestrator (simple + complex paths)
- Code Mode (write, edit, run_command, git_commit; path sandbox blocks
  traversal)
- Persistent memory (supersession verified across separate conversations)
- RAG documents (SQLite fallback + Ollama embedding)
- Streaming voice (backend-verified: first-audio 2.3-4.7s, done 8s for
  multi-sentence — saves ~3.5s over batch)
- Recurring routines (background scheduler + notification queue)
- Confirm/Cancel flow (send_email loop bug fixed)
- Screen vision (vision tool + fast-path)
- Gmail send (real email delivered)

**Verified in browser DOM but not on real hardware:**
- Halo overlay reactive animation (needs a live mic + speakers)
- Talk barge-in loop (needs live mic)
- Menu-bar orb and Spotlight ⌘⌥-Space panel (needs a Mac GUI session,
  can't test headless)

**Not yet verified live:**
- Image generation via NVIDIA `flux.1-schnell` (endpoint proven, but
  free-tier cold-start >200s times out most attempts)
- "Hey Scout" wake accuracy at distance (Vosk model works, but real-world
  false-positive rate untested)

---

## Known limits

- Voice floor is Whisper STT (~0.5s) + first-token latency (~1-2s) +
  Kokoro synth (~1s). True sub-second requires streaming ASR + streaming
  TTS providers — bigger swap than we've done.
- NVIDIA free tier caps parallel workers at 32 — under heavy parallel
  agent load you'll see `503 Worker local total request limit reached`.
  The orchestrator retries and degrades gracefully; the message is
  honest, not silent.
- `commands.py` fast-path still hardcodes `", sir"` in several handlers
  (weather, spotify, gmail summary) — a leftover from the pre-rebrand
  era. Chat path is clean.
- Native app requires macOS-specific permissions the user must grant once
  in System Settings: Microphone, Accessibility (for global hotkey),
  Screen Recording (for `see_screen`), Notifications.

---

*For historical context on how each of these systems was built and what
was removed along the way, see `ARCHITECTURE_MIGRATION.md`.*
