"use client";

// ═══════════════════════════════════════════════════════════════════════════
// ARC FORGE — real-time AR gauntlet + repulsor VFX (showcase build).
// Webcam → MediaPipe hand tracking → a materializing holographic gauntlet that
// fits your hand, a palm arc-reactor, gesture-driven weapons (repulsor beam /
// overload shield / missiles / two-hand unibeam), a particle engine, targeting
// HUD, and cinematic post-FX. 100% local. See IRONMAN_AR_ROADMAP.md.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { colors, fonts } from "@/lib/tokens";
import * as sound from "@/lib/sound";

const GOLD = "#F0A830";
const GOLD_HOT = "#FFD060";
const BLUE = "#5BA8F0";
const WHITE_HOT = "#EAF4FF";

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const MCPS = [5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

type Pt = { x: number; y: number; z: number };
type V = { x: number; y: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: string };
type Ring = { x: number; y: number; r: number; vr: number; a: number; c: string; w: number };
type Proj = { x: number; y: number; vx: number; vy: number; life: number };

const d2 = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function fingersUp(lm: Pt[]): boolean[] {
  const w = lm[0];
  const up = (tip: number, pip: number, f = 1.12) => d2(lm[tip], w) > d2(lm[pip], w) * f;
  return [
    d2(lm[4], w) > d2(lm[2], w) * 1.05, // thumb (rough)
    up(8, 6),
    up(12, 10),
    up(16, 14),
    up(20, 18),
  ];
}

type Weapon = "REPULSOR" | "OVERLOAD" | "MISSILE" | "STANDBY";
function classify(lm: Pt[]): Weapon {
  const [thumb, i, m, r, p] = fingersUp(lm);
  const ext = [i, m, r, p].filter(Boolean).length;
  if (ext >= 4) return "REPULSOR";
  if (ext === 0) return "OVERLOAD";
  if (i && !m && !r && !p) return "MISSILE";
  return "STANDBY";
}

export default function ForgePage(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lmkRef = useRef<any>(null);
  const rafRef = useRef<number>(0);

  // FX state
  const parts = useRef<Particle[]>([]);
  const rings = useRef<Ring[]>([]);
  const projs = useRef<Proj[]>([]);
  const chargeRef = useRef<number>(0);
  const flashRef = useRef<number>(0);
  const shakeRef = useRef<number>(0);
  const asmRef = useRef<number>(0); // gauntlet assembly 0..1
  const asmDoneRef = useRef<boolean>(false);
  const wasFireRef = useRef<boolean>(false);
  const missileCdRef = useRef<number>(0);
  const weaponRef = useRef<Weapon>("STANDBY");

  const [started, setStarted] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Stand by.");
  const [weapon, setWeapon] = useState<Weapon>("STANDBY");
  const [error, setError] = useState<string>("");
  const [aspect, setAspect] = useState<number>(4 / 3);

  async function initialize(): Promise<void> {
    setError("");
    setStatus("Booting optics…");
    sound.unlock();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setAspect((video.videoWidth || 4) / (video.videoHeight || 3));
      setStatus("Loading neural tracker…");
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const make = (delegate: "GPU" | "CPU") =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate },
          runningMode: "VIDEO",
          numHands: 2,
        });
      lmkRef.current = await make("GPU").catch(() => make("CPU"));
      setStarted(true);
      sound.sfx("chime");
      setStatus("Raise your hand to forge the gauntlet, sir.");
      loop();
    } catch (e) {
      setError(`Optics failed: ${(e as Error).message}. Allow camera access and retry.`);
      setStatus("Offline.");
    }
  }

  const lastStatus = useRef<string>("");
  const say = (s: string) => {
    if (lastStatus.current !== s) {
      lastStatus.current = s;
      setStatus(s);
    }
  };
  const lastWeapon = useRef<Weapon>("STANDBY");
  const setWeap = (wp: Weapon) => {
    if (lastWeapon.current !== wp) {
      lastWeapon.current = wp;
      setWeapon(wp);
    }
  };

  function emit(list: Particle[], x: number, y: number, n: number, speed: number, c: string, size = 2, spread = Math.PI * 2, dir = 0) {
    for (let k = 0; k < n; k++) {
      const ang = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.9);
      list.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, max: 0.5 + Math.random() * 0.7, size: size * (0.6 + Math.random()), c });
    }
  }

  function glowLine(ctx: CanvasRenderingContext2D, a: V, b: V, w: number, c: string, blur: number) {
    ctx.save();
    ctx.shadowBlur = blur;
    ctx.shadowColor = c;
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function plate(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, a: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = a;
    ctx.shadowBlur = 12;
    ctx.shadowColor = GOLD;
    const g = ctx.createLinearGradient(0, -size, 0, size);
    g.addColorStop(0, GOLD_HOT);
    g.addColorStop(0.5, GOLD);
    g.addColorStop(1, "rgba(120,80,20,0.9)");
    ctx.fillStyle = g;
    const w = size * 1.5;
    const r = size * 0.45;
    ctx.beginPath();
    ctx.moveTo(-w + r, -size);
    ctx.arcTo(w, -size, w, 0, r);
    ctx.arcTo(w, size, 0, size, r);
    ctx.arcTo(-w, size, -w, 0, r);
    ctx.arcTo(-w, -size, 0, -size, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,233,176,0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function reactor(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, t: number, charge: number, hot: boolean) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    // glow
    const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (2 + charge * 1.5));
    const core = hot ? WHITE_HOT : GOLD_HOT;
    gg.addColorStop(0, hot ? "rgba(220,240,255,0.95)" : "rgba(255,220,140,0.9)");
    gg.addColorStop(0.35, hot ? "rgba(120,190,255,0.5)" : "rgba(240,168,48,0.45)");
    gg.addColorStop(1, "rgba(240,168,48,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(0, 0, R * (2 + charge * 1.5), 0, Math.PI * 2);
    ctx.fill();
    // rotating ring segments
    ctx.strokeStyle = core;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 14;
    ctx.shadowColor = core;
    for (let s = 0; s < 8; s++) {
      const a0 = t * 1.4 + (s * Math.PI) / 4;
      ctx.beginPath();
      ctx.arc(0, 0, R, a0, a0 + 0.5);
      ctx.stroke();
    }
    // inner core
    ctx.beginPath();
    ctx.fillStyle = core;
    ctx.arc(0, 0, R * (0.4 + charge * 0.25), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function loop(): void {
    const video = videoRef.current, canvas = canvasRef.current, wrap = wrapRef.current, lmk = lmkRef.current;
    if (!video || !canvas || !wrap || !lmk) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const t = performance.now() / 1000;

    // camera shake
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (shakeRef.current > 0.2) {
      ctx.translate((Math.random() - 0.5) * shakeRef.current, (Math.random() - 0.5) * shakeRef.current);
      shakeRef.current *= 0.85;
    }

    let hands: Pt[][] = [];
    if (video.readyState >= 2) {
      try {
        hands = (lmk.detectForVideo(video, performance.now()).landmarks || []) as Pt[][];
      } catch { /* transient */ }
    }
    const map = (p: Pt): V => ({ x: (1 - p.x) * W, y: p.y * H });

    // assembly progress
    const target = hands.length > 0 ? 1 : 0;
    asmRef.current += (target - asmRef.current) * 0.08;
    const asm = asmRef.current;

    let primaryWeapon: Weapon = "STANDBY";
    const openPalms: V[] = [];

    for (let hi = 0; hi < hands.length; hi++) {
      const lm = hands[hi];
      const P = lm.map(map);
      const wrist = P[0];
      const palm = MCPS.concat(0).reduce((a, i) => ({ x: a.x + P[i].x, y: a.y + P[i].y }), { x: 0, y: 0 });
      palm.x /= 5; palm.y /= 5;
      const scale = d2(P[0], P[9]);
      const forearm = { x: wrist.x - palm.x, y: wrist.y - palm.y }; // points down-arm
      const faLen = Math.hypot(forearm.x, forearm.y) || 1;
      const faDir = { x: forearm.x / faLen, y: forearm.y / faLen };
      const wp = classify(lm);
      if (hi === 0) primaryWeapon = wp;

      // ---- holographic skeleton (energy conduits) ----
      for (const [a, b] of CONNECTIONS) glowLine(ctx, P[a], P[b], 2.2, "rgba(255,208,96,0.85)", 10);
      for (let i = 0; i < P.length; i++) {
        ctx.save();
        ctx.fillStyle = TIPS.includes(i) ? WHITE_HOT : "rgba(240,168,48,0.9)";
        ctx.shadowBlur = 8; ctx.shadowColor = GOLD;
        ctx.beginPath(); ctx.arc(P[i].x, P[i].y, TIPS.includes(i) ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // ---- gauntlet plates (materialize with assembly) ----
      const spread = (1 - asm) * scale * 2.4;
      // wrist cuff
      const cuffAng = Math.atan2(faDir.y, faDir.x) + Math.PI / 2;
      plate(ctx, palm.x + faDir.x * scale * 0.7 + (Math.random() - 0.5) * spread, palm.y + faDir.y * scale * 0.7 + (Math.random() - 0.5) * spread, scale * 0.55, cuffAng, asm);
      plate(ctx, wrist.x + faDir.x * scale * 0.9, wrist.y + faDir.y * scale * 0.9, scale * 0.5, cuffAng, asm * 0.9);
      // knuckle plates
      for (const k of MCPS) {
        const dir = Math.atan2(P[k].y - wrist.y, P[k].x - wrist.x);
        plate(ctx, P[k].x + (Math.random() - 0.5) * spread * 0.4, P[k].y + (Math.random() - 0.5) * spread * 0.4, scale * 0.28, dir + Math.PI / 2, asm);
      }

      // ---- palm arc reactor ----
      const hot = wp === "REPULSOR" || wp === "OVERLOAD";
      const chg = hi === 0 ? chargeRef.current : 0;
      reactor(ctx, palm.x, palm.y, scale * 0.42, t, chg, hot && chg > 0.5);

      // ambient energy motes orbiting palm
      if (asm > 0.5 && Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        emit(parts.current, palm.x + Math.cos(a) * scale, palm.y + Math.sin(a) * scale, 1, scale * 1.2, hot ? BLUE : GOLD, 2);
      }

      // ---- weapons (primary hand drives charge) ----
      const aim = { x: -faDir.x, y: -faDir.y }; // fire away from forearm (where hand points)
      const aimAng = Math.atan2(aim.y, aim.x);

      if (hi === 0 && wp === "REPULSOR") {
        openPalms.push(palm);
        chargeRef.current = Math.min(1, chargeRef.current + 0.05);
        const c = chargeRef.current;
        sound.setHum(true);
        if (c > 0.35) {
          // repulsor beam
          const len = W * 1.2 * c;
          const bx = palm.x + aim.x * len, by = palm.y + aim.y * len;
          const bw = scale * (0.5 + c) * 0.6;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const bg = ctx.createLinearGradient(palm.x, palm.y, bx, by);
          bg.addColorStop(0, "rgba(230,244,255,0.95)");
          bg.addColorStop(0.15, "rgba(150,205,255,0.7)");
          bg.addColorStop(1, "rgba(91,168,240,0)");
          ctx.strokeStyle = bg; ctx.lineCap = "round"; ctx.lineWidth = bw;
          ctx.shadowBlur = 30; ctx.shadowColor = BLUE;
          ctx.beginPath(); ctx.moveTo(palm.x, palm.y); ctx.lineTo(bx, by); ctx.stroke();
          ctx.lineWidth = bw * 0.4; ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.beginPath(); ctx.moveTo(palm.x, palm.y); ctx.lineTo(bx, by); ctx.stroke();
          ctx.restore();
          emit(parts.current, palm.x, palm.y, 2, scale * 6, WHITE_HOT, 2.5, 0.5, aimAng);
          if (!wasFireRef.current) {
            sound.sfx("boom"); flashRef.current = 1; shakeRef.current = 10;
            rings.current.push({ x: palm.x, y: palm.y, r: scale, vr: 9, a: 1, c: BLUE, w: 3 });
            wasFireRef.current = true;
          }
        }
        say("◉ REPULSOR ONLINE"); setWeap("REPULSOR");
      } else if (hi === 0 && wp === "OVERLOAD") {
        chargeRef.current = Math.min(1, chargeRef.current + 0.02);
        sound.setHum(true);
        // gathering energy sphere
        const c = chargeRef.current;
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        for (let s = 0; s < 10; s++) {
          const a = t * 3 + s;
          const rr = scale * (1.6 - c) * (0.6 + 0.4 * Math.sin(t * 4 + s));
          ctx.fillStyle = `rgba(255,220,140,${0.15 + c * 0.2})`;
          ctx.beginPath(); ctx.arc(palm.x + Math.cos(a) * rr, palm.y + Math.sin(a) * rr, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        say(`OVERLOAD CHARGING · ${Math.round(c * 100)}%`); setWeap("OVERLOAD");
        wasFireRef.current = false;
      } else if (hi === 0 && wp === "MISSILE") {
        sound.setHum(false);
        // targeting reticle ahead of the finger
        const tip = P[8];
        const rx = tip.x + aim.x * scale * 3, ry = tip.y + aim.y * scale * 3;
        ctx.save(); ctx.strokeStyle = colors.red; ctx.lineWidth = 2; ctx.shadowBlur = 12; ctx.shadowColor = colors.red;
        ctx.beginPath(); ctx.arc(rx, ry, scale * 0.8 + Math.sin(t * 8) * 4, 0, Math.PI * 2); ctx.stroke();
        for (let s = 0; s < 4; s++) {
          const a = (s * Math.PI) / 2 + t;
          ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * scale * 0.5, ry + Math.sin(a) * scale * 0.5);
          ctx.lineTo(rx + Math.cos(a) * scale, ry + Math.sin(a) * scale); ctx.stroke();
        }
        ctx.restore();
        if (t - missileCdRef.current > 0.28) {
          missileCdRef.current = t;
          projs.current.push({ x: tip.x, y: tip.y, vx: aim.x * 26, vy: aim.y * 26, life: 1 });
          sound.sfx("hyper"); emit(parts.current, tip.x, tip.y, 6, scale * 4, GOLD_HOT, 2, 1, aimAng);
        }
        say("▸ MISSILES · LOCKED"); setWeap("MISSILE");
        chargeRef.current *= 0.9; wasFireRef.current = false;
      } else {
        if (hi === 0) { chargeRef.current *= 0.9; sound.setHum(false); wasFireRef.current = false; say("Gauntlet online. Open palm = repulsor."); setWeap("STANDBY"); }
      }

      // ---- HUD: bounding brackets + label pinned to hand ----
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (const p of P) { minx = Math.min(minx, p.x); miny = Math.min(miny, p.y); maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y); }
      const pad = scale * 0.6;
      drawBrackets(ctx, minx - pad, miny - pad, maxx + pad, maxy + pad, asm);
      ctx.save();
      ctx.font = `600 11px ${fonts.display.replace("var(--font-display)", "Space Grotesk")}, monospace`;
      ctx.fillStyle = hot ? BLUE : GOLD_HOT;
      ctx.globalAlpha = asm;
      ctx.fillText(`◈ ${wp}`, minx - pad, miny - pad - 8);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(`PWR ${Math.round((0.4 + chargeRef.current * 0.6) * 100)}%  MARK I`, minx - pad, maxy + pad + 16);
      ctx.restore();
    }

    if (hands.length === 0) { chargeRef.current *= 0.9; sound.setHum(false); wasFireRef.current = false; asmDoneRef.current = false; say("Raise your hand to forge the gauntlet, sir."); setWeap("STANDBY"); }
    if (asm > 0.85 && !asmDoneRef.current && hands.length) {
      asmDoneRef.current = true; sound.sfx("rev");
      const p = hands[0].map(map)[9]; emit(parts.current, p.x, p.y, 24, W * 0.02, GOLD_HOT, 3);
    }

    // ---- two-hand UNIBEAM ----
    if (openPalms.length >= 2) {
      const a = openPalms[0], b = openPalms[1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const ug = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, W * 0.5);
      ug.addColorStop(0, "rgba(230,244,255,0.9)"); ug.addColorStop(0.3, "rgba(150,205,255,0.4)"); ug.addColorStop(1, "rgba(91,168,240,0)");
      ctx.fillStyle = ug; ctx.beginPath(); ctx.arc(mid.x, mid.y, W * 0.5, 0, Math.PI * 2); ctx.fill();
      glowLine(ctx, a, b, 10, "rgba(230,244,255,0.9)", 30);
      ctx.restore();
      shakeRef.current = Math.max(shakeRef.current, 6);
      say("⚡ UNIBEAM · MAXIMUM OUTPUT"); setWeap("OVERLOAD");
    }

    // ---- update particles / rings / projectiles ----
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    parts.current = parts.current.filter((p) => {
      p.life -= 0.016 / p.max; if (p.life <= 0) return false;
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.vy += 0.05;
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    rings.current = rings.current.filter((r) => {
      r.r += r.vr; r.a -= 0.03; if (r.a <= 0) return false;
      ctx.globalAlpha = r.a; ctx.strokeStyle = r.c; ctx.lineWidth = r.w; ctx.shadowBlur = 16; ctx.shadowColor = r.c;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      return true;
    });
    projs.current = projs.current.filter((pr) => {
      pr.x += pr.vx; pr.y += pr.vy; pr.life -= 0.02;
      if (pr.life <= 0 || pr.x < -50 || pr.x > W + 50 || pr.y < -50 || pr.y > H + 50) return false;
      ctx.globalAlpha = 1; ctx.fillStyle = GOLD_HOT; ctx.shadowBlur = 14; ctx.shadowColor = GOLD;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(pr.x - pr.vx, pr.y - pr.vy, 6, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    ctx.restore();

    // ---- post FX: telemetry, scanline, vignette, flash ----
    drawTelemetry(ctx, W, H, hands.length, primaryWeapon, t);
    // scanline sweep
    const sy = (t * 90) % H;
    ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = GOLD_HOT; ctx.fillRect(0, sy, W, 2); ctx.restore();
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (flashRef.current > 0.01) { ctx.fillStyle = `rgba(200,230,255,${flashRef.current * 0.5})`; ctx.fillRect(0, 0, W, H); flashRef.current *= 0.82; }

    rafRef.current = requestAnimationFrame(loop);
  }

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      const v = videoRef.current;
      (v?.srcObject as MediaStream | null)?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const wColor = weapon === "MISSILE" ? colors.red : weapon === "STANDBY" ? colors.goldBright : colors.blueAccent;

  return (
    <main style={{ height: "100vh", width: "100vw", background: colors.bg, color: colors.text100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, overflow: "hidden", position: "relative" }}>
      <Link href="/" style={{ position: "absolute", top: 18, left: 20, fontFamily: fonts.display, fontSize: 11, letterSpacing: "0.15em", color: colors.text30, textDecoration: "none", zIndex: 3 }}>‹ BACK TO HUD</Link>
      <div style={{ fontFamily: fonts.display, fontSize: 13, letterSpacing: "0.35em", color: colors.goldBright, textShadow: `0 0 18px ${colors.goldGlow}` }}>ARC FORGE · MARK I GAUNTLET</div>

      <div ref={wrapRef} style={{ position: "relative", height: "70vh", aspectRatio: String(aspect), borderRadius: 18, overflow: "hidden", border: `1.5px solid ${colors.panelBorderHover}`, boxShadow: `0 0 55px rgba(240,168,48,0.2)`, background: "#000" }}>
        <video ref={videoRef} playsInline muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", opacity: started ? 0.7 : 0 }} />
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        {!started ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <button onClick={initialize} style={{ fontFamily: fonts.display, fontSize: 15, letterSpacing: "0.12em", fontWeight: 700, padding: "13px 30px", borderRadius: 12, cursor: "pointer", color: colors.bg, background: `linear-gradient(${colors.goldBright}, ${colors.goldPrimary})`, border: "none", boxShadow: `0 0 30px ${colors.goldGlow}` }}>⚡ FORGE THE GAUNTLET</button>
            <div style={{ fontFamily: fonts.display, fontSize: 11, color: colors.text30, maxWidth: 380, textAlign: "center" }}>{error || "Grants camera access — the feed never leaves this machine."}</div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div className="mono" style={{ fontSize: 13, letterSpacing: "0.06em", color: wColor, minWidth: 260, textAlign: "right" }}>{status}</div>
        <div style={{ width: 1, height: 16, background: colors.panelBorder }} />
        <div style={{ display: "flex", gap: 10, fontFamily: fonts.display, fontSize: 10, letterSpacing: "0.08em", color: colors.text30 }}>
          <span>✋ REPULSOR</span><span>✊ OVERLOAD</span><span>👉 MISSILES</span><span>✋✋ UNIBEAM</span>
        </div>
      </div>
    </main>
  );
}

function drawBrackets(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, a: number) {
  const L = Math.min(22, (x1 - x0) * 0.25);
  ctx.save();
  ctx.globalAlpha = a * 0.8;
  ctx.strokeStyle = "rgba(240,168,48,0.7)";
  ctx.lineWidth = 1.5;
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke();
  };
  corner(x0, y0, 1, 1); corner(x1, y0, -1, 1); corner(x0, y1, 1, -1); corner(x1, y1, -1, -1);
  ctx.restore();
}

function drawTelemetry(ctx: CanvasRenderingContext2D, W: number, H: number, hands: number, weapon: string, t: number) {
  ctx.save();
  ctx.font = "600 10px 'Space Grotesk', monospace";
  ctx.fillStyle = "rgba(240,168,48,0.6)";
  ctx.fillText("ARC REACTOR", 16, 22);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText(`HANDS ${hands}  ·  WEAPON ${weapon}  ·  SYNC ${(90 + Math.sin(t) * 8).toFixed(0)}%`, 16, 38);
  // top-right corner ticks
  ctx.strokeStyle = "rgba(240,168,48,0.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W - 40, 14); ctx.lineTo(W - 14, 14); ctx.lineTo(W - 14, 40); ctx.stroke();
  ctx.restore();
}
