#!/bin/bash
# Starts SCOUT — backend (:8000) + frontend (:3000) together.
# Usage:  ./run.sh      then open http://localhost:3000
# Stop:   Ctrl-C        (stops both)

cd "$(dirname "$0")" || exit 1

# Free the ports if something is already bound (a previous run).
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null

source .venv/bin/activate

# Backend (auto-loads .env via backend/config.py).
python3.11 -m backend.main &
BACK=$!

# Frontend (Next.js dev server).
( cd frontend && npm run dev ) &
FRONT=$!

trap 'echo; echo "Stopping SCOUT…"; kill $BACK $FRONT 2>/dev/null; exit 0' INT TERM EXIT

echo ""
echo "  SCOUT is starting…"
echo "  → Web:     http://localhost:3000"
echo "  → Backend: http://localhost:8000/health"
echo "  (Ctrl-C to stop both)"
echo ""

wait
