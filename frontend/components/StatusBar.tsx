"use client";

import { useEffect, useState } from "react";

type ActivityState = "idle" | "listening" | "thinking" | "speaking";

/**
 * Scout StatusBar — the thin persistent strip at the bottom of the app.
 *
 * Left rail: breathing mini-orb + active model. Right rail: how many daemons
 * are running · pending items in the approval inbox · sync state · clock.
 *
 * This is a personality anchor: the app always feels alive because the orb is
 * always visible, and it grounds the layout so the frame doesn't feel empty.
 */

interface Health {
  status?: string;
  model?: string;
  provider?: string;
}

interface Daemon {
  name: string;
  enabled: boolean;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

export default function StatusBar({
  activity = "idle",
  modelLabel,
  connected,
}: {
  activity?: ActivityState;
  modelLabel?: string;
  connected?: boolean;
}): JSX.Element {
  const [daemonCount, setDaemonCount] = useState<number>(0);
  const [inboxCount, setInboxCount] = useState<number>(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    const load = (): void => {
      fetch(`${base}/health`).then((r) => r.json()).then(setHealth).catch(() => {});
      fetch(`${base}/autonomy/daemons`)
        .then((r) => r.json())
        .then((d: { daemons?: Daemon[] }) =>
          setDaemonCount((d.daemons ?? []).filter((x) => x.enabled).length))
        .catch(() => {});
      fetch(`${base}/autonomy/proposals`)
        .then((r) => r.json())
        .then((d: { proposals?: unknown[] }) => setInboxCount((d.proposals ?? []).length))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const tick = (): void =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const shownModel = modelLabel ?? health?.model ?? "—";
  const online = connected ?? (health?.status === "ok");

  const activityLabel: Record<ActivityState, string> = {
    idle: "",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
  };
  const active = activity !== "idle";

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className={`sb-activity ${active ? "on" : ""}`}>
          <span className="sb-activity-bar" />
          <span className="sb-activity-bar" />
          <span className="sb-activity-bar" />
        </span>
        {active && <span className="sb-activity-label">{activityLabel[activity]}</span>}
        <span className="sb-model" title={shownModel}>{shownModel}</span>
      </div>

      <div className="statusbar-right">
        <StatusChip
          label={inboxCount > 0 ? `${inboxCount} to approve` : "inbox clear"}
          tone={inboxCount > 0 ? "brass" : "faint"}
        />
        <StatusChip
          label={`${daemonCount} daemon${daemonCount === 1 ? "" : "s"}`}
          tone="faint"
        />
        <StatusChip label={online ? "synced" : "offline"} tone={online ? "teal" : "faint"} dot />
        <span className="sb-clock mono">{clock}</span>
      </div>
    </div>
  );
}

function StatusChip({
  label, tone = "faint", dot = false,
}: { label: string; tone?: "brass" | "teal" | "faint"; dot?: boolean }): JSX.Element {
  return (
    <span className={`sb-chip sb-chip-${tone}`}>
      {dot && <span className="sb-dot" />}
      {label}
    </span>
  );
}
