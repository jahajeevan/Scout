# Scout — Razorpay Buildathon Video Script (5:00)

> **Read this once end-to-end before recording.** Then rehearse the flow 3
> times without recording. Only start QuickTime on the 4th run.
>
> **Recording setup:**
> - `⌘⇧5` → **Record Entire Screen** (or "Record Selected Portion" for a
>   focused window)
> - **Options → Microphone:** Built-in Microphone (or your preferred one)
> - **Options → Show Mouse Clicks:** ON (helps reviewers follow along)
> - **Options → Save to:** Desktop (find it easily later)
> - Close all apps except Scout, VS Code, Terminal, and a browser tab
>   showing the Scout repo
> - Turn on **Do Not Disturb** (Notification Center → Focus)
> - Close every browser tab that isn't Scout or the repo
> - Kill any background music / Zoom / Slack (they show up in recordings)
>
> **Speak like a person.** This is a pitch to another builder, not a keynote.
> Read the script conversationally, then talk over the demo like you're
> showing a friend. It's fine to say "uh," pause, breathe.

---

## Opening — 0:00 → 0:20 (20 sec)

**Show:** Scout's home screen — the empty chat with the greeting "Good
evening, Jeev · what are we doing?" and the 6 colored tiles.

**Say (word for word):**

> "Hey. This is Scout. It's a personal AI assistant that lives on my Mac
> — not in a browser tab, not in an IDE. I built it because every AI I
> use is a website I have to switch to. Scout is always here. It hears
> me across the OS, it sees what's on my screen, and it actually does
> things on my machine — with permission. Let me show you three
> things."

---

## Beat 1 — Personality & GIFs — 0:20 → 1:00 (40 sec)

**Show:** Chat surface. Type in composer: "yo bro just shipped my scout
build 🚀"

