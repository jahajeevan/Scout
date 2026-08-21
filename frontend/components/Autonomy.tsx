"use client";

import { useEffect, useState } from "react";
import { IconClose } from "@/components/icons";

/**
 * Autonomy — Scout's gen-2 background brain.
 *
 * Two views: an inbox of proposals awaiting approval, and the daemon roster
 * with schedules + enable toggles. Styled entirely with Scout tokens (see
 * globals.css .auto-*) so it inherits Nightfall.
 */

interface Daemon {
  name: string;
  description: string;
  schedule: { kind: string; hh?: number; mm?: number; day?: number; minutes?: number };
  permission: "safe" | "propose";
  category: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
}

interface Proposal {
  id: string;
  daemon: string;
  title: string;
  body: string;
  actions: { tool: string; args: Record<string, unknown> }[];
  status: string;
  created_at: string;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

function scheduleLabel(s: Daemon["schedule"]): string {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hh = (s.hh ?? 9).toString().padStart(2, "0");
  const mm = (s.mm ?? 0).toString().padStart(2, "0");
  if (s.kind === "interval") return `every ${s.minutes ?? 60} min`;
  if (s.kind === "weekly") return `${days[s.day ?? 0]} · ${hh}:${mm}`;
  if (s.kind === "daily") return `daily · ${hh}:${mm}`;
  return s.kind;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = Date.now();
  const diff = (d.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return diff > 0 ? "in <1 min" : "just now";
  if (abs < 3600) return `${diff > 0 ? "in " : ""}${Math.round(abs / 60)} min${diff > 0 ? "" : " ago"}`;
  if (abs < 86400) return `${diff > 0 ? "in " : ""}${Math.round(abs / 3600)} h${diff > 0 ? "" : " ago"}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

type AutonomyMode = "plan" | "auto" | "bypass";

export default function Autonomy({ onClose }: { onClose: () => void }): JSX.Element {
  const [daemons, setDaemons] = useState<Daemon[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [tab, setTab] = useState<"inbox" | "daemons">("inbox");
  const [expanded, setExpanded] = useState<string>("");
  const [mode, setMode] = useState<AutonomyMode>("plan");

  const load = (): void => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/autonomy/daemons`)
      .then((r) => r.json())
      .then((d: { daemons?: Daemon[] }) => setDaemons(d.daemons ?? []))
      .catch(() => {});
    fetch(`${base}/autonomy/proposals`)
      .then((r) => r.json())
      .then((d: { proposals?: Proposal[] }) => setProposals(d.proposals ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const base = backendBase();
    if (base) {
      fetch(`${base}/autonomy/mode`).then((r) => r.json()).then((d: { mode?: AutonomyMode }) => {
        if (d.mode) setMode(d.mode);
      }).catch(() => {});
    }
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const setModeAndPersist = (m: AutonomyMode): void => {
    setMode(m);
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/autonomy/mode?mode=${m}`, { method: "POST" }).catch(() => {});
  };

  const post = async (url: string, key: string): Promise<void> => {
    const base = backendBase();
    if (!base) return;
    setBusy(key);
    await fetch(`${base}${url}`, { method: "POST" }).catch(() => {});
    setBusy("");
    load();
  };

  return (
    <div className="auto-scrim" onClick={onClose}>
      <div className="auto-modal" onClick={(e) => e.stopPropagation()}>
        <header className="auto-head">
          <div>
            <div className="auto-eyebrow">Autonomy</div>
            <div className="auto-title">Background intelligence</div>
            <div className="auto-sub">Scout&rsquo;s daemons + approval inbox</div>
          </div>
          <button className="auto-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>

        <div className="auto-mode">
          <div className="auto-mode-label">Execution mode</div>
          <div className="auto-mode-seg">
            {(["plan", "auto", "bypass"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModeAndPersist(m)}
                className={`auto-mode-opt auto-mode-${m} ${mode === m ? "active" : ""}`}
                title={
                  m === "plan"
                    ? "Scout describes what it would do; nothing runs without your approval."
                    : m === "auto"
                      ? "SAFE steps run automatically; PROPOSE steps still ask for approval."
                      : "PROPOSE steps also run automatically. Use with care."
                }
              >
                {m}
              </button>
            ))}
          </div>
          <div className="auto-mode-hint">
            {mode === "plan"    && "Scout describes its intended actions; nothing runs without your approval."}
            {mode === "auto"    && "SAFE daemons run automatically. PROPOSE steps still wait in the inbox."}
            {mode === "bypass"  && "PROPOSE steps also run automatically. Reserve for daemons you fully trust."}
          </div>
        </div>

        <nav className="auto-tabs">
          {(["inbox", "daemons"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`auto-tab ${tab === t ? "active" : ""}`}
            >
              {t === "inbox" ? "Inbox" : "Daemons"}
              <span className="auto-tab-count">{t === "inbox" ? proposals.length : daemons.length}</span>
            </button>
          ))}
        </nav>

        <div className="auto-body">
          {tab === "inbox" && (
            proposals.length === 0 ? (
              <div className="auto-empty">
                <div className="auto-empty-mark">◆</div>
                <div className="auto-empty-title">Nothing waiting for you</div>
                <div className="auto-empty-sub">Scout will drop proposals here when a daemon finds something worth approving.</div>
              </div>
            ) : (
              <div className="auto-list">
                {proposals.map((p) => {
                  const isOpen = expanded === p.id;
                  return (
                    <article key={p.id} className="auto-card">
                      <header className="auto-card-head">
                        <div className="auto-card-title">{p.title}</div>
                        <div className="auto-card-meta">
                          <span>from <b>{p.daemon}</b></span>
                          <span className="auto-dot">·</span>
                          <span>{formatWhen(p.created_at)}</span>
                          <span className="auto-dot">·</span>
                          <span>{p.actions.length} action{p.actions.length !== 1 ? "s" : ""}</span>
                        </div>
                      </header>
                      <div className="auto-card-actions">
                        <button
                          className="auto-btn auto-btn-primary"
                          onClick={() => post(`/autonomy/proposals/${p.id}/approve`, p.id)}
                          disabled={busy === p.id}
                        >Approve</button>
                        <button
                          className="auto-btn auto-btn-ghost"
                          onClick={() => post(`/autonomy/proposals/${p.id}/reject`, p.id)}
                          disabled={busy === p.id}
                        >Reject</button>
                        <button
                          className="auto-btn auto-btn-link"
                          onClick={() => setExpanded(isOpen ? "" : p.id)}
                        >{isOpen ? "Hide details" : "Show details"}</button>
                      </div>
                      {isOpen && <pre className="auto-card-body">{p.body || "(no body)"}</pre>}
                    </article>
                  );
                })}
              </div>
            )
          )}

          {tab === "daemons" && (
            <div className="auto-list">
              {daemons.map((d) => (
                <article key={d.name} className={`auto-card ${d.enabled ? "" : "off"}`}>
                  <header className="auto-card-head">
                    <div className="auto-card-title">
                      {d.name}
                      <span className={`auto-perm auto-perm-${d.permission}`}>{d.permission}</span>
                    </div>
                    <div className="auto-card-desc">{d.description}</div>
                    <div className="auto-card-meta">
                      <span>{scheduleLabel(d.schedule)}</span>
                      <span className="auto-dot">·</span>
                      <span>next {formatWhen(d.next_run)}</span>
                      <span className="auto-dot">·</span>
                      <span>last {formatWhen(d.last_run)}</span>
                    </div>
                  </header>
                  <div className="auto-card-actions">
                    <button
                      className="auto-btn auto-btn-ghost"
                      onClick={() => post(`/autonomy/daemons/${d.name}/run`, d.name)}
                      disabled={busy === d.name}
                    >Run now</button>
                    <button
                      className="auto-btn auto-btn-link"
                      onClick={() => post(`/autonomy/daemons/${d.name}/toggle?enabled=${!d.enabled}`, d.name)}
                    >{d.enabled ? "Disable" : "Enable"}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
