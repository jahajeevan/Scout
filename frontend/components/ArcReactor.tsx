"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

// JARVIS core — a holographic blue presence for the LIGHT command-center.
// Canvas, no 3D library. Three layered elements read as one intelligence:
//   1. layered translucent rings (slow, elliptical, holographic)
//   2. a depth-shaded particle sphere (source-over so it reads on white:
//      front points deeper/opaque blue, back points light periwinkle)
//   3. a soft central core that breathes and swells with the voice pulse
// It stays calm when idle and subtly comes alive with amplitude/gesture.
//
// Gesture state still drives rotation/zoom/explode (Phase 3), and `pulseRef`
// carries live voice amplitude (0..1).

export interface ReactorState {
  rotX: number;
  rotY: number;
  zoom: number;
  explode: number;
  grabbing: boolean;
}

export const NEUTRAL_STATE: ReactorState = {
  rotX: 0,
  rotY: 0,
  zoom: 1,
  explode: 0,
  grabbing: false,
};

interface ArcReactorProps {
  state?: ReactorState;
  fill?: boolean;
  pulseRef?: MutableRefObject<number>;
}

const N = 3400;

function pseudo(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface Cloud {
  pos: Float32Array;
  rad: Float32Array;
}

function makeCloud(n: number): Cloud {
  const pos = new Float32Array(n * 3);
  const rad = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const dx = Math.cos(theta) * ring;
    const dz = Math.sin(theta) * ring;
    let radius: number;
    if (pseudo(i, 8) < 0.62) {
      radius = 0.92 + pseudo(i, 1) * 0.12; // outer shell
    } else {
      radius = 0.18 + Math.pow(pseudo(i, 9), 0.6) * 0.74; // interior cloud
    }
    pos[i * 3] = dx * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = dz * radius;
    rad[i] = radius;
  }
  return { pos, rad };
}

export default function ArcReactor({ state, fill = false, pulseRef }: ArcReactorProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<ReactorState>(state ?? NEUTRAL_STATE);
  const voiceRef = pulseRef;

  useEffect(() => {
    stateRef.current = state ?? NEUTRAL_STATE;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cloud = makeCloud(N);
    let raf = 0;
    let idleSpin = 0;
    let easedZoom = 1;
    let easedExplode = 0;
    let pulse = 0;
    let dispRotX = 0;
    let dispRotY = 0;
    let last = performance.now();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize(): void {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }
    resize();
    window.addEventListener("resize", resize);

    function ring(cx: number, cy: number, rx: number, ry: number, rot: number, alpha: number, lw: number): void {
      if (!ctx) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(45,123,230,${alpha})`;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
    }

    function frame(now: number): void {
      if (!canvas || !ctx) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const s = stateRef.current;
      if (!s.grabbing) idleSpin += dt * 0.16;

      const targetRotX = s.rotX + 0.4;
      const targetRotY = s.rotY + idleSpin;
      dispRotX += (targetRotX - dispRotX) * Math.min(1, dt * 10);
      dispRotY += (targetRotY - dispRotY) * Math.min(1, dt * 10);
      easedZoom += (s.zoom - easedZoom) * Math.min(1, dt * 5);
      easedExplode += (s.explode - easedExplode) * Math.min(1, dt * 5);
      const voiceTarget = voiceRef ? voiceRef.current : 0;
      pulse += (voiceTarget - pulse) * Math.min(1, dt * 12);

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.38 * easedZoom;
      const fov = 2.6;

      const cosY = Math.cos(dispRotY);
      const sinY = Math.sin(dispRotY);
      const cosX = Math.cos(dispRotX);
      const sinX = Math.sin(dispRotX);

      ctx.clearRect(0, 0, w, h);

      // Soft ambient halo — a barely-there cool glow behind the core.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      halo.addColorStop(0, `rgba(78,155,255,${0.1 + pulse * 0.05})`);
      halo.addColorStop(1, "rgba(78,155,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Layered translucent rings — the holographic structure. Slow, elliptical.
      const t = now / 1000;
      ring(cx, cy, R * 1.28, R * (0.42 + 0.06 * Math.sin(t * 0.3)), t * 0.16, 0.16, 1.2 * dpr);
      ring(cx, cy, R * 1.05, R * (0.9 + 0.04 * Math.cos(t * 0.4)), -t * 0.12 + 0.6, 0.13, 1.1 * dpr);
      ring(cx, cy, R * 1.42, R * 0.32, t * 0.22 + 1.2, 0.1, 1 * dpr);

      // Central core — luminous focus that breathes + swells with the voice.
      const coreR = R * 0.5 * (1 + pulse * 0.5);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      grad.addColorStop(0, `rgba(255,255,255,${0.9})`);
      grad.addColorStop(0.35, `rgba(120,175,255,${0.5 + pulse * 0.3})`);
      grad.addColorStop(1, "rgba(46,123,230,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Particle sphere (source-over — depth by value, not additive glow).
      const expand = Math.max(0.05, 1 + easedExplode * 1.4 + pulse * 0.12);
      const split = Math.max(0, easedExplode) * 0.5;
      const pos = cloud.pos;

      for (let i = 0; i < N; i++) {
        const x = pos[i * 3] * expand;
        const y = pos[i * 3 + 1] * expand;
        const z = pos[i * 3 + 2] * expand;

        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        let sx = cx + x1 * R;
        if (split > 0) sx += x1 >= 0 ? split * R : -split * R;

        const persp = fov / (fov + z2);
        const px = cx + (sx - cx) * persp;
        const py = cy + y1 * R * persp;

        const frontness = 1 - (z2 + 1) / 2; // 1 = nearest
        const alpha = 0.12 + frontness * 0.6;
        const size = (0.5 + frontness * 1.5) * dpr * (0.9 + easedZoom * 0.1);

        // Front points: deep saturated blue. Back points: light periwinkle.
        const sparkle = pseudo(i, 7) > 0.985;
        if (sparkle) {
          ctx.fillStyle = `rgba(255,255,255,${alpha + 0.2})`;
        } else if (frontness > 0.62) {
          ctx.fillStyle = `rgba(29,95,196,${alpha})`;
        } else if (frontness > 0.3) {
          ctx.fillStyle = `rgba(90,140,235,${alpha})`;
        } else {
          ctx.fillStyle = `rgba(150,175,235,${alpha})`;
        }
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }

      raf = window.requestAnimationFrame(frame);
    }

    raf = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const wrapperStyle = fill
    ? { width: "100%", height: "100%", position: "relative" as const }
    : { width: "min(100%, 320px)", aspectRatio: "1 / 1", position: "relative" as const };

  return (
    <div style={wrapperStyle}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
