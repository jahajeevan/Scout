"use client";

import { useEffect, useState } from "react";
import { IconClose } from "@/components/icons";

/**
 * ContextPanel — the optional right rail that surfaces what Scout is currently
 * holding in the session: model, memories in play, uploaded docs, active tools,
 * and an approximate context-usage indicator.
 *
 * Toggled from the header. Reads from live backend endpoints; nothing here
 * writes state, so opening/closing is cheap.
 */

interface Health {
  model?: string;
  provider?: string;
}

interface Memory {
  id: string;
  category: string;
  key: string;
  value: string;
}

interface DocSummary {
  id: string;
  filename: string;
  pages?: number;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

export default function ContextPanel({
  onClose,
  messageCount = 0,
}: {
  onClose: () => void;
  messageCount?: number;
}): JSX.Element {
  const [health, setHealth] = useState<Health | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [tools, setTools] = useState<number>(0);
  const [daemons, setDaemons] = useState<number>(0);

  useEffect(() => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/health`).then((r) => r.json()).then(setHealth).catch(() => {});
    fetch(`${base}/memory/personal`)
      .then((r) => r.json())
      .then((d: { memories?: Memory[] }) => setMemories((d.memories ?? []).slice(0, 5)))
      .catch(() => {});
    fetch(`${base}/documents`)
      .then((r) => r.json())
      .then((d: { documents?: DocSummary[] }) => setDocs(d.documents ?? []))
      .catch(() => {});
    fetch(`${base}/tools`)
      .then((r) => r.json())
      .then((d: { tools?: unknown[] }) => setTools((d.tools ?? []).length))
      .catch(() => {});
    fetch(`${base}/autonomy/daemons`)
      .then((r) => r.json())
      .then((d: { daemons?: { enabled: boolean }[] }) =>
        setDaemons((d.daemons ?? []).filter((x) => x.enabled).length))
      .catch(() => {});
  }, []);

  // Very approximate context usage — 4 chars/token, cap 200k for Nemotron Ultra.
  const modelCap = 200_000;
  const approxTokens = messageCount * 120; // rough — every turn ~120 tokens overhead
  const usagePct = Math.min(100, Math.round((approxTokens / modelCap) * 100));

  return (
    <aside className="ctx-panel">
      <header className="ctx-head">
        <div className="ctx-title">Context</div>
        <button className="ctx-close" onClick={onClose} aria-label="Close context">
          <IconClose />
        </button>
      </header>

      <div className="ctx-scroll">
        <Section label="Session">
          <Row k="Model" v={health?.model ?? "—"} mono />
          <Row k="Provider" v={health?.provider ?? "—"} />
          <Row k="Turns" v={String(messageCount)} mono />
        </Section>

        <Section label="Context usage">
          <div className="ctx-meter">
            <div className="ctx-meter-fill" style={{ width: `${usagePct}%` }} />
          </div>
          <div className="ctx-meter-label">
            ≈{approxTokens.toLocaleString()} / {modelCap.toLocaleString()} tokens ({usagePct}%)
          </div>
          {usagePct > 70 && (
            <div className="ctx-warn">
              Context is getting large. Consider starting a fresh session — the project stays connected.
            </div>
          )}
        </Section>

        <Section label={`Documents (${docs.length})`}>
          {docs.length === 0 ? (
            <div className="ctx-empty">No documents attached.</div>
          ) : (
            docs.slice(0, 8).map((d) => (
              <Row key={d.id} k="•" v={d.filename} mono />
            ))
          )}
        </Section>

        <Section label={`Memory (${memories.length})`}>
          {memories.length === 0 ? (
            <div className="ctx-empty">Nothing recalled yet.</div>
          ) : (
            memories.slice(0, 5).map((m) => (
              <div key={m.id} className="ctx-mem">
                <span className="ctx-mem-key">{m.key}</span>
                <span className="ctx-mem-val">{m.value}</span>
              </div>
            ))
          )}
        </Section>

        <Section label="Capabilities">
          <Row k="Tools" v={String(tools)} mono />
          <Row k="Daemons" v={String(daemons)} mono />
        </Section>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="ctx-section">
      <div className="ctx-label">{label}</div>
      <div className="ctx-body">{children}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }): JSX.Element {
  return (
    <div className="ctx-row">
      <span className="ctx-row-k">{k}</span>
      <span className={`ctx-row-v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}