**Do:** Hit Enter. Scout replies casually ("ayyy congrats mate 🙌
what's next?" or similar) — hopefully with a celebration GIF via
`send_gif` tool.

**Say (over the reply appearing):**

> "First — Scout doesn't talk like an AI. I rewrote its personality to
> reply like a friend. Casual, uses emoji, sends GIFs when the moment
> is right. That personality lives in one system prompt and is
> reinforced by a `send_gif` tool that queries Giphy. So instead of
> 'How may I assist you today,' I get… this."

**Optional beat:** Click the GIF picker button, search "high five",
send one. Scout reacts to the GIF's title with matching energy.

**Fallback if the GIF tool doesn't fire:** Scout will still reply
casually with emojis. That still sells "not an AI." Move on.

---

## Beat 2 — Voice + screen vision — 1:00 → 1:50 (50 sec)

**Show:** Switch to a Terminal window that has a visible Python error
(prep this before recording — see PRE_FLIGHT.md).

**Do:** Click the menu-bar Scout orb (or ⌘⌥-Space Spotlight, if that's
enabled), or just click the **Talk** button in the composer. Say out
loud:

> "Hey Scout, look at my terminal and tell me what's wrong."

**Watch:** Scout activates Terminal → screencaptures → sends to
`llama-3.2-11b-vision` → speaks the diagnosis in Kokoro TTS.

**Say (over the response):**

> "Second — Scout can see. I asked it to look at my terminal. It
> switched focus, screencaptured, sent that frame to a vision model,
> and told me the actual error. That whole flow is one tool call:
> `see_app`. It bridges the split where vision models can't call
> tools and tool models can't see — I do the vision call inside the
> tool."

**Fallback if voice fails / mic issue:** type the same question in
chat. The `see_app` tool still runs. The visual is the same. Only
lose the "voice" beat.

---

## Beat 3 — Code Mode + git commit — 1:50 → 2:50 (60 sec)

**Show:** Click the **Code** button in Scout's topbar. The 3-pane
IDE opens — file tree · viewer · agent panel. The workspace is
already connected to a small prep project (see PRE_FLIGHT.md).

**Do:** In the agent panel, type:

> "add error handling to `save_stats` in `db.py` — an empty list
> shouldn't divide by zero. commit it."

Mode set to **AUTO**.

**Watch:** Activity chips fire — "Reading a file" → "Editing a file"
→ "Committing changes". File viewer updates. Terminal window on
the side (you'll open one before recording) shows the git log with
the new commit.

**Say (over the activity happening):**

> "Third — Scout can actually change code and commit it. Every write
> is permission-gated: read tools run free, but write, edit,
> run-command, git-commit all require confirmation. Auto mode
> pre-approves them for me. This ran through a real path sandbox
> that would have refused if the path escaped the workspace."

---

## Beat 4 — What's underneath — 2:50 → 4:00 (70 sec)

**Show:** Switch to the browser tab open at
`github.com/jahajeevan/Scout` — README.md rendered.

**Say (scrolling slowly):**

> "This is all in the repo. 30,000 lines. Python backend on FastAPI
> with a multi-agent orchestrator — a planner routes simple asks to
> one specialist, complex asks decompose into a dependency graph of
> steps that run in parallel and get synthesized back. Every side
> effect goes through one permission gate — SAFE, CONFIRM,
> BLOCKED. Native macOS shell is a real py2app bundle. Streaming
> voice replies sentence-by-sentence so Scout starts talking before
> it's done thinking."

**Show:** Scroll down to the "What broke, and how I got out" section.

> "Razorpay says they read the 'what broke' answer first — so let me
> tell you the debug story that taught me the most. I built the
> permission gate. It was correct. The tool was correct. The prompt
> was correct. But when the user said 'yes, send it,' the model
> re-called `send_email`, the gate refused again, and the loop
> repeated forever with no way for consent to reach the tool."

> "The fix wasn't a better prompt — it was pulling the model OUT of
> the retry loop. `run_stream` now takes an `on_confirm` callback
> that stops the loop and hands consent directly to the tool
> outside the model's control. That taught me the most important
> primitive in an agent product is how the user grants consent —
> and the interface for it is a first-class design decision, not a
> detail."

---

## Close — 4:00 → 5:00 (60 sec)

**Show:** Back to Scout home screen. Zoom out slightly to show the
whole desktop with Scout in it.

**Say:**

> "Scout is one system: voice + vision + code + memory + autonomy
> daemons + a permission gate. It runs entirely on my machine on
> NVIDIA's free model tier — Nemotron Ultra, gpt-oss, Llama Vision.
> Everything I showed you is in the repo, MIT-licensed. I built it
> because I wanted an AI that actually lives in my OS, and I want
> to spend the next six months making it something people want."

> "Thanks — pick me up in Bangalore. Let's build."

**Fade to:** Scout orb in the menu bar, or the repo URL on screen.

---

## Total budget

| Beat | Length | Cumulative |
|---|---:|---:|
| Opening | 0:20 | 0:20 |
| Personality + GIFs | 0:40 | 1:00 |
| Voice + vision | 0:50 | 1:50 |
| Code + commit | 1:00 | 2:50 |
| Architecture + war story | 1:10 | 4:00 |
| Close | 1:00 | 5:00 |

If you run long: **cut the architecture beat first** (still show it,
but skip reading the section — just say "there's a war story in the
README"). Don't cut the Code+commit beat or the closing pitch.

If you run short: **let the demos breathe.** Pauses are fine.

---

## Non-negotiables

- **Do not fabricate.** If a demo fails mid-recording, either (a)
  stop, fix, restart, or (b) keep going and acknowledge with a smile
  ("model's warming up, one sec"). Never edit-in fake output.
- **Speak to a human,** not the camera. The reviewer is another
  builder.
- **Under 5 minutes.** Razorpay's form says "5-min pitch video." Go
  over and they may not watch the end.
- **Unlisted YouTube upload.** Public → risk. Unlisted → shareable
  by link only.

---

## Right after recording

1. Watch the whole thing once at normal speed. Cringe. It's fine.
2. If any beat truly failed, re-record just that beat and cut.
3. Trim head/tail to remove "starting the recorder" moments.
4. Upload to YouTube as **unlisted**.
5. Paste the link into the form.

See PRE_FLIGHT.md for the pre-recording checklist.
