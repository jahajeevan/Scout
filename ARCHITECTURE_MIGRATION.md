# JARVIS — Architecture Migration Plan

_From a working Phase-1→7 local assistant to a system-wide, multi-agent, NVIDIA-powered AI OS — **incrementally, without destroying what works** (spec §22)._

Status legend: ✅ done · 🟡 in progress · ⬜ planned

---

## 1. Current state (what actually exists today)

Inspected the repo directly. This is **not** a prototype — it's a clean, modular system. Nothing here gets thrown away wholesale.

| Area | Today | Keep / Change |
| --- | --- | --- |
| Backend | FastAPI (`backend/main.py`), config-driven ports, no hardcoding | **Keep**, extend |
| LLM | `backend/llm.py` — hand-rolled Ollama + Claude over httpx | **Replaced** by provider seam ✅ |
| Speech | Whisper.cpp STT + Kokoro TTS + openWakeWord, real `voice_loop()` | **Keep** as fallback; add NVIDIA behind a `VoiceProvider` |
| Memory | `backend/memory/` — short-term + SQLite/Ollama-embedding long-term | **Keep**, formalize into `MemoryService` categories |
| Commands | `backend/commands.py` — keyword router for 9 integrations | **Wrap** as agent tools; keep as fast-path |
| Integrations | gmail, calendar, spotify, weather, news, vision(LLaVA), home_assistant, phone(ADB/IR) | **Keep all** — become Mac/Productivity/Vision agent tools |
| Frontend | Next 14 + React 18 + Three.js + framer-motion HUD (`ArcReactor`, `VoiceWave`, gauges, phone mirror) | **Keep + elevate** to the premium light command-center |
| Config | `config/jarvis.json` single source of truth; secrets only from env | **Keep** — the model for all new config |

**Known constraint (from memory):** `requirements.txt` is unsatisfiable as one env — `kokoro-onnx` needs numpy≥2, `chromadb` needs numpy<2. Long-term memory already sidesteps this with SQLite. RAG will use the same SQLite-vector approach, **not** Chroma.

---

## 2. Target state

```
Voice / Text / Vision  →  JARVIS Orchestrator  →  specialist agents
                                                    (Research·Coding·Vision·Mac·Productivity·Memory)
                              ↓                        ↓
                   AIProvider (Nemotron-3 Ultra)  Tool Registry → Permission gate → execution
                              ↓
              NVIDIA NIM (default) · Z.AI (GLM-5.2) · Ollama (embeddings only)
```

One brain interface, one tool registry, one permission system, one memory service, one coherent JARVIS.

---

## 3. Phases (each independently shippable & testable)

### Phase A — AI provider abstraction ✅ **DONE**
- `backend/providers/` — `AIProvider` interface (`stream_events` + `complete` with `tool_calls`) and one `OpenAICompatibleProvider` instance per endpoint (NVIDIA NIM + Z.AI), streaming + tools + vision-ready.
- **Capability-aware catalog, explicit selection, no silent fallback** (owner decision). `catalog.py` lists the selectable brains with per-model `text/tools/vision/documents` flags; `registry.py` holds the active selection. The **default brain is `nemotron-3-ultra`** (flagship, reliable) — GLM-5.2 stays in the seam via Z.AI and can be reselected. If the chosen model's endpoint is unreachable the call raises a clear error and Scout says so honestly rather than swapping models. (Ollama is used *only* as the local embedding backend for long-term memory — not a reasoning fallback.)
- `llm.py` reduced to a backward-compatible facade → **zero changes** in `main.py`/`commands.py`.
- Provider hardened: fail-fast timeout (no 100s hangs on a cold model), token budget for reasoning models, `reasoning_content` captured for observability.

### Phase B — Tool registry + permission system ✅ **DONE**
- `backend/tools/` — `Tool` (name, JSON schema, permission level SAFE/CONFIRMATION_REQUIRED/BLOCKED, handler, human-readable `ToolResult`), enforced by `ToolRegistry.execute` as the single OS entry point.
- Registered groups: `system_tools`, `mac_tools` (open/close/switch app, screenshot, volume/brightness, lock, sleep), `web_tools`, `memory_tools`.
- No unrestricted shell tool — every handler runs a fixed command with validated args (spec §6/§7). _Still to wrap as tools: media/productivity/vision._

### Phase C — Multi-agent orchestrator ✅ **DONE**
- `backend/agents/orchestrator.py` — streaming chat loop (`run_stream`, the fast `/ws/chat` path) **plus** a real multi-agent `run` (the `/agent` path).
- `backend/agents/specialists.py` — functional specialists (research/system/mac/memory/general), each with a focused system prompt and a scoped slice of the tool registry (still only acting through the permission gate).
- `backend/agents/planner.py` — model-driven simple-vs-complex routing (spec §7); complex objectives decompose into a dependency-ordered plan (≤5 steps), fall back to "simple" on any malformed plan.
- `run` executes: plan → single specialist (simple) **or** dependency-waves run in parallel where independent, then a synthesis pass in Scout's voice (complex, spec §28). Per-step retry on transient provider errors + honest degradation; `/agent` never 500s.
- **Verified live:** simple objective → one `system` specialist; complex ("search latest iPhone + report CPU, then summarise") → planner + parallel research/system + cited synthesis.

