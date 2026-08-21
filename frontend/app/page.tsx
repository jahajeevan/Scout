"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Conversation from "@/components/Conversation";
import Composer from "@/components/Composer";
import CommandCenter from "@/components/CommandCenter";
import Sidebar from "@/components/Sidebar";
import Settings from "@/components/Settings";
import Autonomy from "@/components/Autonomy";
import FileViewer from "@/components/FileViewer";
import StatusBar from "@/components/StatusBar";
import { IconSliders, IconPanelLeft, IconCode, IconFolder, IconSparkles, IconBolt } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { useJARVIS, type ChatMessage } from "@/hooks/useJARVIS";
import { useModels } from "@/hooks/useModels";
import { useTalk } from "@/hooks/useTalk";
import { useLiveData } from "@/hooks/useLiveData";
import { useConversations } from "@/hooks/useConversations";
import { colors } from "@/lib/tokens";

const USER_NAME_FALLBACK = process.env.NEXT_PUBLIC_USER_NAME ?? "there";

interface Weather {
  city: string;
  temp_c: number | null;
  description: string;
  emoji: string;
}
interface CalEvent {
  time: string;
  title: string;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

function maxId(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => Math.max(n, m.id), 0);
}

export default function Home(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const idRef = useRef<number>(0);
  const { connected, generating, sendMessage, stop, confirmAction } = useJARVIS(setMessages, idRef);
  const models = useModels();
  const talk = useTalk(setMessages, idRef);
  const live = useLiveData();
  const convos = useConversations();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"voice" | "connectors" | "mcp" | "routines" | "memory" | "about" | undefined>(undefined);
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  const [autonomyInboxBadge, setAutonomyInboxBadge] = useState<number>(0);
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const openSettings = (sec?: "voice" | "connectors" | "mcp" | "routines" | "memory" | "about"): void => {
    setSettingsSection(sec);
    setSettingsOpen(true);
    setDrawerOpen(false);
  };

  // Pull the pending-proposal count for the sidebar nav badge.
  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    const load = (): void => {
      fetch(`${base}/autonomy/proposals`)
        .then((r) => r.json())
        .then((d: { proposals?: unknown[] }) => setAutonomyInboxBadge((d.proposals ?? []).length))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, []);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [userName, setUserName] = useState<string>(USER_NAME_FALLBACK);
  const clock = useClock();

  // The name Scout greets you by comes from the backend config (single source).
  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/health`)
      .then((r) => r.json())
      .then((d: { user?: string }) => d.user && setUserName(d.user))
      .catch(() => {});
  }, []);

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const hydrated = useRef(false);

  // Sidebar open on desktop, collapsed on phones (drawer). matchMedia keeps this
  // correct as the viewport crosses the breakpoint (and fixes narrow-on-load).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 860px)");
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Every launch opens a fresh new-conversation home screen — the last chat
  // stays in the sidebar (user can click to reopen) but isn't auto-loaded.
  useEffect(() => {
    if (!convos.ready || hydrated.current) return;
    hydrated.current = true;
    convos.newConversation();
    setMessages([]);
    idRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convos.ready]);

  // Persist on meaningful change (new message or streaming finished) — not per token.
  const last = messages[messages.length - 1];
  const sig = `${messages.length}:${last?.streaming ? "s" : "d"}:${convos.activeId}`;
  useEffect(() => {
    if (!convos.ready || !hydrated.current) return;
    convos.syncActive(messagesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const newConversation = (): void => {
    convos.newConversation();
    setMessages([]);
    idRef.current = 0;
    setDrawerOpen(false);
  };
  const selectConversation = (id: string): void => {
    const msgs = convos.select(id);
    setMessages(msgs);
    idRef.current = maxId(msgs);
    setDrawerOpen(false);
  };
  // Deleting the ACTIVE chat must also clear the live message buffer, or
  // syncActive would immediately re-create it from the still-present messages.
  const removeConversation = (id: string): void => {
    const wasActive = id === convos.activeId;
    convos.remove(id);
    if (wasActive) {
      setMessages([]);
      idRef.current = 0;
    }
  };

  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    const load = () => {
      fetch(`${base}/weather`).then((r) => r.json()).then(setWeather).catch(() => {});
      fetch(`${base}/calendar`)
        .then((r) => r.json())
        .then((d: { events?: CalEvent[] }) => setEvents(d.events ?? []))
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, []);

  // Focus the composer's textarea. Composer listens for this custom event.
  const focusComposer = (prefill?: string): void => {
    window.dispatchEvent(new CustomEvent("scout:composer-focus", { detail: { prefill } }));
  };
  // Open a new blank conversation (same behavior as sidebar "New").
  const openNewConversation = (): void => {
    newConversation();
  };

  // Global keyboard shortcuts + tile-event listeners. One source of truth so
  // clicking a home tile and pressing its shortcut do exactly the same thing.
  useEffect(() => {
    const isTypingInTextField = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      // Only handle Cmd (mac) / Ctrl (other). Never hijack the OS.
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const key = e.key.toLowerCase();
      const shift = e.shiftKey;

      // ⌘,  → open Settings (macOS convention)
      if (key === "," && !shift) {
        e.preventDefault();
        openSettings();
        return;
      }
      // ⌘/  → focus composer to ask anything (works even while typing elsewhere)
      if (key === "/" && !shift) {
        e.preventDefault();
        focusComposer();
        return;
      }
      // ⌘K  → search (focus composer, hint to enable web)
      if (key === "k" && !shift) {
        e.preventDefault();
        focusComposer();
        window.dispatchEvent(new CustomEvent("scout:enable-web"));
        return;
      }
      // Cmd+Shift shortcuts — avoid clobbering browser defaults for typing
      if (shift) {
        if (key === "f") { e.preventDefault(); setViewerPath(process.env.NEXT_PUBLIC_HOME_DIR ?? "/Users/apple"); return; }
        if (key === "c") { e.preventDefault(); window.location.href = "/code"; return; }
        if (key === "e") { e.preventDefault(); focusComposer("What's on my screen?"); return; }
        if (key === "a") { e.preventDefault(); setAutonomyOpen(true); return; }
      }
    };

    // Tile clicks fire custom events (see Conversation.tsx WorkspaceHome).
    const onFocusComposer = (): void => focusComposer();
    const onSearch = (): void => { focusComposer(); window.dispatchEvent(new CustomEvent("scout:enable-web")); };
    const onOpenFile = (): void => setViewerPath(process.env.NEXT_PUBLIC_HOME_DIR ?? "/Users/apple");
    const onOpenCode = (): void => { window.location.href = "/code"; };
    const onSeeScreen = (): void => focusComposer("What's on my screen?");
    const onOpenAutonomy = (): void => setAutonomyOpen(true);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scout:focus-composer", onFocusComposer as EventListener);
    window.addEventListener("scout:search", onSearch as EventListener);
    window.addEventListener("scout:open-file", onOpenFile as EventListener);
    window.addEventListener("scout:open-code", onOpenCode as EventListener);
    window.addEventListener("scout:see-screen", onSeeScreen as EventListener);
    window.addEventListener("scout:open-autonomy", onOpenAutonomy as EventListener);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scout:focus-composer", onFocusComposer as EventListener);
      window.removeEventListener("scout:search", onSearch as EventListener);
      window.removeEventListener("scout:open-file", onOpenFile as EventListener);
      window.removeEventListener("scout:open-code", onOpenCode as EventListener);
      window.removeEventListener("scout:see-screen", onSeeScreen as EventListener);
      window.removeEventListener("scout:open-autonomy", onOpenAutonomy as EventListener);
    };
    // openNewConversation is stable via convos.newConversation reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text → image generation (spec §47). Renders the result in the conversation.
  const generateImage = (prompt: string): void => {
    const base = backendBase();
    if (!base) return;
    const userId = ++idRef.current;
    const jarvisId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: prompt, streaming: false },
      { id: jarvisId, role: "jarvis", text: "Creating your image… (the model can be slow to warm up)", streaming: true },
    ]);
    fetch(`${base}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; image?: string; error?: string }) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === jarvisId
              ? d.ok && d.image
                ? { ...m, text: "", images: [d.image], generated: true, streaming: false }
                : { ...m, text: `Couldn't create that image. ${d.error ?? ""}`, streaming: false }
              : m,
          ),
        ),
      )
      .catch(() =>
        setMessages((prev) =>
          prev.map((m) => (m.id === jarvisId ? { ...m, text: "Image generation failed, sir.", streaming: false } : m)),
        ),
      );
  };

  // Send one or more image attachments (already decoded to data-URLs for the
  // preview) to a vision model in a single message (spec §7/§8/§15).
  const sendAttachments = (files: File[], previews: string[], prompt: string): void => {
    const base = backendBase();
    if (!base || files.length === 0) return;
    const userId = ++idRef.current;
    const jarvisId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: prompt, streaming: false, images: previews },
      { id: jarvisId, role: "jarvis", text: "", streaming: true },
    ]);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (prompt) form.append("prompt", prompt);
    fetch(`${base}/vision-chat`, { method: "POST", body: form })
      .then((r) => r.json())
      .then((d: { reply?: string }) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === jarvisId ? { ...m, text: d.reply ?? "(no response)", streaming: false } : m)),
        ),
      )
      .catch(() =>
        setMessages((prev) =>
          prev.map((m) => (m.id === jarvisId ? { ...m, text: "Vision request failed, sir.", streaming: false } : m)),
        ),
      );
  };

  return (
    <div className={`shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      {sidebarOpen ? (
        <>
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
          <aside className="sidebar-wrap">
            <Sidebar
              conversations={convos.conversations}
              activeId={convos.activeId}
              backend={convos.backend}
              onNew={newConversation}
              onSelect={selectConversation}
              onRename={convos.rename}
              onTogglePin={convos.togglePin}
              onArchive={convos.archive}
              onRemove={removeConversation}
              onOpenSettings={() => openSettings()}
              onOpenAutonomy={() => setAutonomyOpen(true)}
              onOpenFiles={() => setViewerPath(process.env.NEXT_PUBLIC_HOME_DIR ?? "/Users/apple")}
              onOpenCode={() => { window.location.href = "/code"; }}
              autonomyBadge={autonomyInboxBadge}
            />
          </aside>
        </>
      ) : null}

      <main className="app">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="iconbtn"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide conversations" : "Show conversations"}
              style={{ minWidth: 0, padding: "0 9px" }}
            >
              <IconPanelLeft />
            </button>
            <span className="status-pill" data-active={connected ? "true" : "false"}>
              <span className="status-dot" aria-hidden />
              <span>{connected ? "Online" : "Connecting"}</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="mono" style={{ fontSize: 12.5, color: colors.inkSoft }}>
              {clock}
            </span>
            <ThemeToggle />
            <Link href="/code" className="iconbtn" data-tone="copper" title="Code mode">
              <IconCode />
              <span>Code</span>
            </Link>
            <Link href="/forge" className="iconbtn" data-tone="amber" title="Arc Forge — AR gauntlet">
              <IconBolt />
              <span>Forge</span>
            </Link>
            <button
              className="iconbtn"
              data-tone="sage"
              onClick={() => setViewerPath(process.env.NEXT_PUBLIC_HOME_DIR ?? "/Users/apple")}
              title="Universal file viewer"
            >
              <IconFolder />
              <span>Files</span>
            </button>
            <button
              className="iconbtn"
              data-tone="plum"
              onClick={() => setAutonomyOpen(true)}
              title="Autonomy — daemons + approval inbox"
            >
              <IconSparkles />
              <span>Auto</span>
            </button>
            <button
              className="iconbtn"
              data-tone="plum"
              onClick={() => openSettings("memory")}
              title="Memory — what Scout remembers about you"
            >
              <IconSparkles />
              <span>Memory</span>
            </button>
            <button className="iconbtn" onClick={() => setDrawerOpen(true)} title="Command Center">
              <IconSliders />
              <span>System</span>
            </button>
          </div>
        </header>

        <Conversation
          messages={messages}
          userName={userName}
          onConfirm={confirmAction}
          onRegenerate={(text) => sendMessage(text)}
        />

        <Composer
          connected={connected}
          generating={generating}
          onStop={stop}
          models={models.models}
          active={models.active}
          onSelectModel={models.select}
          onSend={sendMessage}
          onSendAttachments={sendAttachments}
          onGenerateImage={generateImage}
          liveActive={talk.active}
          liveStatus={talk.state}
          onToggleLive={talk.toggle}
          liveLevelRef={talk.levelRef}
        />

        <StatusBar
          activity={talk.state === "idle" && generating ? "thinking" : talk.state}
          modelLabel={models.active?.label}
          connected={connected}
        />
      </main>

      {drawerOpen ? (
        <CommandCenter
          live={live}
          weather={weather}
          events={events}
          connected={connected}
          modelLabel={models.active?.label ?? "—"}
          voiceReady={talk.state !== "idle" || connected}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <Settings
          onClose={() => setSettingsOpen(false)}
          modelLabel={models.active?.label ?? "—"}
          backend={convos.backend}
          initialSection={settingsSection}
        />
      ) : null}

      {autonomyOpen ? <Autonomy onClose={() => setAutonomyOpen(false)} /> : null}

      {viewerPath ? <FileViewer path={viewerPath} onClose={() => setViewerPath(null)} /> : null}
    </div>
  );
}

function useClock(): string {
  const [now, setNow] = useState<string>("--:--");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
