"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { colors } from "@/lib/tokens";
import type { VoiceStatus } from "@/hooks/useVoice";

// Voice visualizer (spec §4): animated SVG sine wave (NOT bars). Updates every
// 40ms, composite of 2 harmonics under a Gaussian envelope, LinearGradient that
// fades at the edges. It is now driven by the shared voice state (useVoice):
// tall + bright gold while listening/speaking (amplitude from `levelRef`), small
// + dim when idle. Tapping toggles listening.

const W = 190;
const H = 54;
const SAMPLES = 64;
const MID = H / 2;

function buildPath(phase: number, amplitude: number): string {
  const sigma = W / 3.2;
  let d = "";
  for (let i = 0; i <= SAMPLES; i++) {
    const x = (i / SAMPLES) * W;
    const env = Math.exp(-((x - W / 2) ** 2) / (2 * sigma * sigma));
    const h1 = Math.sin((x / W) * Math.PI * 4 + phase);
    const h2 = Math.sin((x / W) * Math.PI * 9 + phase * 1.7);
    const y = MID - env * amplitude * (h1 * 0.62 + h2 * 0.38);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return d.trim();
}

interface VoiceWaveProps {
  levelRef: MutableRefObject<number>;
  status: VoiceStatus;
  onToggle: () => void;
}

const LABELS: Record<VoiceStatus, string> = {
  idle: "TAP TO SPEAK",
  listening: "● LISTENING",
  thinking: "THINKING…",
  speaking: "◈ JARVIS SPEAKING",
};

export default function VoiceWave({ levelRef, status, onToggle }: VoiceWaveProps): JSX.Element {
  const [path, setPath] = useState<string>(() => buildPath(0, 3));
  const phaseRef = useRef<number>(0);
  const smoothRef = useRef<number>(0);
  const statusRef = useRef<VoiceStatus>(status);
  statusRef.current = status;

  useEffect(() => {
    const id = window.setInterval(() => {
      phaseRef.current += 0.35;
      const active = statusRef.current === "listening" || statusRef.current === "speaking";
      const target = active ? levelRef.current : 0;
      smoothRef.current += (target - smoothRef.current) * 0.3;

      const base = active ? 5 : 3;
      const gain = active ? 20 : 0;
      const idleShimmer = active ? 0 : Math.sin(phaseRef.current * 0.5) * 1.2;
      const amplitude = base + smoothRef.current * gain + idleShimmer;
      setPath(buildPath(phaseRef.current, amplitude));
    }, 40);
    return () => window.clearInterval(id);
  }, [levelRef]);

  const active = status === "listening" || status === "speaking";
  const strokeColor = active ? colors.goldBright : colors.goldPrimary;

  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onToggle();
      }}
      style={{ cursor: "pointer", userSelect: "none" }}
      title={status === "idle" ? "Tap to speak" : LABELS[status]}
    >
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="waveFade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0" />
            <stop offset="25%" stopColor={strokeColor} stopOpacity="1" />
            <stop offset="75%" stopColor={strokeColor} stopOpacity="1" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={path}
          fill="none"
          stroke="url(#waveFade)"
          strokeWidth={active ? 2.2 : 1.5}
          strokeLinecap="round"
          style={{
            filter: active ? `drop-shadow(0 0 4px ${colors.goldGlow})` : "none",
            opacity: active ? 1 : 0.55,
            transition: "opacity 0.4s ease",
          }}
        />
      </svg>
      <div
        className="mono"
        style={{
          fontSize: 8,
          letterSpacing: "0.14em",
          color: active ? colors.goldBright : status === "thinking" ? colors.blueAccent : colors.text30,
          textAlign: "center",
          marginTop: 2,
        }}
      >
        {LABELS[status]}
      </div>
    </div>
  );
}
