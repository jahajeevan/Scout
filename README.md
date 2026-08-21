# Scout — Personal Intelligence

> A native macOS AI assistant that hears you across the whole system, understands
> what's on your screen, and can actually do things — edit code in your project,
> commit it, send email, schedule reminders, run tools with your permission.
>
> Not a chatbot in a browser tab. A live workspace agent with a wake word, a
> reactive halo overlay, streaming voice, and hands.

<p align="center">
  <img src="docs/hero.gif" alt="Scout Halo overlay reacting to voice" width="720">
</p>

<p align="center">
  <sub>
    <b>"Hey Scout"</b> → screen vision → multi-agent planning → tool use with permission gate →
    per-sentence streamed voice reply.
  </sub>
</p>

---

## The idea

Most AI assistants are a website you visit. The interesting problem is the one
Iron Man's JARVIS pointed at almost fifteen years ago: an assistant that lives
in the OS, not the tab. Something you can *talk to while you work*, that can
see what you're looking at, act on your code, and hand control back before it
does anything you'd regret.

Scout is my attempt at that, built on top of NVIDIA's model catalog (Nemotron
Ultra, gpt-oss, Llama vision) with a native macOS shell, a permission-gated
tool registry, and a multi-agent orchestrator that plans before it acts.

---

## What works today

**Voice loop** — Vosk-based *"Hey Scout"* wake word runs locally; utterance
streams to Whisper for STT; reply streams back sentence-by-sentence through
Kokoro TTS. First audio in ~2–4s, saving ~3.5s over batch synthesis by
speaking sentence 1 while the model is still generating sentence 2.

**Native macOS shell** — packaged as a real `py2app` bundle (`Scout.app`,
bundle id `com.scout.app`). Menu-bar orb, Spotlight-style ⌘⌥-Space panel with
NSVisualEffectView blur, always-on-top Halo overlay with a reactive bar-ring
that pulses to the real microphone envelope while listening and the real TTS
envelope while speaking. Auto-starts via a LaunchAgent.

**Multi-agent orchestrator** — a planner routes simple asks to a single
specialist and complex asks to a dependency-wave of parallel specialists
(research, system, mac, code, documents, productivity, memory) whose outputs
are synthesised back in Scout's voice. Every tool call passes through a
three-tier permission gate (SAFE runs, CONFIRMATION_REQUIRED waits for
approval, BLOCKED refuses).

**Code Mode** — a workspace-scoped coding agent. Connect a folder, get a
sandboxed file tree, viewer, and agent panel. `write_file`, `edit_file`,
`run_command`, `git_commit` all require confirmation unless you're in AUTO
mode; `delete_path` and `rm -rf /` are always confirmed / blocked. The
path resolver uses `realpath` and refuses anything outside the workspace root
(verified: `../etc/passwd` denied).

**Retrieval / documents** — upload PDF/DOCX/text through the composer. Scout
chunks (~900 chars, 150 overlap) into a local SQLite store, embeds via Ollama
when available and falls back to lexical term-overlap when not, retrieves the
top-k with filename + page citations. No numpy conflict, no Chroma required.

**Persistent personal memory** — Supabase-backed store with versioned
supersession: telling Scout "editor: Cursor" then later "actually VS Code"
marks the first entry as `superseded` and creates a new `current` one; the
context block that gets injected into the system prompt on every turn only
uses `current`. Refuses to store secrets (regex filter). Fully editable from
the Settings UI.

**Screen vision** — a `see_screen` tool takes a native screencap, downscales
to 1500px JPEG, sends it to the Llama 3.2 11B vision model. Bridges the
"vision models can't call tools, tool models can't see" split by doing the
vision call inside the tool.

**Recurring routines** — natural-language scheduling ("every morning",
"every friday 5pm", "in 2 hours") persisted in SQLite. A background loop
polls due routines every 60 seconds and runs them through the orchestrator;
delivery is a native macOS notification via the menu-bar app.

**Connectors** — Gmail (read/send with confirm gate), Google Calendar
(upcoming events), reminders. Send-email loop-bug fixed in `run_stream` by
adding an `on_confirm` callback so the WebSocket surfaces a Confirm/Cancel
card to the user *once* rather than looping "ACTION NOT PERFORMED" back to
the model forever.

**Multi-model, honest** — 5 verified-working NVIDIA models in the catalog
(`nemotron-3-ultra` default, `gpt-oss-20b` fastest, `nemotron-super-49b`
reasoning, `nemotron-3-nano-omni`, `llama-3.2-11b-vision`). If the selected
model fails, Scout says so — no silent fallback to a different one.

---

## Quickstart

