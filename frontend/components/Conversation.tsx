"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/useJARVIS";
import Markdown from "@/components/Markdown";
import MessageActions from "@/components/MessageActions";
import { brand } from "@/lib/brand";

// The conversation IS the product. A single readable column, generous spacing.
// JARVIS turns render Markdown (headings, code, lists, tables) as a well-set
// document; user turns are plain text in a quiet self-contained surface.

interface Props {
  messages: ChatMessage[];
  userName: string;
  onConfirm?: (approve: boolean) => void;
  onRegenerate?: (userText: string) => void;
}

export default function Conversation({ messages, userName, onConfirm, onRegenerate }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const regenerateFor = (scoutId: number): (() => void) | undefined => {
    if (!onRegenerate) return undefined;
    // Find the last user message before this Scout reply.
    const idx = messages.findIndex((m) => m.id === scoutId);
    if (idx <= 0) return undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].text) {
        const text = messages[i].text;
        return () => onRegenerate(text);
      }
    }
    return undefined;
  };

  return (
    <div className="conv-scroll" ref={scrollRef}>
      <div className="conv-col">
        {messages.length === 0 ? (
          <WorkspaceHome userName={userName} />
        ) : (
          messages.map((m) => (
            <Turn
              key={m.id}
              m={m}
              onConfirm={onConfirm}
              onRegenerate={m.role === "jarvis" ? regenerateFor(m.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const Turn = memo(function Turn({
  m, onConfirm, onRegenerate,
}: {
  m: ChatMessage;
  onConfirm?: (approve: boolean) => void;
  onRegenerate?: () => void;
}): JSX.Element {
  const isUser = m.role === "user";
  return (
    <div className={`msg ${isUser ? "user" : "jarvis"}`}>
      <span className="msg-role">{isUser ? "You" : brand.name}</span>
      {!isUser && m.activity && m.activity.length > 0 && (m.streaming || !m.text) ? (
        <div className="msg-activity">
          <span className="msg-activity-dot" />
          {m.activity[m.activity.length - 1]}…
        </div>
      ) : null}
      <div className="msg-body">
        {m.image || (m.images && m.images.length > 0) ? (
          <div className="msg-thumbs" style={{ marginBottom: m.text ? 8 : 0 }}>
            {(m.images ?? (m.image ? [m.image] : [])).map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={m.generated ? "generated image" : "attachment"} className={m.generated ? "msg-image-gen" : "msg-thumb"} />
            ))}
          </div>
        ) : null}
        {isUser ? (
          m.text
        ) : (
          <>
            <Markdown content={m.text} />
            {m.streaming ? <span className="caret" /> : null}
          </>
        )}
      </div>
      {!isUser && m.stopped ? <span className="msg-stopped">Stopped</span> : null}
      {!isUser && m.sources && m.sources.length > 0 ? (
        <div className="msg-sources">
          <span className="eyebrow" style={{ marginBottom: 2 }}>
            Sources
          </span>
          <div className="msg-sources-row">
            {m.sources.slice(0, 6).map((s, i) => (
              <a key={i} className="source-chip" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
                <span className="source-chip-n">{i + 1}</span>
                {hostOf(s.url)}
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {!isUser && m.memory && m.memory.length > 0
        ? m.memory.map((note, i) => (
            <div key={i} className="mem-note">
              <span className="mem-note-dot" />
              {note}
            </div>
          ))
        : null}
      {!isUser && m.confirm ? (
        <div className="confirm-card">
          <div className="confirm-detail">
            {m.confirm.tool === "send_email" ? (
              <>
                Send this email to <b>{String(m.confirm.args.to ?? "")}</b>
                {m.confirm.args.subject ? (
                  <>
                    {" "}
                    — “{String(m.confirm.args.subject)}”
                  </>
                ) : null}
                ?
              </>
            ) : (
              m.confirm.prompt
            )}
          </div>
          <div className="confirm-actions">
            <button className="confirm-yes" onClick={() => onConfirm?.(true)}>
              Confirm &amp; send
            </button>
            <button className="confirm-no" onClick={() => onConfirm?.(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {!isUser && !m.streaming && m.text && !m.confirm ? (
        <MessageActions id={m.id} text={m.text} onRegenerate={onRegenerate} />
      ) : null}
    </div>
  );
});

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

/**
 * TodayPanel — the ambient content that fills the home page below the greeting.
 * Not a chatbot CTA, not decoration. A quiet dashboard of what Scout is holding
 * for you right now: weather, next event, one memory, inbox state.
 * Every row degrades gracefully to nothing if its endpoint fails.
 */
function TodayPanel(): JSX.Element {
  const [weather, setWeather] = useState<{ city: string; temp_c: number | null; description: string; emoji: string } | null>(null);
  const [events, setEvents] = useState<{ time: string; title: string }[] | null>(null);
  const [memory, setMemory] = useState<string | null>(null);
  const [inbox, setInbox] = useState<number>(0);

  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/weather`).then((r) => r.json()).then(setWeather).catch(() => {});
    fetch(`${base}/calendar`).then((r) => r.json()).then((d: { events?: typeof events }) => setEvents(d.events ?? [])).catch(() => {});
    fetch(`${base}/memory/personal`)
      .then((r) => r.json())
      .then((d: { memories?: { value: string }[] }) => {
        const list = d.memories ?? [];
        if (list.length) setMemory(list[Math.floor(Math.random() * list.length)].value);
      })
      .catch(() => {});
    fetch(`${base}/autonomy/proposals`)
      .then((r) => r.json())
      .then((d: { proposals?: unknown[] }) => setInbox((d.proposals ?? []).length))
      .catch(() => {});
  }, []);

  const nextEvent = events && events.length > 0 ? events[0] : null;

  return (
    <div className="today">
      <div className="today-eyebrow">Today</div>
      <div className="today-rows">
        {weather && weather.temp_c !== null && (
          <div className="today-row">
            <span className="today-key">Weather</span>
            <span className="today-val">
              {weather.emoji} {Math.round(weather.temp_c)}° · {weather.description} · {weather.city}
            </span>
          </div>
        )}
        {nextEvent && (
          <div className="today-row">
            <span className="today-key">Next</span>
            <span className="today-val">
              <span className="today-strong">{nextEvent.time}</span> · {nextEvent.title}
            </span>
          </div>
        )}
        {inbox > 0 && (
          <div className="today-row">
            <span className="today-key">Inbox</span>
            <span className="today-val">
              <span className="today-strong">{inbox}</span> item{inbox === 1 ? "" : "s"} waiting for your approval
            </span>
          </div>
        )}
        {memory && (
          <div className="today-row">
            <span className="today-key">Remembering</span>
            <span className="today-val today-memory">"{memory}"</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * WorkspaceHome — the compact opening view. Not a landing page.
 *
 * A single tight header line (greeting + time-of-day), a row of quick actions
 * the user can start work from, and the Today ambient strip. The composer
 * sits below in its own place. Everything above the fold; no giant
 * dead space to scroll past.
 */
function WorkspaceHome({ userName }: { userName: string }): JSX.Element {
  // Fires the same events the global keyboard shortcuts do, so tile clicks and
  // ⌘-shortcuts route to a single set of handlers in page.tsx.
  const fire = (name: string): void => {
    window.dispatchEvent(new CustomEvent(`scout:${name}`));
  };

  return (
    <div className="wh">
      <header className="wh-header">
        <div className="wh-greet">
          <span className="wh-time">{timeGreeting()}</span>
          <span className="wh-comma">,</span>
          <span className="wh-name">{userName}</span>
          <span className="wh-dot">·</span>
          <span className="wh-sub">what are we doing?</span>
        </div>
      </header>

      <div className="wh-actions" role="list">
        <QuickAction icon="💬" hotkey="⌘/" label="Ask anything" hint="Start a conversation" tone="terracotta" onClick={() => fire("focus-composer")} />
        <QuickAction icon="🔍" hotkey="⌘K" label="Search" hint="Web · docs · memory" tone="sage" onClick={() => fire("search")} />
        <QuickAction icon="📄" hotkey="⌘⇧F" label="Open a file" hint="PDF · docx · code · media" tone="copper" onClick={() => fire("open-file")} />
        <QuickAction icon="⌘" hotkey="⌘⇧C" label="Code" hint="Workspace-aware engineering" tone="copper" onClick={() => fire("open-code")} />
        <QuickAction icon="👁" hotkey="⌘⇧E" label="What's on screen?" hint="See + reason about the active app" tone="amber" onClick={() => fire("see-screen")} />
        <QuickAction icon="✦" hotkey="⌘⇧A" label="Autonomy" hint="Daemons · approvals · routines" tone="plum" onClick={() => fire("open-autonomy")} />
      </div>

      <TodayPanel />
    </div>
  );
}

function QuickAction({
  label, hint, hotkey, tone, icon, onClick,
}: {
  label: string; hint: string; hotkey: string;
  tone?: "terracotta" | "sage" | "copper" | "plum" | "amber";
  icon?: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className="wh-action"
      role="listitem"
      onClick={onClick}
      data-tone={tone ?? "terracotta"}
      data-icon={icon ?? ""}
      type="button"
    >
      <div className="wh-action-main">
        <span className="wh-action-label">{label}</span>
        <span className="wh-action-hint">{hint}</span>
      </div>
      <span className="wh-action-key">{hotkey}</span>
    </button>
  );
}
