"use client";

import { useEffect, useRef, useState } from "react";
import { NEUTRAL_STATE, type ReactorState } from "@/components/ArcReactor";

// Gesture WebSocket listener (Phase 3). Connects to the gesture bridge
// (backend/gesture/ws_bridge.py) on gesture_ws_port from config/jarvis.json and
// turns the stream of hand events into (a) a label for the HUD and (b) an
// accumulated ReactorState that drives the particle sun continuously.
// Native WebSocket only (spec §3).

export type Gesture = string; // backend emits: rotate | zoom | expand | pinch | peace | point | reset | two_hands | ...

export interface GestureState {
  gesture: Gesture | null;
  connected: boolean;
  reactor: ReactorState;
}

// Richer per-frame payload from the tracker.
interface GestureEvent {
  gesture: Gesture | null;
  hands?: number;
  rotDX?: number; // radians to add to rotX
  rotDY?: number; // radians to add to rotY
  zoom?: number | null; // absolute zoom target when actively zooming
  explode?: number; // 0..1
  grabbing?: boolean;
  reset?: boolean; // reset rotation/zoom/explode to neutral
}

const GESTURE_PORT = process.env.NEXT_PUBLIC_GESTURE_WS_PORT;
const AUTO_CLEAR_MS = 900;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function useGestures(): GestureState {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [reactor, setReactor] = useState<ReactorState>({ ...NEUTRAL_STATE });

  const reactorRef = useRef<ReactorState>({ ...NEUTRAL_STATE });
  const wsRef = useRef<WebSocket | null>(null);
  const closedByUs = useRef<boolean>(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !GESTURE_PORT) return;
    closedByUs.current = false;

    function connect(): void {
      const url = `ws://${window.location.hostname}:${GESTURE_PORT}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUs.current) window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (evt: MessageEvent<string>) => {
        let data: GestureEvent;
        try {
          data = JSON.parse(evt.data) as GestureEvent;
        } catch {
          return;
        }

        // Accumulate the continuous reactor control.
        const cur = reactorRef.current;
        const next: ReactorState = data.reset
          ? { ...NEUTRAL_STATE }
          : {
              rotX: cur.rotX + (data.rotDX ?? 0),
              rotY: cur.rotY + (data.rotDY ?? 0),
              zoom:
                data.zoom === null || data.zoom === undefined
                  ? cur.zoom
                  : clamp(data.zoom, ZOOM_MIN, ZOOM_MAX),
              explode: data.explode ?? 0,
              grabbing: data.grabbing ?? false,
            };
        reactorRef.current = next;
        setReactor(next);

        // Label for the HUD panels (auto-clears so momentary poses fade).
        setGesture(data.gesture ?? null);
        if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
        if (data.gesture) {
          clearTimer.current = window.setTimeout(() => setGesture(null), AUTO_CLEAR_MS);
        }
      };
    }

    connect();
    return () => {
      closedByUs.current = true;
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return { gesture, connected, reactor };
}