Prerequisites: **macOS Apple Silicon**, **Python 3.11**, **Node.js 20+**, a
free **NVIDIA NIM API key** from [build.nvidia.com](https://build.nvidia.com).

```bash
git clone https://github.com/jahajeevan/scout.git
cd scout

# 1. Backend deps
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Frontend deps
cd frontend && npm install && cd ..

# 3. Configure
cp .env.example .env             # add NVIDIA_API_KEY
cp frontend/.env.example frontend/.env.local

# 4. Run
./run.sh                         # backend + frontend, one command
```

Open [http://localhost:3000](http://localhost:3000). For the voice + wake-word
+ Halo overlay, follow `docs/native-app.md`.

---

## Architecture

```
┌─ macOS ──────────────────────────────────────────────────────┐
│  Scout.app (py2app)                                          │
│  ├─ Menu-bar orb (rumps)                                     │
│  ├─ Spotlight ⌘⌥-Space (NSPanel + NSVisualEffectView)        │
│  ├─ Halo overlay (NSView bar-ring, reacts to mic + TTS)      │
│  └─ Wake word: Vosk "Hey Scout" (local, no cloud)            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼  WebSocket
┌─ Backend (FastAPI, Python 3.11) ─────────────────────────────┐
│                                                              │
│   ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   │
│   │ /ws/voice   │   │ /ws/chat     │   │ /code, /agent  │   │
│   │ streaming   │   │ streaming    │   │ orchestrator   │   │
│   └──────┬──────┘   └──────┬───────┘   └────────┬───────┘   │
│          │                 │                    │           │
│          └─────────────────┼────────────────────┘           │
│                            ▼                                │
│                   ┌────────────────┐                        │
│                   │  Orchestrator  │  ← planner routes      │
│                   │  + Specialists │    simple / complex    │
│                   └────────┬───────┘                        │
│                            ▼                                │
│                    ┌───────────────┐                        │
│                    │ Tool registry │  ← SAFE /              │
│                    │  code · web · │    CONFIRMATION_REQ /  │
│                    │  docs · mac · │    BLOCKED             │
│                    │  memory · vis │                        │
│                    └───────┬───────┘                        │
│                            │                                │
│      ┌─────────────────────┼─────────────────────┐          │
│      ▼                     ▼                     ▼          │
│  NVIDIA NIM         Supabase              Local: SQLite     │
│  (5 models)         (memory, history)     RAG · reminders · │
│  Whisper (STT)                            routines · docs   │
│  Kokoro (TTS)                                               │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─ Frontend (Next.js 14) ──────────────────────────────────────┐
│  Chat · Code Mode (3-pane IDE) · Settings                    │
│  Serif hero, warm terracotta accent (light + slate dark)     │
└──────────────────────────────────────────────────────────────┘
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full module map, request
flows, and permission model.

---

## What broke, and how I got out

A representative sample — the whole point of building this was to learn what
"AI judgment" actually means when a tool call goes sideways.

**Send-email infinite confirm loop.** First version of `send_email` correctly
refused to send without confirmation — it returned `needs_confirmation` and
the orchestrator dutifully fed "ACTION NOT PERFORMED, ask user" back to the
model. Model asked the user. User said yes. Model re-called `send_email`. Same
refusal. Same message back. Loop. The user had no way to actually *grant*
consent through chat. Fix: `run_stream` now takes an `on_confirm` callback;
when a tool needs confirmation the stream *stops*, emits a `{tool, args,
prompt}` event, and the WebSocket surfaces a Confirm/Cancel card. On approval
the frontend sends `confirm_yes` and the tool is executed with `confirm=True`.
The model never sees the loop, because there isn't one.

**Screen vision failing with "All connection attempts failed."** After
building the `see_screen` tool on NVIDIA vision, users still got the same
Ollama-era error. Root cause: an old keyword fast-path in `commands.py` that
ran *before* the orchestrator was silently routing "look at my screen" to a
long-defunct local LLaVA endpoint. The tool worked. The fast-path was hiding
it. Fix: replaced the fast-path block to call `vision_tools._see_screen`
directly. Also flagged the broader lesson — a fast-path that catches keywords
before the tool router is easy to forget when you upgrade the tool.

**py2app menu-bar suppression.** Wrapped `scout.py` in a plain shell `.app`
bundle. `open Scout.app` launched Python, but the menu-bar orb never
appeared, and ⌘-Tab showed "Python" instead of "Scout". LaunchServices
suppresses the status item of anything that isn't a real app bundle with its
own binary. Fix: proper `py2app setup_app.py`, code-signed identity path,
bundle-aware asset loading via `_ASSETS` / `_STATE_DIR` (frozen → Resources /
Application Support). Now Scout.app really is Scout.

**numpy 1 vs 2.** `requirements.txt` originally listed `chromadb` (needs
numpy < 2) and `kokoro-onnx` (needs numpy ≥ 2). No overlap. Fix: dropped
Chroma, built the RAG store on SQLite with 900-char chunking and a lexical
term-overlap fallback for when the embedding model isn't running. Retrieval
quality is fine for a personal document set; the install is a single `pip`
that actually works.

---

## Tech stack

| Layer | Choices |
|---|---|
| Models | NVIDIA NIM (Nemotron Ultra, gpt-oss-20b, Nemotron Super 49B, Llama 3.2 Vision) |
| Voice | Vosk (wake word), Whisper (STT), Kokoro (TTS), streaming via WebSocket |
| Backend | Python 3.11, FastAPI, httpx, SQLite, Supabase (optional) |
| Frontend | Next.js 14, React 18, TypeScript, Tailwind, react-markdown |
| Native | py2app, rumps, PyObjC (Cocoa, Quartz, AVFoundation, ApplicationServices) |
| Docs | pypdf, python-docx (RAG extraction) |

---

## Status

Working, honest about the edges. See [`ARCHITECTURE.md`](ARCHITECTURE.md#status)
for the "verified vs unverified" matrix — some paths (native app GUI, mic
barge-in on real hardware, screen vision permission grant) can only be tested
on a live Mac desktop and are marked as such.

---

## License

MIT — see [`LICENSE`](LICENSE).
