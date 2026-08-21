// Synthesized sci-fi audio engine — Web Audio only, no sound files (keeps the
// spec's dependency/asset list clean). Provides a reactor hum plus one-shot SFX
// for gestures and voice cues. Must be unlock()'d from a user gesture first
// (browser autoplay policy); tapping the voice panel or the orb does that.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hum: { a: OscillatorNode; b: OscillatorNode; gain: GainNode } | null = null;
let unlocked = false;

export function unlock(): void {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  if (!unlocked) {
    unlocked = true;
    powerOn();
  }
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  sweepTo?: number,
): void {
  if (!ctx || !master) return;
  const t = now();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noiseBurst(dur: number, freq: number, sweepTo: number, gain: number): void {
  if (!ctx || !master) return;
  const t = now();
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.Q.value = 6;
  filt.frequency.setValueAtTime(freq, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function powerOn(): void {
  tone(110, 0.55, "sine", 0.25, 520);
  tone(220, 0.5, "triangle", 0.12, 660);
}

export function setHum(on: boolean): void {
  if (!ctx || !master) return;
  if (on && !hum) {
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    a.type = "sawtooth";
    b.type = "sawtooth";
    a.frequency.value = 55;
    b.frequency.value = 55.4;
    filt.type = "lowpass";
    filt.frequency.value = 220;
    g.gain.setValueAtTime(0.0001, now());
    g.gain.exponentialRampToValueAtTime(0.05, now() + 0.4);
    a.connect(filt);
    b.connect(filt);
    filt.connect(g);
    g.connect(master);
    a.start();
    b.start();
    hum = { a, b, gain: g };
  } else if (!on && hum) {
    const h = hum;
    hum = null;
    h.gain.gain.exponentialRampToValueAtTime(0.0001, now() + 0.35);
    h.a.stop(now() + 0.4);
    h.b.stop(now() + 0.4);
  }
}

export type Sfx =
  | "listen"
  | "thinking"
  | "error"
  | "whoosh"
  | "boom"
  | "rev"
  | "hyper"
  | "tick"
  | "chime"
  | "freeze";

export function sfx(name: Sfx): void {
  if (!ctx || !master) return;
  switch (name) {
    case "listen":
      tone(520, 0.12, "sine", 0.2, 780);
      break;
    case "thinking":
      tone(300, 0.18, "triangle", 0.12, 240);
      break;
    case "error":
      tone(400, 0.22, "sawtooth", 0.14, 140);
      break;
    case "whoosh": // zoom
      noiseBurst(0.35, 300, 2200, 0.14);
      break;
    case "boom": // burst
      tone(180, 0.5, "sine", 0.3, 42);
      noiseBurst(0.25, 800, 120, 0.1);
      break;
    case "rev": // implode
      tone(60, 0.4, "sine", 0.22, 360);
      break;
    case "hyper": // fast spin
      noiseBurst(0.4, 1200, 3200, 0.1);
      tone(660, 0.3, "square", 0.06, 1320);
      break;
    case "tick": // rotate
      tone(880, 0.05, "square", 0.06);
      break;
    case "chime": // reset
      tone(523, 0.18, "sine", 0.16);
      tone(784, 0.28, "sine", 0.14);
      break;
    case "freeze": // hold
      tone(140, 0.22, "sine", 0.2, 90);
      break;
  }
}
