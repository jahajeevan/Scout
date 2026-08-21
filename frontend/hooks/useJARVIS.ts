"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

// WebSocket connection to the JARVIS backend (spec §6). Native browser WebSocket
// (spec §3 forbids extra WS libraries). Speaks the streaming protocol from
// backend/main.py: {type:"chunk"|"done", text}.
//
// The message list is owned by the page so text chat (this hook) and voice chat
// (useVoice) share one conversation; both use the shared id counter.

export interface Source {
  title: string;
  url: string;
  snippet?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "jarvis";
  text: string;
  streaming: boolean;
  /** Optional data-URL of an attached image (vision turns, single). */
  image?: string;
  /** Data-URLs of attached images (vision turns, one or more). */
  images?: string[];
  /** True when the image(s) were generated (render larger). */
  generated?: boolean;
  /** True when the user pressed Stop mid-generation (spec §5). */
  stopped?: boolean;
  /** High-level tool activity (e.g. "Searching the web") shown while working. */
  activity?: string[];
  /** Web sources cited by this answer (spec §13/§25). */
  sources?: Source[];
  /** Memory changes made during this turn (spec §41). */
  memory?: string[];
  /** A confirm-gated action awaiting the user's yes/no (spec §19/§42). */
  confirm?: { tool: string; args: Record<string, unknown>; prompt: string };
}

type ServerEvent =
  | { type: "chunk"; text: string }
  | { type: "done"; text: string; stopped?: boolean; awaiting_confirm?: boolean }
  | { type: "activity"; label: string; ok: boolean }
  | { type: "sources"; sources: Source[] }
  | { type: "memory"; note: string }
  | { type: "confirm"; tool: string; args: Record<string, unknown>; prompt: string };

const BACKEND_PORT = process.env.NEXT_PUBLIC_BACKEND_PORT;

interface UseJarvis {
  connected: boolean;
  generating: boolean;
  sendMessage: (text: string, web?: boolean) => void;
  stop: () => void;
  confirmAction: (approve: boolean) => void;
}

export function useJARVIS(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  idRef: MutableRefObject<number>,
): UseJarvis {
  const [connected, setConnected] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamIdRef = useRef<number | null>(null);
  const closedByUs = useRef<boolean>(false);

  const connect = useCallback((): void => {
    if (typeof window === "undefined" || !BACKEND_PORT) return;
    const url = `ws://${window.location.hostname}:${BACKEND_PORT}/ws/chat`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      if (!closedByUs.current) window.setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (evt: MessageEvent<string>) => {
      let data: ServerEvent;
      try {
        data = JSON.parse(evt.data) as ServerEvent;
      } catch {
        return;
      }
      const target = streamIdRef.current;
      if (target === null) return;

      if (data.type === "chunk") {
        setMessages((prev) =>
          prev.map((m) => (m.id === target ? { ...m, text: m.text + data.text } : m)),
        );
      } else if (data.type === "activity") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target ? { ...m, activity: [...(m.activity ?? []), data.label] } : m,
          ),
        );
      } else if (data.type === "sources") {
        setMessages((prev) =>
          prev.map((m) => (m.id === target ? { ...m, sources: data.sources } : m)),
        );
      } else if (data.type === "memory") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target ? { ...m, memory: [...(m.memory ?? []), data.note] } : m,
          ),
        );
      } else if (data.type === "confirm") {
        // A tool needs explicit consent → attach a Confirm/Cancel prompt (spec §42).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target ? { ...m, confirm: { tool: data.tool, args: data.args, prompt: data.prompt } } : m,
          ),
        );
      } else if (data.type === "done") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target
              ? { ...m, text: data.text || m.text, streaming: false, stopped: data.stopped ?? false }
              : m,
          ),
        );
        streamIdRef.current = null;
        setGenerating(false);
      }
    };
  }, [setMessages]);

  useEffect(() => {
    closedByUs.current = false;
    connect();
    return () => {
      closedByUs.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback(
    (text: string, web = false): void => {
      const trimmed = text.trim();
      const ws = wsRef.current;
      if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return;
      // One generation at a time (spec §4) — the composer enforces this too.
      if (streamIdRef.current !== null) return;

      const userId = ++idRef.current;
      const jarvisId = ++idRef.current;
      streamIdRef.current = jarvisId;
      setGenerating(true);

      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", text: trimmed, streaming: false },
        { id: jarvisId, role: "jarvis", text: "", streaming: true },
      ]);
      ws.send(JSON.stringify({ message: trimmed, web }));
    },
    [setMessages, idRef],
  );

  // Stop the in-flight generation (spec §5). Tells the backend to cancel, then
  // flips the UI immediately — the partial answer stays on screen.
  const stop = useCallback((): void => {
    const ws = wsRef.current;
    const target = streamIdRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
    if (target !== null) {
      setMessages((prev) =>
        prev.map((m) => (m.id === target ? { ...m, streaming: false, stopped: true } : m)),
      );
    }
    streamIdRef.current = null;
    setGenerating(false);
  }, [setMessages]);

  // Approve/decline a confirm-gated action (spec §42). Clears the prompt and
  // starts a fresh streamed reply the backend fills with the result.
  const confirmAction = useCallback(
    (approve: boolean): void => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || streamIdRef.current !== null) return;
      setMessages((prev) => prev.map((m) => (m.confirm ? { ...m, confirm: undefined } : m)));
      const jarvisId = ++idRef.current;
      streamIdRef.current = jarvisId;
      setGenerating(true);
      setMessages((prev) => [...prev, { id: jarvisId, role: "jarvis", text: "", streaming: true }]);
      ws.send(JSON.stringify({ type: approve ? "confirm_yes" : "confirm_no" }));
    },
    [setMessages, idRef],
  );

  return { connected, generating, sendMessage, stop, confirmAction };
}