### Phase D — Web research subsystem ✅ **DONE (single-agent)**
- `integrations/websearch.py` + `web_tools` — real DuckDuckGo HTML search + `fetch_page` extraction, sources streamed to the UI via the `sources` event. Honest empty-on-failure, no fabrication (spec §4).
- _Not yet:_ a dedicated `ResearchAgent`; the orchestrator calls the web tools directly.

### Phase J — Documents / RAG ✅ **DONE**
- `backend/documents/` — `extract.py` (PDF via pypdf, DOCX via python-docx, any UTF-8 text/data/code file; per-page for PDFs) + `store.py` (SQLite-vector at `config/scout_documents.db`: chunk → embed via Ollama **when available**, else lexical term-overlap fallback → retrieve top-k with filename/page citations). SQLite-vector, **not** Chroma (numpy conflict).
- `backend/tools/doc_tools.py` — `search_documents` + `list_documents` (category "documents"), so any tool-capable model retrieves in chat automatically; plus a `documents` specialist for the planner.
- API: `POST /documents` (upload→index), `GET /documents`, `DELETE /documents/{id}`.
- Frontend: composer `+ → Upload document` (capability-aware: documents need a tool model, images need vision), doc chips with uploading→Indexed→failed states, drag-drop routes images vs docs, remove deletes from the store.
- **Verified live:** uploaded a report → asked in chat → model retrieved and answered with the real figures; same via `/agent` (documents specialist cited filename). Works without Ollama (lexical fallback).

### Phase K — Code mode (workspace + file/git tools) ✅ **DONE (v1, no terminal yet)**
- `backend/workspace/service.py` — a single connected project root + a hard path **sandbox** (`resolve` realpath-checks every path; `../` traversal and out-of-root symlinks are refused), a `.gitignore`-aware file tree, persisted to `config/scout_workspace.json`.
- `backend/tools/code_tools.py` — read/list/search + git status/diff (**SAFE**); write/edit/rename/delete (**CONFIRMATION_REQUIRED**). All sandboxed; **no arbitrary-shell tool**.
- `code` specialist + registry entry; orchestrator gained an `auto_confirm` policy threaded through `run`/`_agent_loop`.
- **PLAN / AUTO / BYPASS** (spec §19): PLAN proposes only (writes never execute), AUTO/BYPASS auto-approve create/edit/rename, **delete always confirms** in every mode.
- API: `GET/POST /workspace`, `POST /workspace/disconnect`, `GET /workspace/file`, `POST /code {objective, mode}`.
- Frontend: `/code` route — three-pane IDE-agent (file tree · viewer · code agent), workspace connect, mode segmented control, model selector, `Code` link from the chat topbar.
- **Verified live:** connected a project → PLAN proposed without writing → AUTO edited a real file (read-before-edit, viewer auto-refreshed, change confirmed on disk) → sandbox refused `/etc/passwd` via both the tool and the API.
- _Deferred to 6.2:_ terminal/command execution (its own controlled-execution policy), git commit/push, in-viewer diffs.

### Phase E — Voice provider (NVIDIA) ⬜
- `VoiceProvider` seam; NVIDIA Nemotron ASR-streaming + Riva TTS as independent services; keep Whisper+Kokoro as offline fallback. Barge-in/interruption at the app layer (spec §2/§3).

### Phase F — Vision provider ⬜
- `VisionProvider` seam; screen + camera capture → multimodal NIM model → structured observations to the orchestrator. macOS Screen Recording / Camera permission handling (spec §7/§9/§10).

### Phase G — macOS menu-bar background service ⬜
- `macos/` `rumps`-based menu-bar app: wake-word listener, state display, pause/quit, talks to the backend. Auto-start via LaunchAgent (spec §3/§10).

### Phase H — Premium UI elevation ⬜
- Light-first glass command center, reactive JARVIS core states, activity timeline, sources, privacy center, setup wizard (spec §11–§32).

### Phase I — Tests + acceptance suite ⬜
- Per-subsystem tests + the numbered acceptance flows (spec §22/§26).

---

## 4. Files (Phases A–D as actually built)
```
backend/providers/base.py            backend/providers/openai_compat.py
backend/providers/catalog.py         backend/providers/registry.py
backend/tools/base.py                backend/tools/{system,mac,web,memory}_tools.py
backend/agents/base.py               backend/agents/orchestrator.py
backend/agents/registry.py           backend/integrations/websearch.py
```
## Files modified
```
backend/llm.py        → thin facade over the registry (public API unchanged)
backend/config.py     → PRODUCT_NAME/identity, catalog config, DEFAULT_MODEL=nemotron-3-ultra
config/jarvis.json    → product_name=Scout, wake_word="hey scout", llm_provider=nvidia
backend/main.py       → orchestrator-backed /ws/chat, vision/voice/memory/model endpoints
```

## 5. Risks
- **NVIDIA voice** is ASR + TTS as *separate* NIM/Riva services (gRPC), not one "VoiceChat" API — handled by the independent-services design in Phase E.
- **numpy conflict** — RAG stays on SQLite-vector, not Chroma.
- **macOS permissions** (Screen Recording, Accessibility, Camera, Mic) require manual user approval — surfaced in the setup wizard, never auto-granted.

## 6. Test plan
Each phase ships with: import smoke test → unit test of the new seam → one end-to-end acceptance command. Phase A verified (registry registration, fallback, backward-compat facade).
