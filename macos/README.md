# SCOUT — native macOS app

SCOUT lives on your Mac, not in the browser. This menu-bar service talks to the
same backend as the web UI (shared memory, models, voice, tools), so SCOUT is
available while you're in VS Code, Finder, anything — no browser required.

## What it does
- **Menu-bar item** (`◆`) with live backend status.
- **Talk to Scout** — a native voice turn (mic → backend → speaker), independent
  of any browser. Uses your selected voice + models + memory.
- **Wake word** — hands-free trigger, **on by default**: say the wake phrase and
  Scout brings the web app to the front *and* starts listening (see note below).
- **Overlay** — a small always-on-top panel showing *Listening / Thinking /
  Speaking* above your active app.
- **Stop** — emergency stop; halts recording + playback immediately.
- **Open Scout** — opens the web command center (localhost:3000).

## Run it (dev)
```bash
cd /Users/apple/jarvis
source .venv/bin/activate
set -a && source .env && set +a
python3.11 macos/scout.py
```
The backend must also be running (`python3.11 -m backend.main`).

## Auto-start at login (backend + menu-bar)
```bash
bash macos/install.sh
```
This installs two LaunchAgents (`com.scout.backend`, `com.scout.menubar`) that
start at login and stay alive. Logs: `/tmp/scout_backend.log`,
`/tmp/scout_menubar.log`.

Uninstall:
```bash
launchctl unload ~/Library/LaunchAgents/com.scout.*.plist
rm ~/Library/LaunchAgents/com.scout.*.plist
```

## macOS permissions
Use the menu-bar **Permissions** submenu — it shows live ✓ / ⚠ status for
Microphone, Screen Recording, and Accessibility, and each item opens the exact
System Settings pane so you can grant it (Scout never bypasses macOS security).
- **Microphone** — required for Talk and the wake word.
- **Screen Recording** — required for "look at my screen / VS Code / terminal".
- **Accessibility** — for the global hotkeys and future typing/control tools.
- **Automation / Notifications** — used for app control and reminders (macOS
  doesn't expose a readable status, so these open the pane directly).

## Native Scout.app (Phase 4)

### Recommended — `build_app.sh` (reliable)
```bash
bash macos/build_app.sh      # -> ./Scout.app
open ./Scout.app             # or drag it to /Applications or the Dock
```
This builds a lightweight **Scout.app** menu-bar helper (LSUIElement, Scout icon,
`com.scout.app` identity) that wraps the existing venv. On launch it **auto-starts
the backend + web if they aren't running**, then runs the Halo/wake app — so
double-clicking Scout.app brings up everything.

- First launch prompts for **Microphone / Screen Recording**, now attributed to
  **"Scout"** (not "Python"). Grant them (or use the menu-bar Permissions submenu).
- **Auto-start at login:** System Settings → General → Login Items → **+** →
  choose `Scout.app`.
- Locally built, so Gatekeeper won't quarantine it. Rebuild after code changes
  with `bash macos/build_app.sh`.

### Alternative — `setup_app.py` (fully self-contained, finicky)
`macos/setup_app.py` is a py2app scaffold that bundles a standalone app (no external
venv). Audio/ML wheels can need tweaking under py2app; prefer `build_app.sh` unless
you're distributing to another machine.

## Wake word
The listener is **on by default**. On wake, Scout opens/focuses the web app and
starts a hands-free voice turn. Scout auto-selects a wake engine:

### "Hey Scout" — Vosk, fully local (default, no account)
This is the default and needs no key or signup — just an offline model folder,
which is already downloaded to `macos/assets/vosk-model`. Scout uses Vosk as a
keyword spotter locked to the phrase, so ordinary speech won't trigger it. Say
**"Hey Scout"**. You'll see `[scout] wake engine: Vosk …` at startup.

If the model folder is ever missing, re-download the small English model:
```bash
cd macos/assets
curl -L -o vosk.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip -q vosk.zip && mv vosk-model-small-en-us-0.15 vosk-model && rm vosk.zip
```
(Override the location with `SCOUT_VOSK_MODEL=/abs/path`.)

> Note: Picovoice Porcupine would give slightly crisper detection, but its
> Console now requires a **company email** and blocks personal Gmail, so Vosk is
> the practical local route. The Porcupine path is still wired in — set
> `PICOVOICE_ACCESS_KEY` + a `Hey Scout` `.ppn` (`SCOUT_PPN`, or drop it at
> `macos/assets/hey_scout.ppn`) if you ever get access.

### Fallbacks
- **"Hey Jarvis"** — openWakeWord's pretrained model, used automatically if the
  Vosk model isn't present. Force it with `SCOUT_WAKE_ENGINE=openwakeword`.
- Force a specific engine any time with `SCOUT_WAKE_ENGINE=vosk|porcupine|openwakeword`.

## Requirements
Installed into the project venv: `rumps` (which pulls in `pyobjc`),
`openwakeword`, `sounddevice` (already present). If starting fresh:
```bash
pip install rumps openwakeword sounddevice
```

## Not verifiable headless
This is a native GUI app — it must run in a real Mac login session (it can't be
launched from a headless/CI shell). The code is syntax- and import-verified;
run it on your Mac and I'll help debug anything that surfaces.
