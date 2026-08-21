// Next.js configuration.
//
// Ports must never be hardcoded (per JARVIS_SPEC.md §5) — they live only in
// config/jarvis.json. We read that single source of truth here and expose the
// backend / gesture WebSocket ports to the browser as public env vars.
const jarvisConfig = require("../config/jarvis.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BACKEND_PORT: String(jarvisConfig.backend_port),
    NEXT_PUBLIC_GESTURE_WS_PORT: String(jarvisConfig.gesture_ws_port),
    NEXT_PUBLIC_USER_NAME: String(jarvisConfig.user_name),
  },
};

module.exports = nextConfig;
