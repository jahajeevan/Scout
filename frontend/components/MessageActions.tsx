"use client";

import { useEffect, useState } from "react";
import { toCopyText, toSpeechText } from "@/lib/markdownText";
import { onSpeakingChange, speak, speakingId, stop } from "@/lib/speech";

// Subtle per-message action row (spec §3/§17/§18): Copy (Markdown source, with a
// brief "Copied" state) and Speak (strips Markdown, plays via /speak TTS, toggles
// to Stop, interruptible). Only real actions — no dead controls (spec §49).

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

export default function MessageActions({
  id,
  text,
  onRegenerate,
}: {
  id: number;
  text: string;
  onRegenerate?: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => onSpeakingChange((sid) => setSpeaking(sid === id)), [id]);
  useEffect(() => setSpeaking(speakingId() === id), [id]);

  const copy = (): void => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    };
    const t = toCopyText(text);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done).catch(() => {});
    else done();
  };

  const onSpeak = (): void => {
    if (speaking) {
      stop();
      return;
    }
    const base = backendBase();
    if (!base) return;
    void speak(id, toSpeechText(text), base);
  };

  return (
    <div className="msg-actions">
      <button className="msg-action" onClick={copy} aria-label="Copy message">
        {copied ? "Copied" : "Copy"}
      </button>
      <button className="msg-action" onClick={onSpeak} aria-label={speaking ? "Stop speaking" : "Speak message"}>
        {speaking ? "Stop" : "Speak"}
      </button>
      {onRegenerate && (
        <button className="msg-action" onClick={onRegenerate} aria-label="Regenerate response">
          Regenerate
        </button>
      )}
    </div>
  );
}
