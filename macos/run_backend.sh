#!/bin/bash
# Backend + web workspace for Scout (LaunchAgent). Explicit venv python.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/apple/jarvis || exit 1
set -a; [ -f .env ] && source .env; set +a
( cd frontend && nohup npm run dev > /tmp/scout_frontend.log 2>&1 & )
exec /Users/apple/jarvis/.venv/bin/python3.11 -m backend.main
