#!/bin/bash
# Starts EVERYTHING Scout needs, detached, in one shot:
#   • backend  (:8000)
#   • web app  (:3000)
#   • native menu-bar wake app ("Hey Scout" + orb)
#
# Run once from Terminal:  ./start_scout.sh
# Everything keeps running even after you close the terminal (nohup).
#
# Stop everything:         ./stop_scout.sh

cd "$(dirname "$0")" || exit 1

# Free the ports if a previous run is still bound.
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
lsof -ti tcp:8790 | xargs kill -9 2>/dev/null
pkill -f "macos/scout.py" 2>/dev/null
osascript -e 'tell application "Scout" to quit' 2>/dev/null

source .venv/bin/activate
[ -f .env ] && { set -a; source .env; set +a; }

echo "Starting Scout…"

# Local Chatterbox TTS (custom cloned voice). Runs in its own venv to keep
# PyTorch out of Scout's backend env. Optional: if ~/chatterbox isn't set up,
# Scout still starts and uses Kokoro voices as before.
CB_DIR="$HOME/chatterbox"
if [ -x "$CB_DIR/.venv/bin/python" ] && [ -f "$CB_DIR/scout_tts_server.py" ]; then
  echo "  starting Chatterbox TTS (127.0.0.1:8790)…"
  nohup "$CB_DIR/.venv/bin/python" "$CB_DIR/scout_tts_server.py" > /tmp/scout_tts.log 2>&1 &
fi

# Backend + web app still run under the venv Python — they're headless HTTP
# services that never touch macOS TCC, so their identity doesn't matter.
nohup python3.11 -m backend.main > /tmp/scout_backend.log 2>&1 &
( cd frontend && nohup npm run dev > /tmp/scout_frontend.log 2>&1 & )

# Wait until the web app answers (up to ~40s) so the wake app opens something real.
printf "  web "
for _ in $(seq 1 40); do
  if curl -s -o /dev/null -m1 http://localhost:3000; then echo "ready"; break; fi
  printf "."; sleep 1
done

# The native menu-bar app (wake word, overlay, orb) launches from the BUNDLED
# Scout.app so macOS TCC treats it as ONE consistent identity forever
# (com.scout.app / dist/Scout.app/Contents/MacOS/Scout) — no re-prompt on
# venv rebuild, homebrew python update, or interpreter path change.
#
# scout.py inside the bundle is a symlink to macos/scout.py, so edits to the
# source apply immediately — no need to rebuild the bundle.
BUNDLE="/Applications/Scout.app"
if [ -d "$BUNDLE" ]; then
  open -a "$BUNDLE"
else
  echo "  ⚠ Scout.app missing at $BUNDLE — falling back to raw python"
  echo "    (rebuild with:  cd macos && python setup_app.py py2app  then copy to /Applications)"
  nohup python3.11 -u macos/scout.py > /tmp/scout_menubar.log 2>&1 &
fi

echo ""
echo "  Scout is up:"
echo "    • Web:     http://localhost:3000"
echo "    • Backend: http://localhost:8000/health"
echo "    • Say 'Hey Scout' → the orb pops up and listens."
echo "  Logs: /tmp/scout_backend.log  /tmp/scout_frontend.log  /tmp/scout_menubar.log"
echo "  Stop: ./stop_scout.sh"
