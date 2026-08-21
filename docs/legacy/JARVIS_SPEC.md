# JARVIS — Project Specification
> This document is the single source of truth. Build ONLY what is written here. Do not add extra features, libraries, or tools not listed. Do not make assumptions. Ask before deviating from anything in this file.

---

## 1. What This Is

A local, fully offline AI assistant OS called **JARVIS** — inspired by Iron Man but built with a premium, cinematic aesthetic. Runs 100% on the user's Mac M4 Air. Zero API costs. No internet required after setup.

**NOT** a chatbot wrapper. NOT a dashboard template. It is a cinematic AI operating system with voice, gestures, live data, and a holographic-style HUD interface.

---

## 2. Machine

| Property | Value |
|---|---|
| Device | MacBook Air M4 |
| RAM | 16 GB unified |
| OS | macOS (Apple Silicon) |
| Runtime | Native ARM — all tools must be Apple Silicon compatible |

---

## 3. Full Tech Stack

Use EXACTLY these. No substitutions.

### AI / Brain
| Layer | Tool | Why |
|---|---|---|
| Local LLM | `ollama` + `qwen2.5:14b` | Free, 128k context, fastest on M4 |
| STT | `whisper.cpp` (Python binding: `pywhispercpp`) | Local, fast on M4 |
| TTS | `kokoro-tts` (local Python) | Best free local voice, Apache licensed |
| Wake word | `openwakeword` | Completely free, Apache 2.0 |
| Long-term memory | `chromadb` | Local vector database |
| Short-term memory | In-context conversation (last 30 turns stored in Python) |
| Pref storage | `sqlite3` (Python stdlib) |

### Backend
| Layer | Tool |
|---|---|
| Framework | `FastAPI` |
| Python version | `3.11` |
| Realtime | `websockets` via FastAPI |
| Task runner | `asyncio` |
| Gesture bridge | Python `mediapipe` → WebSocket → Frontend |

### Frontend
| Layer | Tool |
|---|---|
| Framework | `Next.js 14` (App Router) |
| Language | `TypeScript` |
| Styling | `Tailwind CSS` + inline styles for custom animations |
| Animation | `Framer Motion` |
| Fonts | `Space Grotesk` + `JetBrains Mono` (Google Fonts) |
| State | `useState` / `useEffect` (no Redux, no Zustand yet) |
| WebSocket client | Native browser WebSocket |

### Gesture Control
| Layer | Tool |
|---|---|
| Library | `mediapipe` (Python, `mediapipe` pip package) |
| Camera access | OpenCV (`opencv-python`) |
| Bridge | WebSocket server → sends gesture events to frontend |

### Process management
| Tool | Use |
|---|---|
| `pm2` | Keep all services running (backend, gesture, frontend) |

---

## 4. UI Design — Exact Spec

> Do not change this. Every visual decision is intentional.

### Color Tokens
```
Background:     #030508   (deep space, warm-tinted black)
Glass panel:    rgba(255,255,255,0.052)
Panel border:   rgba(255,255,255,0.09)
Panel border hover: rgba(240,168,48,0.22)
Gold primary:   #F0A830
Gold bright:    #FFD060
Gold glow:      rgba(240,168,48,0.28)
Blue accent:    #5BA8F0
Blue glow:      rgba(91,168,240,0.18)
Green:          #44D880
Red:            #F05060
Text 100%:      rgba(255,255,255,1)
Text 70%:       rgba(255,255,255,0.7)
Text 30%:       rgba(255,255,255,0.3)
```

### Typography
```
Display / UI labels:  Space Grotesk (weights 400, 600, 700)
All numbers / data:   JetBrains Mono (weights 400, 700)
```

### Panel Style
- `backdrop-filter: blur(22px)` on all panels
- `border-radius: 16px`
- `border: 1px solid rgba(255,255,255,0.09)` → `rgba(240,168,48,0.22)` on hover
- `box-shadow: 0 4px 28px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)`
- 3D tilt effect on mouse hover: `perspective(750px) rotateY(Xdeg) rotateX(-Ydeg)`
- Glint sweep animation on hover
- Scan line animation (per panel, staggered delays)

