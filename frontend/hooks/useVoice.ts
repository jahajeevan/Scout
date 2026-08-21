"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatMessage } from "@/hooks/useJARVIS";
import * as sound from "@/lib/sound";

// Browser voice loop: tap to speak → record mic → auto-send when you pause →
// POST /voice (Whisper STT → LLM → Kokoro TTS) → play the spoken reply.
// `levelRef` carries the live amplitude (mic while listening, TTS while speaking)
// so the VoiceWave and the orb pulse with it. Web Audio + fetch only (spec §3);
// audio is captured as raw PCM and encoded to 16 kHz mono WAV in-browser so the
// backend needs no ffmpeg.

export type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";

const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT;

// Voice-activity thresholds (level is 0..1).
const START_THRESH = 0.06;
const SILENCE_THRESH = 0.035;
const SILENCE_HANG_MS = 1200; // auto-send after this much trailing silence
const NO_SPEECH_MS = 7000; // give up if no speech starts
const MAX_MS = 15000; // hard cap on one utterance

interface VoiceResponse {
  transcript: string;
  reply: string;
  audio: string | null;
  sample_rate: number;
}

interface UseVoice {
  status: VoiceStatus;
  levelRef: MutableRefObject<number>;
  toggle: () => void;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function useVoice(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  idRef: MutableRefObject<number>,
): UseVoice {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const levelRef = useRef<number>(0);

  const statusRef = useRef<VoiceStatus>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const nativeRateRef = useRef<number>(48000);
  const rafRef = useRef<number>(0);

  // VAD state
  const vadTimerRef = useRef<number | null>(null);
  const speechStartedRef = useRef<boolean>(false);
  const lastLoudRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const setPhase = (s: VoiceStatus): void => {
    statusRef.current = s;
    setStatus(s);
  };

  const addJarvisNote = useCallback(
    (text: string): void => {
      const jid = ++idRef.current;
      setMessages((prev) => [...prev, { id: jid, role: "jarvis", text, streaming: false }]);
    },
    [idRef, setMessages],
  );

  const clearVad = (): void => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  };

  const teardownMic = (): void => {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (ctxRef.current) void ctxRef.current.close();
    processorRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    levelRef.current = 0;
  };

  const speak = useCallback((b64: string): void => {
    const playCtx = new AudioContext();
    playCtx
      .decodeAudioData(b64ToArrayBuffer(b64))
      .then((buffer) => {
        const src = playCtx.createBufferSource();
        src.buffer = buffer;
        const analyser = playCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyser.connect(playCtx.destination);
        const data = new Uint8Array(analyser.fftSize);

        const tick = (): void => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          levelRef.current = Math.min(1, Math.sqrt(sum / data.length) * 3.5);
          rafRef.current = window.requestAnimationFrame(tick);
        };

        setPhase("speaking");
        src.start();
        tick();
        src.onended = () => {
          window.cancelAnimationFrame(rafRef.current);
          levelRef.current = 0;
          void playCtx.close();
          setPhase("idle");
        };
      })
      .catch(() => {
        void playCtx.close();
        levelRef.current = 0;
        setPhase("idle");
      });
  }, []);

  const stopAndSend = useCallback(async (): Promise<void> => {
    clearVad();
    const native = nativeRateRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    teardownMic();

    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total < native * 0.25) {
      addJarvisNote("I didn't quite catch that, sir — tap and try again.");
      sound.sfx("error");
      setPhase("idle");
      return;
    }

    const flat = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      flat.set(c, o);
      o += c.length;
    }

    setPhase("thinking");
    sound.sfx("thinking");
    const wav = encodeWav(downsample(flat, native, 16000), 16000);
    const form = new FormData();
    form.append("file", wav, "speech.wav");

    try {
      const res = await fetch(
        `http://${window.location.hostname}:${BACKEND_PORT}/voice`,
        { method: "POST", body: form },
      );
      const data = (await res.json()) as VoiceResponse;
      if (data.transcript) {
        const uid = ++idRef.current;
        const jid = ++idRef.current;
        setMessages((prev) => [
          ...prev,
          { id: uid, role: "user", text: data.transcript, streaming: false },
          { id: jid, role: "jarvis", text: data.reply, streaming: false },
        ]);
      } else {
        addJarvisNote("I didn't quite catch that, sir — tap and try again.");
      }
      if (data.audio) {
        speak(data.audio);
      } else {
        setPhase("idle");
      }
    } catch {
      addJarvisNote("Voice link interrupted, sir. Is the backend running?");
      sound.sfx("error");
      setPhase("idle");
    }
  }, [addJarvisNote, idRef, setMessages, speak]);

  const cancelListening = useCallback((): void => {
    clearVad();
    chunksRef.current = [];
    teardownMic();
    setPhase("idle");
  }, []);

  const start = useCallback(async (): Promise<void> => {
    sound.unlock();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      nativeRateRef.current = ctx.sampleRate;

      processor.onaudioprocess = (e: AudioProcessingEvent): void => {
        const input = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        levelRef.current = Math.min(1, Math.sqrt(sum / input.length) * 4);
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      streamRef.current = stream;
      ctxRef.current = ctx;
      processorRef.current = processor;

      // Voice-activity auto-stop.
      speechStartedRef.current = false;
      startTimeRef.current = performance.now();
      lastLoudRef.current = performance.now();
      vadTimerRef.current = window.setInterval(() => {
        const now = performance.now();
        const lvl = levelRef.current;
        if (lvl > START_THRESH) {
          speechStartedRef.current = true;
          lastLoudRef.current = now;
        } else if (lvl > SILENCE_THRESH) {
          lastLoudRef.current = now;
        }
        if (speechStartedRef.current && now - lastLoudRef.current > SILENCE_HANG_MS) {
          void stopAndSend();
        } else if (!speechStartedRef.current && now - startTimeRef.current > NO_SPEECH_MS) {
          cancelListening();
        } else if (now - startTimeRef.current > MAX_MS) {
          void stopAndSend();
        }
      }, 120);

      setPhase("listening");
      sound.sfx("listen");
    } catch {
      setPhase("idle");
    }
  }, [cancelListening, stopAndSend]);

  const toggle = useCallback((): void => {
    sound.unlock();
    const s = statusRef.current;
    if (s === "listening") void stopAndSend();
    else if (s === "idle") void start();
    // ignore taps while thinking/speaking
  }, [start, stopAndSend]);

  return { status, levelRef, toggle };
}
