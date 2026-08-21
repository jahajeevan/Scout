"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Scout Orb — Nightfall edition.
 *
 * A calm obsidian sphere with a slow champagne aurora drifting inside and a
 * whisper of sage-teal that pulses when Scout is thinking or listening. This
 * is the identity object: restrained, alive, unmistakable.
 *
 * Design principles vs. the old Siri-rainbow version:
 *   • Two hues only (champagne + sage-teal), sitting in Scout's palette.
 *   • Breathing halo (outer bloom) instead of neon glow.
 *   • Thinking pulse is a widening ring — a heartbeat, not a strobe.
 *   • Specular top-left sheen so the sphere reads as a real object, not a dot.
 *
 * Reacts to ``status`` (idle | listening | thinking | speaking) and to live
 * mic amplitude via ``levelRef`` (0..1). Honours prefers-reduced-motion.
 */

export type OrbStatus = "idle" | "listening" | "thinking" | "speaking";

interface OrbProps {
  status?: OrbStatus;
  size?: number;
  levelRef?: MutableRefObject<number>;
  className?: string;
}

const CHAMPAGNE: [number, number, number] = [201, 168, 106];   // --brass
const SAGE:      [number, number, number] = [127, 176, 165];   // --teal
const IVORY:     [number, number, number] = [242, 236, 224];   // --ink

const DRIFT_SPEED: Record<OrbStatus, number> = {
  idle: 0.22,
  listening: 0.55,
  thinking: 0.75,
  speaking: 0.90,
};

const BREATH_SPEED: Record<OrbStatus, number> = {
  idle: 1.1,
  listening: 1.8,
  thinking: 2.4,
  speaking: 2.0,
};

export default function Orb({ status = "idle", size = 40, levelRef, className }: OrbProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<OrbStatus>(status);
  statusRef.current = status;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let breath = 0;
    let heartbeat = 0;      // one-shot heartbeat when status flips to thinking/listening
    let lastStatus: OrbStatus = statusRef.current;

    const rgba = ([r, g, b]: [number, number, number], a: number): string =>
      `rgba(${r},${g},${b},${a})`;

    const draw = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = statusRef.current;
      const level = levelRef ? Math.max(0, Math.min(1, levelRef.current)) : 0;

      // Trigger a heartbeat wave whenever status becomes alive.
      if (st !== lastStatus) {
        if (st === "thinking" || st === "listening" || st === "speaking") heartbeat = 1;
        lastStatus = st;
      }
      heartbeat = Math.max(0, heartbeat - dt * 0.9);

      t += dt * (reduce ? 0 : DRIFT_SPEED[st]);
      breath += dt * (reduce ? 0 : BREATH_SPEED[st]);

      const breathAmp = 0.5 + 0.5 * Math.sin(breath);
      const swell = 1 + (level * 0.14) + breathAmp * 0.025;
      const rad = R * 0.80 * swell;

      ctx.clearRect(0, 0, size, size);

      // ── Outer bloom — a warm ivory halo, very subtle. This IS the breathing.
      const bloomA = 0.18 + breathAmp * 0.08 + level * 0.10;
      const bloom = ctx.createRadialGradient(cx, cy, rad * 0.6, cx, cy, R);
      bloom.addColorStop(0, rgba(CHAMPAGNE, bloomA));
      bloom.addColorStop(1, rgba(CHAMPAGNE, 0));
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // ── Heartbeat ring — expands outward on state change, then fades.
      if (heartbeat > 0.02) {
        const hbR = rad + (R - rad) * (1 - heartbeat);
        ctx.beginPath();
        ctx.arc(cx, cy, hbR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(SAGE, heartbeat * 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── The sphere itself. Clip so aurora blobs stay inside.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.clip();

      // Deep obsidian interior — warm graphite, not blue-black.
      const base = ctx.createRadialGradient(cx, cy - rad * 0.35, rad * 0.15, cx, cy, rad);
      base.addColorStop(0, "#1c1a17");
      base.addColorStop(1, "#08090c");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      // Champagne aurora — one slow-drifting blob, additive.
      ctx.globalCompositeOperation = "lighter";
      {
        const ang = t * 1.0;
        const orbit = rad * 0.32;
        const bx = cx + Math.cos(ang) * orbit;
        const by = cy + Math.sin(ang * 1.15) * orbit;
        const br = rad * 0.85;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(CHAMPAGNE, 0.55 + level * 0.15));
        g.addColorStop(0.6, rgba(CHAMPAGNE, 0.10));
        g.addColorStop(1, rgba(CHAMPAGNE, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      // Sage-teal counterpoint — only when Scout is alive; drifts opposite way.
      if (st !== "idle") {
        const ang = -t * 0.9 + 2.4;
        const orbit = rad * 0.36;
        const bx = cx + Math.cos(ang) * orbit;
        const by = cy + Math.sin(ang * 0.85) * orbit;
        const br = rad * 0.7;
        const intensity = st === "thinking" ? 0.5 : st === "listening" ? 0.42 : 0.35;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(SAGE, intensity + level * 0.2));
        g.addColorStop(0.7, rgba(SAGE, 0.08));
        g.addColorStop(1, rgba(SAGE, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Specular sheen — top-left glossy highlight so the orb reads as material.
      const spec = ctx.createRadialGradient(
        cx - rad * 0.35, cy - rad * 0.42, 0,
        cx - rad * 0.35, cy - rad * 0.42, rad * 0.95,
      );
      spec.addColorStop(0, rgba(IVORY, 0.35));
      spec.addColorStop(0.35, rgba(IVORY, 0.06));
      spec.addColorStop(1, rgba(IVORY, 0));
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, size, size);

      ctx.restore();

      // Crisp rim — a single ivory hairline so the sphere edge is defined.
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(IVORY, 0.14);
      ctx.lineWidth = 1;
      ctx.stroke();

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, levelRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: "block", borderRadius: "50%" }}
      aria-hidden="true"
    />
  );
}