### Arc Reactor (center hero element)
- Pure SVG, 218px, rendered in center panel
- 4 rotating layers: outer 3 arcs (CW 8s) · mid 3 arcs (CCW 5.5s) · inner dashed (CW 3.2s) · triangle frame (CCW 20s)
- SVG glow filters at 3 intensities (f-glow, f-core, f-soft)
- Pulsing radial gradient core
- Color: gold (#F0A830 / #FFD060), NOT blue, NOT cyan

### Background
- Two slow aurora radial gradients (gold + blue, 14s + 19s animation cycles)
- Subtle perspective grid (54px, rgba(255,255,255,.02))
- 20 floating particles (gold/blue/white, rising continuously)

### Layout
```
┌────────────────────────────────────────────────────────┐
│  TOP BAR: Logo · Status chips · Live clock            │
├──────────┬──────────────────────────┬──────────────────┤
│  LEFT    │       CENTER             │   RIGHT          │
│  195px   │       flex-1             │   195px          │
│          │                          │                  │
│ Gauges   │  Arc Reactor hero        │  Schedule        │
│ Voice    │  Status strip            │  Gestures        │
│ Weather  │  Chat window             │  Intel feed      │
├──────────┴──────────────────────────┴──────────────────┤
│  BOTTOM BAR: Stack labels · Status                    │
└────────────────────────────────────────────────────────┘
```

### Gauges
- 270° speedometer-style SVG arcs (NOT bar charts)
- Smooth `stroke-dasharray` transitions (1.5s ease)
- `drop-shadow` glow filter on filled arc
- Colors: CPU=Gold, RAM=Blue, GPU=Purple, Battery=Green

### Voice Visualizer
- Animated SVG sine wave (NOT bar charts)
- Updates every 40ms, composite of 2 harmonics + Gaussian envelope
- LinearGradient that fades at edges
- Active state: tall, bright gold · Inactive: small, dim

---

## 5. What NOT to Build

- ❌ No OpenAI API, no Anthropic API, no paid APIs of any kind
- ❌ No ElevenLabs (use Kokoro TTS only)
- ❌ No Porcupine wake word (use openWakeWord only)
- ❌ No Redux, Zustand, or external state managers in Phase 1
- ❌ No Docker (run everything natively)
- ❌ No databases other than ChromaDB + SQLite
- ❌ No cloud deployment of any kind
- ❌ No TypeScript "any" types — type everything properly
- ❌ No hardcoded port numbers anywhere except the config file
- ❌ No UI component libraries (shadcn, MUI, etc.) — build custom
- ❌ Do not change the color scheme or fonts under any circumstances

---

## 6. Folder Structure

```
jarvis/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py            # All config (ports, model names, paths)
│   ├── llm.py               # Ollama API calls
│   ├── voice/
│   │   ├── stt.py           # Whisper.cpp speech-to-text
│   │   ├── tts.py           # Kokoro TTS text-to-speech
│   │   └── wake.py          # openWakeWord listener
│   ├── memory/
│   │   ├── short_term.py    # In-context conversation store
│   │   ├── long_term.py     # ChromaDB vector memory
│   │   └── prefs.py         # SQLite preferences
│   ├── gesture/
│   │   ├── tracker.py       # MediaPipe hand tracking
│   │   └── ws_bridge.py     # WebSocket gesture broadcaster
│   └── integrations/        # (Phase 4 — leave empty for now)
│       ├── gmail.py
│       ├── calendar.py
│       └── spotify.py
├── frontend/
│   ├── app/
│   │   ├── layout.tsx       # Root layout
│   │   └── page.tsx         # Main HUD page
│   ├── components/
│   │   ├── ArcReactor.tsx   # SVG arc reactor component
│   │   ├── Panel.tsx        # Glass panel with tilt
│   │   ├── Gauge.tsx        # 270° SVG gauge
│   │   ├── VoiceWave.tsx    # Sine wave visualizer
│   │   ├── ChatWindow.tsx   # Conversation component
│   │   ├── CalRow.tsx       # Calendar event row
│   │   └── Particles.tsx    # Background particles
│   ├── hooks/
│   │   ├── useJARVIS.ts     # WebSocket connection to backend
│   │   ├── useLiveData.ts   # System stats polling
│   │   └── useGestures.ts   # Gesture WebSocket listener
│   ├── styles/
│   │   └── globals.css      # Keyframes + base styles
│   └── lib/
│       └── tokens.ts        # All design tokens (colors, fonts)
├── config/
│   └── jarvis.json          # User preferences (name, wake word, etc.)
├── ecosystem.config.js      # pm2 process manager config
├── requirements.txt         # Python deps
└── README.md
```

---

## 7. Build Phases

### Phase 1 — Voice + AI Core (START HERE)
**Goal:** You speak → JARVIS hears → JARVIS replies out loud

Tasks:
1. Scaffold the full folder structure above (all files, even if empty with a comment)
2. `backend/config.py` — all config vars
3. `backend/llm.py` — async function that sends prompt to Ollama and streams response
4. `backend/voice/stt.py` — record from mic → transcribe with Whisper.cpp
5. `backend/voice/tts.py` — text → Kokoro TTS → play audio
6. `backend/main.py` — FastAPI with:
   - `POST /chat` — receives text, returns JARVIS response text
   - `WS /ws/chat` — WebSocket for real-time streaming
   - `GET /health` — health check
7. Test: `curl` the `/chat` endpoint, get a response
8. Wire STT → LLM → TTS in a single async loop
9. Test: speak into mic, JARVIS speaks back

**Phase 1 is complete when:** You say "Hello JARVIS" and hear a voice response.

### Phase 2 — Frontend HUD
- Build all React components per the UI spec above
- Connect to backend WebSocket
- Show live system stats
- Voice wave reacts to mic input

### Phase 3 — Gesture Control
- MediaPipe hands on webcam
- 10 gestures mapped (from spec below)
- WebSocket bridge to frontend
- Frontend panels respond to gestures

### Phase 4 — Integrations
- Gmail, Google Calendar, Spotify, Weather, News

### Phase 5 — Memory + Wake Word
- ChromaDB long-term memory
- openWakeWord "Hey JARVIS" activation
- Cross-session recall

### Phase 6 — Vision + Smart Home
- Screen capture → LLaVA vision model via Ollama
- Home Assistant integration

---

## 8. Gesture Map

| Gesture | Action |
|---|---|
| Pinch (thumb + index) | Select / click |
| Open palm spread | Zoom out / expand |
| Pinch close | Zoom in / shrink |
| Fist rotate CW | Dial clockwise |
| Fist rotate CCW | Dial counter-clockwise |
| Two-finger swipe left/right | Navigate panels |
| Index point + hold | Cursor mode |
| Two hands spread apart | Full overview mode |
| Peace sign ✌️ | Toggle voice input |
| Thumbs up | Confirm last suggestion |

---

## 9. JARVIS Personality System Prompt

```
You are JARVIS (Just A Rather Very Intelligent System), sir's personal AI assistant.
You are witty, precise, and always composed. You address the user as "sir" by default.
Keep responses concise unless detail is explicitly requested.
You have access to the user's calendar, email, system stats, and files.
You can see, hear, remember, and act.
When uncertain, ask one clear question rather than guessing.
Never break character. Never mention that you are a language model.
```

---

## 10. Python Dependencies (requirements.txt)

```
fastapi==0.111.0
uvicorn[standard]==0.30.1
websockets==12.0
httpx==0.27.0
pywhispercpp==1.2.0
kokoro-onnx==0.3.5
sounddevice==0.4.6
numpy==1.26.4
chromadb==0.5.3
mediapipe==0.10.14
opencv-python==4.10.0.84
openwakeword==0.6.0
pyaudio==0.2.14
python-multipart==0.0.9
```

---

## 11. Frontend Dependencies (package.json additions)

```json
{
  "next": "14.2.5",
  "react": "18.3.1",
  "react-dom": "18.3.1",
  "typescript": "5.5.3",
  "tailwindcss": "3.4.6",
  "framer-motion": "11.3.19",
  "@types/node": "20.14.14",
  "@types/react": "18.3.3"
}
```

---

## 12. Config File (config/jarvis.json)

```json
{
  "user_name": "sir",
  "wake_word": "hey jarvis",
  "backend_port": 8000,
  "gesture_ws_port": 8001,
  "frontend_port": 3000,
  "ollama_host": "http://localhost:11434",
  "ollama_model": "qwen2.5:14b",
  "whisper_model": "base.en",
  "context_window": 30,
  "tts_voice": "af_bella",
  "camera_index": 0
}
```

---

## 13. pm2 Config (ecosystem.config.js)

```js
module.exports = {
  apps: [
    {
      name: "jarvis-backend",
      script: "uvicorn",
      args: "backend.main:app --host 0.0.0.0 --port 8000 --reload",
      interpreter: "python3.11",
    },
    {
      name: "jarvis-gestures",
      script: "backend/gesture/tracker.py",
      interpreter: "python3.11",
    },
    {
      name: "jarvis-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "run dev",
    },
  ],
};
```

---

## 14. Start with Phase 1 Only

When given this file, begin with **Phase 1 only**. Do not build Phase 2-6 yet. Complete Phase 1 fully and confirm it works before moving to the next phase. Each phase must be tested and confirmed working before the next begins.

