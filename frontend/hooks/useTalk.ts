"use client";

import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatMessage } from "@/hooks/useJARVIS";
import * as sound from "@/lib/sound";

// TALK — continuous, STREAMING conversational voice (spec §6–§11, §17).
//
// The utterance is captured with a VAD, sent to the backend `/ws/voice`, and the
// reply streams back token-by-token AND sentence-by-sentence as audio: Scout
// starts SPEAKING the first sentence while it's still generating the rest, so a
// turn feels immediate rather than capture → wait → speak. The mic stays open so
// the user can BARGE IN — start talking and Scout stops and listens (spec §8/§10).
//
// Honest boundary: speech-to-text (Whisper) is still batch per-utterance; the
// streaming applies to the reply (LLM + TTS), which is where the wait was.

export type TalkState = "idle" | "listening" | "thinking" | "speaking";

const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT;

// Utterance VAD (level is 0..1).
const START_THRESH = 0.06;
const SILENCE_THRESH = 0.035;
const SILENCE_HANG_MS = 1000;
const NO_SPEECH_MS = 9000;
const MAX_MS = 20000;
const BARGE_THRESH = 0.14;
const BARGE_FRAMES = 3;

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
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
  return buffer;
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

interface UseTalk {
  state: TalkState;
  active: boolean;
  levelRef: MutableRefObject<number>;
  toggle: () => void;
}

