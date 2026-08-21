"use client";

import { useEffect, useState } from "react";

// Cinematic power-on overlay. Plays once per browser session (sessionStorage),
// and is skipped entirely when the user prefers reduced motion. Each line is a
// real subsystem coming online, revealed in sequence, with a reactor spin-up
// ring and a charge bar — the HUD "boots" the way JARVIS would.
const LINES = [
  "INITIALIZING CORE SYSTEMS",
  "MOUNTING NEURAL INTERFACE",
  "LINKING LOCAL MODELS",
  "CALIBRATING ARC REACTOR",
  "ALL SYSTEMS NOMINAL",
];

export default function BootSequence({ onDone }: { onDone: () => void }): JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(true);
  const [done, setDone] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (sessionStorage.getItem("jarvis-booted") || reduce) {
      setVisible(false);
      onDone();
      return;
    }
    sessionStorage.setItem("jarvis-booted", "1");

    const timers: number[] = [];
    LINES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setStep(i + 1), 300 + i * 480));
    });
    let p = 0;
    const prog = window.setInterval(() => {
      p = Math.min(100, p + 4);
      setProgress(p);
      if (p >= 100) window.clearInterval(prog);
    }, 85);
    const total = 300 + LINES.length * 480 + 450;
    timers.push(window.setTimeout(() => setDone(true), total));
    timers.push(
      window.setTimeout(() => {
        setVisible(false);
        onDone();
      }, total + 900),
    );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(prog);
    };
    // Run exactly once on mount — onDone is intentionally not a dependency so a
    // parent re-render (e.g. the clock ticking) can't restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div className={`boot-overlay ${done ? "boot-done" : ""}`}>
      <div className="boot-ring" />
      <div
        style={{
          fontFamily: "var(--font-display), system-ui, sans-serif",
          letterSpacing: "0.42em",
          fontSize: 24,
          fontWeight: 700,
          color: "var(--gold-bright)",
          textShadow: "0 0 22px var(--gold-glow)",
          paddingLeft: "0.42em",
        }}
      >
        JARVIS
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          minHeight: 116,
          width: "min(360px, 62vw)",
        }}
      >
        {LINES.slice(0, step).map((line, i) => (
          <div
            key={line}
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.07em",
              color: i === step - 1 ? "var(--gold-bright)" : "var(--text-30)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{line}</span>
            <span style={{ color: "var(--green)" }}>OK</span>
          </div>
        ))}
      </div>
      <div className="boot-bar">
        <i style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
