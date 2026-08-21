"use client";

import { useEffect, useRef, useState } from "react";
import { colors, fonts } from "@/lib/tokens";
import * as sound from "@/lib/sound";
import type { ChatMessage } from "@/hooks/useJARVIS";
import type { ModelInfo } from "@/hooks/useModels";

interface ChatWindowProps {
  messages: ChatMessage[];
  connected: boolean;
  onSend: (text: string) => void;
  onOpenPhone?: () => void;
  // Model switcher (spec §20). Optional so the component still renders without it.
  models?: ModelInfo[];
  activeId?: string;
  active?: ModelInfo | null;
  onSelectModel?: (id: string) => void;
  onSendImage?: (file: File, prompt: string) => void;
}

// One-tap shortcuts for the Phase 6/7 skills. Clicking sends the same text a
// user could type, so it flows through the exact command router on the backend.
const QUICK_ACTIONS: { label: string; cmd: string }[] = [
  { label: "👁 Scan screen", cmd: "what's on my screen" },
  { label: "🌀 Fan", cmd: "turn on the fan" },
  { label: "⚡ Boost", cmd: "boost the fan" },
  { label: "❄️ AC", cmd: "turn on the AC" },
  { label: "🔽 Cooler", cmd: "make the AC cooler" },
  { label: "🔼 Warmer", cmd: "make the AC warmer" },
];

export default function ChatWindow({
  messages,
  connected,
  onSend,
  onOpenPhone,
  models = [],
  activeId = "",
  active = null,
  onSelectModel,
  onSendImage,
}: ChatWindowProps): JSX.Element {
  const [draft, setDraft] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(): void {
    if (!draft.trim()) return;
    sound.sfx("tick");
    onSend(draft);
    setDraft("");
  }

  function pickImage(): void {
    if (!active?.vision) return;
    fileRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (f && onSendImage) {
      sound.sfx("tick");
      onSendImage(f, draft);
      setDraft("");
    }
    e.target.value = "";
  }

  const canAttach = !!active?.vision && !!onSendImage;

  function quick(cmd: string): void {
    if (!connected) return;
    sound.sfx("tick");
    onSend(cmd);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ---- Model switcher (spec §20) — capabilities adapt the controls ---- */}
      {models.length > 0 && onSelectModel ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: fonts.display,
              fontSize: 8,
              letterSpacing: "0.16em",
              color: colors.text30,
            }}
          >
            MODEL
          </span>
          <select
            value={activeId}
            onChange={(e) => {
              sound.sfx("tick");
              onSelectModel(e.target.value);
            }}
            className="mono"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${colors.panelBorder}`,
              borderRadius: 8,
              color: colors.goldBright,
              fontSize: 11,
              padding: "4px 8px",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} style={{ background: "#0b0e13" }}>
                {m.label}
                {m.available ? "" : " (no key)"}
              </option>
            ))}
          </select>
          {/* Capability chips light up per selected model */}
          <CapabilityChip on={!!active} label="TEXT" />
          <CapabilityChip on={!!active?.vision} label="👁 IMAGE" />
          <CapabilityChip on={!!active?.documents} label="📄 PDF" />
          <CapabilityChip on={!!active?.tools} label="⚙ TOOLS" />
          {active && !active.available ? (
            <span
              style={{
                fontFamily: fonts.display,
                fontSize: 9,
                color: colors.red,
              }}
              title={active.note}
            >
              key missing
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="jv-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "4px 2px",
          minHeight: 0,
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              color: colors.text30,
              fontFamily: fonts.display,
              fontSize: 12,
              textAlign: "center",
              margin: "auto",
            }}
          >
            Awaiting your command, sir.
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {onOpenPhone ? (
          <button
            className="qa-chip"
            onClick={() => {
              sound.sfx("tick");
              onOpenPhone();
            }}
            title="Mirror & control your phone"
            style={{ borderColor: "rgba(91,168,240,0.4)", color: "#8CC6FF" }}
          >
            📱 Phone
          </button>
        ) : null}
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.label}
            className="qa-chip"
            onClick={() => quick(q.cmd)}
            disabled={!connected}
            title={q.cmd}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          style={{ display: "none" }}
        />
        {canAttach ? (
          <button
            onClick={pickImage}
            title={`Send an image to ${active?.label} for analysis`}
            style={{
              background: "rgba(91,168,240,0.10)",
              border: `1px solid ${colors.blueGlow}`,
              borderRadius: 10,
              padding: "0 12px",
              color: "#8CC6FF",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            📎
          </button>
        ) : null}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={
            connected
              ? canAttach
                ? "Message, or 📎 attach an image…"
                : "Message JARVIS…"
              : "Connecting…"
          }
          disabled={!connected}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.85)",
            border: `1px solid ${colors.panelBorder}`,
            borderRadius: 12,
            padding: "10px 13px",
            color: colors.text100,
            fontFamily: fonts.display,
            fontSize: 13,
            outline: "none",
            boxShadow: "inset 0 1px 2px rgba(16,34,60,0.04)",
          }}
        />
        <button
          onClick={submit}
          disabled={!connected}
          style={{
            background: connected ? colors.goldPrimary : "rgba(20,40,80,0.06)",
            border: "1px solid transparent",
            borderRadius: 12,
            padding: "0 18px",
            color: connected ? "#FFFFFF" : colors.text30,
            fontFamily: fonts.display,
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: "0.08em",
            cursor: connected ? "pointer" : "not-allowed",
            boxShadow: connected ? "0 4px 14px rgba(45,123,230,0.28)" : "none",
            transition: "transform 0.1s ease, box-shadow 0.2s ease",
          }}
        >
          SEND
        </button>
      </div>
    </div>
  );
}

function CapabilityChip({ on, label }: { on: boolean; label: string }): JSX.Element {
  return (
    <span
      style={{
        fontFamily: fonts.display,
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: "0.1em",
        padding: "2px 6px",
        borderRadius: 6,
        border: `1px solid ${on ? colors.blueGlow : colors.panelBorder}`,
        background: on ? "rgba(91,168,240,0.10)" : "transparent",
        color: on ? "#8CC6FF" : colors.text30,
        opacity: on ? 1 : 0.5,
        transition: "opacity 0.2s, background 0.2s",
      }}
    >
      {label}
    </span>
  );
}

function Bubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === "user";
  const accent = isUser ? colors.blueAccent : colors.goldPrimary;
  // Capture the arrival time once, when the bubble first mounts.
  const timeRef = useRef<string>(
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  );
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
        background: isUser ? "rgba(110,127,243,0.09)" : "rgba(255,255,255,0.72)",
        border: `1px solid ${isUser ? "rgba(110,127,243,0.28)" : colors.panelBorder}`,
        borderRadius: 14,
        padding: "8px 12px",
        boxShadow: "0 1px 2px rgba(16,34,60,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
          }}
        />
        <span
          style={{
            fontFamily: fonts.display,
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: "0.16em",
            color: accent,
          }}
        >
          {isUser ? "YOU" : "JARVIS"}
        </span>
        <span
          className="mono"
          style={{ fontSize: 8, color: colors.text30, marginLeft: "auto" }}
        >
          {timeRef.current}
        </span>
      </div>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 13,
          lineHeight: 1.45,
          color: colors.text100,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.text}
        {message.streaming ? (
          <span style={{ color: colors.goldBright }}>▋</span>
        ) : null}
      </div>
    </div>
  );
}