export function useTalk(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  idRef: MutableRefObject<number>,
): UseTalk {
  const [state, setState] = useState<TalkState>("idle");
  const [active, setActive] = useState(false);
  const levelRef = useRef<number>(0);

  const stateRef = useRef<TalkState>("idle");
  const sessionRef = useRef<boolean>(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nativeRateRef = useRef<number>(48000);

  const chunksRef = useRef<Float32Array[]>([]);
  const capturingRef = useRef<boolean>(false);
  const speechStartedRef = useRef<boolean>(false);
  const lastLoudRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const bargeCountRef = useRef<number>(0);

  // Streaming voice channel + playback queue.
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef<boolean>(false);
  const turnActiveRef = useRef<boolean>(false); // accept audio for the current turn
  const streamDoneRef = useRef<boolean>(false);
  const assistantIdRef = useRef<number | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  const setPhase = (s: TalkState): void => {
    stateRef.current = s;
    setState(s);
  };

  const beginListening = useCallback((): void => {
    if (!sessionRef.current) return;
    chunksRef.current = [];
    capturingRef.current = true;
    speechStartedRef.current = false;
    startTimeRef.current = performance.now();
    lastLoudRef.current = performance.now();
    bargeCountRef.current = 0;
    setPhase("listening");
    sound.sfx("listen");
  }, []);

  const stopPlayback = useCallback((): void => {
    window.cancelAnimationFrame(rafRef.current);
    queueRef.current = [];
    playingRef.current = false;
    turnActiveRef.current = false;
    try {
      srcRef.current?.stop();
    } catch {
      /* already stopped */
    }
    srcRef.current = null;
    levelRef.current = 0;
  }, []);

  // Play the next queued audio sentence; when the queue drains and the reply is
  // complete, hand back to listening.
  const playNext = useCallback((): void => {
    const b64 = queueRef.current.shift();
    if (b64 === undefined) {
      playingRef.current = false;
      if (streamDoneRef.current && sessionRef.current) beginListening();
      return;
    }
    playingRef.current = true;
    setPhase("speaking");
    let ctx = playCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      playCtxRef.current = ctx;
    }
    ctx.decodeAudioData(b64ToArrayBuffer(b64))
      .then((buffer) => {
        if (!sessionRef.current || !turnActiveRef.current) {
          playingRef.current = false;
          return;
        }
        const c = playCtxRef.current!;
        const src = c.createBufferSource();
        srcRef.current = src;
        src.buffer = buffer;
        const analyser = c.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        analyser.connect(c.destination);
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
        src.start();
        tick();
        src.onended = () => {
          window.cancelAnimationFrame(rafRef.current);
          levelRef.current = 0;
          srcRef.current = null;
          playNext();
        };
      })
      .catch(() => {
        playingRef.current = false;
        playNext();
      });
  }, [beginListening]);

  const enqueueAudio = useCallback(
    (b64: string): void => {
      if (!turnActiveRef.current) return;
      queueRef.current.push(b64);
      if (!playingRef.current) playNext();
    },
    [playNext],
  );

  // Handle one streamed event from /ws/voice.
  const onVoiceEvent = useCallback(
    (msg: { type: string; text?: string; audio?: string; reply?: string }): void => {
      if (!sessionRef.current) return;
      if (msg.type === "transcript") {
        if (!msg.text) {
          // No speech detected — quietly re-arm.
          beginListening();
          return;
        }
        const uid = ++idRef.current;
        const jid = ++idRef.current;
        assistantIdRef.current = jid;
        setMessages((prev) => [
          ...prev,
          { id: uid, role: "user", text: msg.text as string, streaming: false },
          { id: jid, role: "jarvis", text: "", streaming: true },
        ]);
      } else if (msg.type === "text") {
        const jid = assistantIdRef.current;
        if (jid !== null) {
          setMessages((prev) => prev.map((m) => (m.id === jid ? { ...m, text: m.text + (msg.text ?? "") } : m)));
        }
      } else if (msg.type === "audio") {
        if (msg.audio) enqueueAudio(msg.audio);
      } else if (msg.type === "done") {
        streamDoneRef.current = true;
        const jid = assistantIdRef.current;
        if (jid !== null) {
          setMessages((prev) => prev.map((m) => (m.id === jid ? { ...m, streaming: false } : m)));
        }
        // If nothing is queued/playing, go back to listening now.
        if (!playingRef.current && queueRef.current.length === 0 && sessionRef.current) beginListening();
      }
    },
    [beginListening, enqueueAudio, idRef, setMessages],
  );

  const processUtterance = useCallback((): void => {
    capturingRef.current = false;
    const native = nativeRateRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total < native * 0.2) {
      if (sessionRef.current) beginListening();
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

    // New turn: accept its audio, reset the reply stream.
    turnActiveRef.current = true;
    streamDoneRef.current = false;
    assistantIdRef.current = null;
    queueRef.current = [];

    const wav = encodeWav(downsample(flat, native, 16000), 16000);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(wav);
    } else if (sessionRef.current) {
      beginListening();
    }
  }, [beginListening]);

  const onAudio = useCallback(
    (e: AudioProcessingEvent): void => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const level = Math.min(1, Math.sqrt(sum / input.length) * 4);
      const st = stateRef.current;

      if (st === "listening" && capturingRef.current) {
        levelRef.current = level;
        chunksRef.current.push(new Float32Array(input));
        const now = performance.now();
        if (level > START_THRESH) {
          speechStartedRef.current = true;
          lastLoudRef.current = now;
        } else if (level > SILENCE_THRESH) {
          lastLoudRef.current = now;
        }
        if (speechStartedRef.current && now - lastLoudRef.current > SILENCE_HANG_MS) {
          processUtterance();
        } else if (!speechStartedRef.current && now - startTimeRef.current > NO_SPEECH_MS) {
          beginListening();
        } else if (now - startTimeRef.current > MAX_MS) {
          processUtterance();
        }
      } else if (st === "speaking") {
        // Barge-in: user talks over Scout → stop speaking and listen.
        if (level > BARGE_THRESH) bargeCountRef.current += 1;
        else bargeCountRef.current = 0;
        if (bargeCountRef.current >= BARGE_FRAMES) {
          stopPlayback();
          beginListening();
          chunksRef.current.push(new Float32Array(input));
          speechStartedRef.current = true;
          lastLoudRef.current = performance.now();
        }
      }
    },
    [beginListening, processUtterance, stopPlayback],
  );

  const teardown = useCallback((): void => {
    stopPlayback();
    if (playCtxRef.current) {
      void playCtxRef.current.close();
      playCtxRef.current = null;
    }
    try {
      wsRef.current?.close();
    } catch {
      /* noop */
    }
    wsRef.current = null;
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (ctxRef.current) void ctxRef.current.close();
    processorRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    capturingRef.current = false;
    levelRef.current = 0;
  }, [stopPlayback]);

  const stop = useCallback((): void => {
    sessionRef.current = false;
    teardown();
    setActive(false);
    setPhase("idle");
  }, [teardown]);

  const start = useCallback(async (): Promise<void> => {
    sound.unlock();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      nativeRateRef.current = ctx.sampleRate;
      processor.onaudioprocess = onAudio;
      source.connect(processor);
      processor.connect(ctx.destination);
      streamRef.current = stream;
      ctxRef.current = ctx;
      processorRef.current = processor;

      // Open the streaming voice channel.
      const ws = new WebSocket(`ws://${window.location.hostname}:${BACKEND_PORT}/ws/voice`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => {
        try {
          onVoiceEvent(JSON.parse(ev.data as string));
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        if (sessionRef.current) stop();
      };
      wsRef.current = ws;

      sessionRef.current = true;
      setActive(true);
      beginListening();
    } catch {
      setActive(false);
      setPhase("idle");
    }
  }, [beginListening, onAudio, onVoiceEvent, stop]);

  const toggle = useCallback((): void => {
    if (sessionRef.current) stop();
    else void start();
  }, [start, stop]);

  return { state, active, levelRef, toggle };
}
