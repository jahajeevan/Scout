// pm2 process manager config.
//
// Ports come only from config/jarvis.json (spec §5 — never hardcoded here).
// The two Python services use SEPARATE virtualenvs on purpose: the gesture stack
// (mediapipe) needs numpy<2, while the voice stack (kokoro) needs numpy>=2, so
// they cannot share one environment. Create them with:
//   python3.11 -m venv .venv         && .venv/bin/pip install -r requirements.txt
//   python3.11 -m venv .venv-gesture && .venv-gesture/bin/pip install \
//       numpy==1.26.4 mediapipe==0.10.14 opencv-python==4.10.0.84 websockets==12.0
const cfg = require("./config/jarvis.json");

module.exports = {
  apps: [
    {
      name: "jarvis-backend",
      script: "./.venv/bin/python",
      args: `-m uvicorn backend.main:app --host 0.0.0.0 --port ${cfg.backend_port} --reload`,
    },
    {
      name: "jarvis-gestures",
      script: "./.venv-gesture/bin/python",
      args: "-m backend.gesture.tracker",
    },
    {
      name: "jarvis-frontend",
      cwd: "./frontend",
      script: "npm",
      args: "run dev",
    },
  ],
};
