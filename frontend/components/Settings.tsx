"use client";

import { useEffect, useRef, useState } from "react";
import { brand } from "@/lib/brand";
import { colors } from "@/lib/tokens";
import { IconClose } from "@/components/icons";

// Settings (spec §38/§39). Voice is the centrepiece: browse the ACTUAL provider
// voices, audition them, and pick a default. Only real voices are shown; a
// provider failure degrades to a clear message, never a crash (spec §16/§48).

interface Voice {
  id: string;
  name: string;
  description: string;
  accent: string;
  gender: string;
  language: string;
  provider: string;
}

const PREVIEW_TEXT = "Hello. I'm Scout. How can I help you today?";

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

type Section = "voice" | "connectors" | "mcp" | "routines" | "memory" | "about";

interface McpServer { name: string; url?: string; command?: string; enabled?: boolean; tools?: string[] }

interface Routine {
  id: string;
  title: string;
  schedule: string;
  enabled: boolean;
  next_run: string | null;
  last_result: string | null;
}

interface Memory {
  id: string;
  category: string;
  key: string;
  value: string;
}
interface Connector {
  id: string;
  name: string;
  provider: string;
  connected: boolean;
  detail: string;
}
interface Reminder {
  id: string;
  text: string;
  due: string | null;
}

export default function Settings({
  onClose,
  modelLabel,
  backend,
  initialSection,
}: {
  onClose: () => void;
  modelLabel: string;
  backend: "supabase" | "local";
  initialSection?: Section;
}): JSX.Element {
  const [section, setSection] = useState<Section>(initialSection ?? "voice");

  // Add-memory form state (Settings → Memory)
  const [newMemCategory, setNewMemCategory] = useState<string>("preferences");
  const [newMemKey, setNewMemKey] = useState<string>("");
  const [newMemValue, setNewMemValue] = useState<string>("");
  const [newMemSaving, setNewMemSaving] = useState<boolean>(false);
  const [newMemError, setNewMemError] = useState<string>("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [defaultVoice, setDefaultVoice] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [previewing, setPreviewing] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [memLoading, setMemLoading] = useState(false);

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [connBusy, setConnBusy] = useState<string>("");
  const [remDraft, setRemDraft] = useState<string>("");

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [rtPrompt, setRtPrompt] = useState<string>("");
  const [rtSchedule, setRtSchedule] = useState<string>("");

  const loadRoutines = (): void => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/routines`)
      .then((r) => r.json())
      .then((d: { routines?: Routine[] }) => setRoutines(d.routines ?? []))
      .catch(() => {});
  };
  const addRoutine = (): void => {
    const base = backendBase();
    if (!base || !rtPrompt.trim() || !rtSchedule.trim()) return;
    fetch(`${base}/routines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: rtPrompt.trim(), schedule: rtSchedule.trim() }),
    })
      .then(() => {
        setRtPrompt("");
        setRtSchedule("");
        loadRoutines();
      })
      .catch(() => {});
  };
  const delRoutine = (id: string): void => {
    const base = backendBase();
    if (!base) return;
    setRoutines((prev) => prev.filter((r) => r.id !== id));
    fetch(`${base}/routines/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const loadConnectors = (): void => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/connectors`)
      .then((r) => r.json())
      .then((d: { connectors?: Connector[] }) => setConnectors(d.connectors ?? []))
      .catch(() => {});
    fetch(`${base}/reminders`)
      .then((r) => r.json())
      .then((d: { reminders?: Reminder[] }) => setReminders(d.reminders ?? []))
      .catch(() => {});
  };

  const connectGoogle = async (): Promise<void> => {
    const base = backendBase();
    if (!base) return;
    setConnBusy("google");
    try {
      await fetch(`${base}/connectors/google/connect`, { method: "POST" });
    } catch {
      /* ignore */
    }
    setConnBusy("");
    loadConnectors();
  };

  const disconnectGoogle = async (): Promise<void> => {
    const base = backendBase();
    if (!base) return;
    if (!window.confirm("Disconnect your Google account (Gmail + Calendar)?")) return;
    await fetch(`${base}/connectors/google/disconnect`, { method: "POST" }).catch(() => {});
    loadConnectors();
  };

  const addReminder = (): void => {
    const base = backendBase();
    const text = remDraft.trim();
    if (!base || !text) return;
    setRemDraft("");
    fetch(`${base}/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(() => loadConnectors())
      .catch(() => {});
  };

  const delReminder = (id: string): void => {
    const base = backendBase();
    if (!base) return;
    setReminders((prev) => prev.filter((r) => r.id !== id));
    fetch(`${base}/reminders/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const loadMemories = (): void => {
    const base = backendBase();
    if (!base) return;
    setMemLoading(true);
    fetch(`${base}/memory`)
      .then((r) => r.json())
      .then((d: { memories?: Memory[] }) => setMemories(d.memories ?? []))
      .catch(() => {})
      .finally(() => setMemLoading(false));
  };

  useEffect(() => {
    if (section === "memory") loadMemories();
    if (section === "connectors") loadConnectors();
    if (section === "routines") loadRoutines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const editMemory = (m: Memory): void => {
    const base = backendBase();
    if (!base) return;
    const next = window.prompt(`Edit "${m.key.replace(/_/g, " ")}"`, m.value);
    if (next == null || !next.trim()) return;
    setMemories((prev) => prev.map((x) => (x.id === m.id ? { ...x, value: next.trim() } : x)));
    fetch(`${base}/memory/${m.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next.trim() }),
    }).catch(() => {});
  };

  const deleteMemory = (m: Memory): void => {
    const base = backendBase();
    if (!base) return;
    if (!window.confirm(`Forget "${m.key.replace(/_/g, " ")}"?`)) return;
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    fetch(`${base}/memory/${m.id}`, { method: "DELETE" }).catch(() => {});
  };

  const saveNewMemory = async (): Promise<void> => {
    const base = backendBase();
    const key = newMemKey.trim();
    const value = newMemValue.trim();
    if (!base) { setNewMemError("Backend not reachable."); return; }
    if (!key || !value) { setNewMemError("Both key and value are needed."); return; }
    setNewMemSaving(true);
    setNewMemError("");
    try {
      const r = await fetch(`${base}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newMemCategory, key: key.toLowerCase().replace(/\s+/g, "_"), value }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setNewMemKey("");
      setNewMemValue("");
      // reload memories list
      fetch(`${base}/memory`)
        .then((rr) => rr.json())
        .then((d: { memories?: Memory[] }) => setMemories(d.memories ?? []))
        .catch(() => {});
    } catch (exc) {
      setNewMemError(`Couldn't save: ${(exc as Error).message}`);
    } finally {
      setNewMemSaving(false);
    }
  };

  useEffect(() => {
    const base = backendBase();
    if (!base) {
      setError("Backend not reachable.");
      setLoading(false);
      return;
    }
    fetch(`${base}/voices`)
      .then((r) => r.json())
      .then((d: { voices?: Voice[]; default?: string }) => {
        setVoices(d.voices ?? []);
        setDefaultVoice(d.default ?? "");
      })
      .catch(() => setError("Couldn't load voices."))
      .finally(() => setLoading(false));
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const preview = async (voice: string): Promise<void> => {
    const base = backendBase();
    if (!base) return;
    audioRef.current?.pause();
    setPreviewing(voice);

    // Stream chunks so the first sentence plays in ~2s instead of waiting for
    // the whole reply. Chunks are decoded into blob URLs and played in order.
    const queue: string[] = [];
    let done = false;
    let currentEl: HTMLAudioElement | null = null;
    let cancelled = false;

    const b64ToBlobUrl = (b64: string): string => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([arr], { type: "audio/wav" }));
    };

    const playNext = (): void => {
      if (cancelled) return;
      if (queue.length === 0) {
        if (done) { setPreviewing((p) => (p === voice ? "" : p)); return; }
        setTimeout(playNext, 30);
        return;
      }
      const url = queue.shift()!;
      const el = new Audio(url);
      currentEl = el;
      audioRef.current = el;
      el.onended = () => { try { URL.revokeObjectURL(url); } catch {} playNext(); };
      el.onerror = () => { try { URL.revokeObjectURL(url); } catch {} playNext(); };
      void el.play().catch(() => playNext());
    };

    try {
      const res = await fetch(`${base}/speak_stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ text: PREVIEW_TEXT, voice }),
      });
      if (!res.ok || !res.body) { setPreviewing(""); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      playNext(); // start the play loop; it'll wait for the first chunk
      while (true) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const obj = JSON.parse(raw);
              if (obj.done || obj.error) { done = true; continue; }
              if (obj.audio_b64) queue.push(b64ToBlobUrl(obj.audio_b64));
            } catch { /* ignore */ }
          }
        }
      }
      done = true;
    } catch {
      cancelled = true;
      (currentEl as HTMLAudioElement | null)?.pause();
      setPreviewing("");
    }
  };

  const select = (voice: string): void => {
    const base = backendBase();
    if (!base) return;
    setDefaultVoice(voice);
    fetch(`${base}/settings/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    }).catch(() => {});
  };

  return (
    <>
      <div className="settings-scrim" onClick={onClose} />
      <div className="settings" role="dialog" aria-label="Settings">
        <nav className="settings-nav">
          <div className="settings-nav-head">
            <span className="wordmark" style={{ fontSize: 13 }}>
              {brand.name}
            </span>
            <button className="iconbtn" onClick={onClose} style={{ minWidth: 0, padding: "0 8px", height: 28 }}>
              <IconClose />
            </button>
          </div>
          <button className={`settings-nav-item ${section === "voice" ? "active" : ""}`} onClick={() => setSection("voice")}>
            Voice
          </button>
          <button className={`settings-nav-item ${section === "connectors" ? "active" : ""}`} onClick={() => setSection("connectors")}>
            Connectors
          </button>
          <button className={`settings-nav-item ${section === "mcp" ? "active" : ""}`} onClick={() => setSection("mcp")}>
            MCP Servers
          </button>
          <button className={`settings-nav-item ${section === "routines" ? "active" : ""}`} onClick={() => setSection("routines")}>
            Routines
          </button>
          <button className={`settings-nav-item ${section === "memory" ? "active" : ""}`} onClick={() => setSection("memory")}>
            Memory
          </button>
          <button className={`settings-nav-item ${section === "about" ? "active" : ""}`} onClick={() => setSection("about")}>
            About
          </button>
        </nav>

        <div className="settings-body jv-scroll">
          {section === "voice" ? (
            <div>
              <h2 className="settings-title">Voice</h2>
              <p className="settings-sub">
                Choose the voice {brand.name} uses to speak. Filter by personality, preview any voice, then set your default.
              </p>
              <VoiceControls />
              {loading ? (
                <p className="settings-note">Loading voices…</p>
              ) : error ? (
                <p className="settings-note">{error}</p>
              ) : voices.length === 0 ? (
                <p className="settings-note">No voices available from the configured provider.</p>
              ) : (
                <div className="voice-grid">
                  {voices.map((v) => {
                    const isDefault = v.id === defaultVoice;
                    const tag = voiceCategory(v);
                    return (
                      <div key={v.id} className={`voice-card ${isDefault ? "selected" : ""}`}>
                        <div className="voice-card-top">
                          <div>
                            <div className="voice-name">
                              {v.name}
                              <span className={`voice-tag voice-tag-${tag.toLowerCase()}`}>{tag}</span>
                            </div>
                            <div className="voice-desc">{v.description}</div>
                          </div>
                          {isDefault ? <span className="voice-badge">Default</span> : null}
                        </div>
                        <div className="voice-meta mono">
                          {v.accent} · {v.gender}
                        </div>
                        <div className="voice-actions">
                          <button className="ghost" onClick={() => preview(v.id)}>
                            {previewing === v.id ? "Playing…" : "Preview"}
                          </button>
                          <button
                            className="voice-select"
                            onClick={() => select(v.id)}
                            disabled={isDefault}
                          >
                            {isDefault ? "Selected" : "Use this voice"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : section === "connectors" ? (
            <div>
              <h2 className="settings-title">Connectors</h2>
              <p className="settings-sub">
                Connect your accounts so {brand.name} can use them from chat and Code mode. Reading is
                automatic; sending an email always asks first.
              </p>
              <div className="conn-list">
                {connectors.map((c) => (
                  <div key={c.id} className="conn-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="conn-name">{c.name}</div>
                      <div className="conn-detail">{c.detail}</div>
                    </div>
                    {c.provider === "google" ? (
                      c.connected ? (
                        <button className="ghost" onClick={disconnectGoogle}>
                          Disconnect
                        </button>
                      ) : (
                        <button className="voice-select" onClick={connectGoogle} disabled={connBusy === "google"}>
                          {connBusy === "google" ? "Opening browser…" : "Connect"}
                        </button>
                      )
                    ) : (
                      <span className="conn-badge">Built-in</span>
                    )}
                  </div>
                ))}
              </div>

              <h3 className="settings-subhead">Reminders</h3>
              <div className="rem-add">
                <input
                  value={remDraft}
                  onChange={(e) => setRemDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addReminder()}
                  placeholder="Add a reminder…"
                  spellCheck={false}
                />
                <button className="voice-select" onClick={addReminder} disabled={!remDraft.trim()}>
                  Add
                </button>
              </div>
              {reminders.length === 0 ? (
                <p className="settings-note">No reminders yet. Ask {brand.name} “remind me to…”, or add one above.</p>
              ) : (
                <div className="rem-list">
                  {reminders.map((r) => (
                    <div key={r.id} className="rem-row">
                      <span className="rem-text">
                        {r.text}
                        {r.due ? ` · ${r.due}` : ""}
                      </span>
                      <button className="msg-action" onClick={() => delReminder(r.id)} style={{ color: "var(--red)" }}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {connectors.some((c) => c.provider === "google" && !c.connected) ? (
                <p className="settings-note" style={{ marginTop: 16 }}>
                  Google opens a one-time consent in your browser (on this Mac). If “Connect” errors, a valid{" "}
                  <span className="mono">config/google_credentials.json</span> from Google Cloud is needed.
                </p>
              ) : null}
            </div>
          ) : section === "mcp" ? (
            <McpSection />
          ) : section === "routines" ? (
            <div>
              <h2 className="settings-title">Routines</h2>
              <p className="settings-sub">
                Recurring tasks {brand.name} runs on its own and notifies you about (needs the menu-bar app running
                for notifications). Try “Summarise my calendar and unread email” every morning.
              </p>
              <div className="rt-add">
                <input
                  value={rtPrompt}
                  onChange={(e) => setRtPrompt(e.target.value)}
                  placeholder="What should Scout do?  e.g. Summarise my calendar"
                />
                <input
                  className="rt-when"
                  value={rtSchedule}
                  onChange={(e) => setRtSchedule(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRoutine()}
                  placeholder="When?  e.g. every morning"
                />
                <button className="voice-select" onClick={addRoutine} disabled={!rtPrompt.trim() || !rtSchedule.trim()}>
                  Add
                </button>
              </div>
              {routines.length === 0 ? (
                <p className="settings-note">No routines yet. Add one above, or just ask {brand.name} in chat.</p>
              ) : (
                <div className="rt-list">
                  {routines.map((r) => (
                    <div key={r.id} className="rt-row">
                      <div style={{ minWidth: 0 }}>
                        <div className="rt-title">{r.title}</div>
                        <div className="rt-meta">
                          {r.schedule}
                          {r.next_run
                            ? ` · next ${new Date(r.next_run).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </div>
                        {r.last_result ? <div className="rt-result">{r.last_result}</div> : null}
                      </div>
                      <button className="msg-action" onClick={() => delRoutine(r.id)} style={{ color: "var(--red)" }}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : section === "memory" ? (
            <div>
              <h2 className="settings-title">Memory</h2>
              <p className="settings-sub">
                What {brand.name} remembers about you. Add things here yourself, or just tell {brand.name} in chat.
                Deleting a memory doesn&apos;t delete your conversations.
              </p>

              {/* Add-memory form — quick self-service so you don't need chat to seed context. */}
              <div className="mem-add">
                <div className="mem-add-row">
                  <select
                    className="mem-add-input mem-add-cat"
                    value={newMemCategory}
                    onChange={(e) => setNewMemCategory(e.target.value)}
                  >
                    <option value="preferences">preferences</option>
                    <option value="personal">personal</option>
                    <option value="work">work</option>
                    <option value="projects">projects</option>
                    <option value="people">people</option>
                    <option value="other">other</option>
                  </select>
                  <input
                    className="mem-add-input"
                    placeholder="What is this? (e.g. preferred editor)"
                    value={newMemKey}
                    onChange={(e) => setNewMemKey(e.target.value)}
                  />
                </div>
                <div className="mem-add-row">
                  <input
                    className="mem-add-input"
                    placeholder="The value to remember (e.g. VS Code)"
                    value={newMemValue}
                    onChange={(e) => setNewMemValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !newMemSaving) saveNewMemory(); }}
                  />
                  <button
                    className="mem-add-btn"
                    onClick={saveNewMemory}
                    disabled={newMemSaving || !newMemKey.trim() || !newMemValue.trim()}
                  >
                    {newMemSaving ? "Saving…" : "＋ Add"}
                  </button>
                </div>
                {newMemError && <div className="mem-add-error">{newMemError}</div>}
              </div>

              {memLoading ? (
                <p className="settings-note">Loading…</p>
              ) : memories.length === 0 ? (
                <p className="settings-note">
                  Nothing yet. Add one above, or just tell {brand.name} in chat — “remember that my preferred editor is VS Code.”
                </p>
              ) : (
                <div className="mem-list">
                  {memories.map((m) => (
                    <div key={m.id} className="mem-row">
                      <div style={{ minWidth: 0 }}>
                        <div className="mem-key">{m.key.replace(/_/g, " ")}</div>
                        <div className="mem-val">{m.value}</div>
                      </div>
                      <div className="mem-actions">
                        <span className="mem-cat">{m.category}</span>
                        <button className="msg-action" onClick={() => editMemory(m)}>
                          Edit
                        </button>
                        <button className="msg-action" onClick={() => deleteMemory(m)} style={{ color: "var(--red)" }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 className="settings-title">About</h2>
              <div className="about-row">
                <span>Product</span>
                <b>
                  {brand.name} — {brand.subtitle}
                </b>
              </div>
              <div className="about-row">
                <span>Active model</span>
                <b>{modelLabel}</b>
              </div>
              <div className="about-row">
                <span>History</span>
                <b>{backend === "supabase" ? "Synced (Supabase)" : "Local (this device)"}</b>
              </div>
              <p className="settings-sub" style={{ marginTop: 16 }}>
                {brand.name} runs on your selected model with web, vision, documents, voice, memory and
                system tools behind one assistant.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Voice controls — speech rate, volume, auto-speak preference.
 *  Persisted in localStorage; other parts of the app read via the same key. */
function VoiceControls(): JSX.Element {
  const [rate, setRate] = useState<number>(() => Number(localStorage.getItem("scout-voice-rate") ?? "1"));
  const [volume, setVolume] = useState<number>(() => Number(localStorage.getItem("scout-voice-volume") ?? "1"));
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => localStorage.getItem("scout-voice-autospeak") === "1");

  useEffect(() => { localStorage.setItem("scout-voice-rate", String(rate)); }, [rate]);
  useEffect(() => { localStorage.setItem("scout-voice-volume", String(volume)); }, [volume]);
  useEffect(() => { localStorage.setItem("scout-voice-autospeak", autoSpeak ? "1" : "0"); }, [autoSpeak]);

  return (
    <div className="voice-controls">
      <label className="voice-ctrl">
        <span className="voice-ctrl-k">Speed</span>
        <input type="range" min="0.5" max="1.8" step="0.05" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} />
        <span className="voice-ctrl-v mono">{rate.toFixed(2)}×</span>
      </label>
      <label className="voice-ctrl">
        <span className="voice-ctrl-k">Volume</span>
        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
        <span className="voice-ctrl-v mono">{Math.round(volume * 100)}%</span>
      </label>
      <label className="voice-ctrl">
        <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} />
        <span className="voice-ctrl-k">Speak responses automatically</span>
      </label>
    </div>
  );
}

/** Derive a personality tag from provider metadata. Cheap heuristic — swap for
 *  server-provided categories once the voice-provider layer exposes them. */
function voiceCategory(v: Voice): "Calm" | "Warm" | "Deep" | "Bright" | "Natural" {
  const s = `${v.name} ${v.description}`.toLowerCase();
  if (/deep|baritone|steady|serious|grave/.test(s)) return "Deep";
  if (/warm|friendly|approachable|kind/.test(s)) return "Warm";
  if (/bright|light|youthful|energetic/.test(s)) return "Bright";
  if (/calm|soft|gentle|smooth/.test(s)) return "Calm";
  return "Natural";
}

/** MCP servers section — architecture-ready.
 *  Reads /mcp/servers; when the config file doesn't exist, shows a clear
 *  onboarding state with the exact JSON to create. Live client integration
 *  lands in a follow-up pass. */
function McpSection(): JSX.Element {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [configPath, setConfigPath] = useState<string>("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/mcp/servers`)
      .then((r) => r.json())
      .then((d: { servers?: McpServer[]; config_path?: string; configured?: boolean }) => {
        setServers(d.servers ?? []);
        setConfigPath(d.config_path ?? "");
        setConfigured(!!d.configured);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="settings-title">MCP Servers</h2>
      <p className="settings-sub">
        Model Context Protocol servers extend {brand.name} with external tools — filesystems, browsers,
        databases, APIs. Configure them in a small JSON file and Scout will discover their tools at startup.
      </p>

      {loading ? (
        <p className="settings-note">Reading configuration…</p>
      ) : servers.length === 0 ? (
        <div className="mcp-empty">
          <div className="mcp-empty-title">No servers configured</div>
          <div className="mcp-empty-body">
            Create <span className="mono">{configPath}</span> with the following shape:
          </div>
          <pre className="mcp-example">{`{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx @modelcontextprotocol/server-filesystem /Users/apple/Documents",
      "enabled": true
    }
  ]
}`}</pre>
          <div className="mcp-empty-body">
            Scout re-reads this file on startup. Live discovery + reconnect are handled by a follow-up
            pass — the endpoint is ready and the UI will populate once servers are declared.
          </div>
        </div>
      ) : (
        <div className="mcp-list">
          {servers.map((s) => (
            <div key={s.name} className={`mcp-row ${s.enabled === false ? "off" : ""}`}>
              <div className="mcp-row-main">
                <div className="mcp-row-name">
                  {s.name}
                  <span className="mcp-row-badge">{s.enabled === false ? "Disabled" : "Enabled"}</span>
                </div>
                <div className="mcp-row-cmd mono">{s.command || s.url || "—"}</div>
                {s.tools && s.tools.length > 0 && (
                  <div className="mcp-row-tools">
                    {s.tools.length} tool{s.tools.length === 1 ? "" : "s"}: {s.tools.slice(0, 4).join(", ")}
                    {s.tools.length > 4 ? "…" : ""}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
