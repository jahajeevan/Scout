#!/bin/bash
# Stops everything start_scout.sh launched.
cd "$(dirname "$0")" || exit 1
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
lsof -ti tcp:8790 | xargs kill -9 2>/dev/null
pkill -f "macos/scout.py" 2>/dev/null
echo "Scout stopped (backend, web, wake app, chatterbox TTS)."
