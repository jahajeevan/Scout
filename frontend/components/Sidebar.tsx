"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "@/hooks/useConversations";
import { brand } from "@/lib/brand";
import { colors } from "@/lib/tokens";
import {
  IconArchive,
  IconCode,
  IconEdit,
  IconEllipsis,
  IconFolder,
  IconMessage,
  IconPin,
  IconSearch,
  IconSliders,
  IconSparkles,
  IconTrash,
} from "@/components/icons";

// Conversation library (spec §22/§37). Desktop rail; on mobile it is the same
// component rendered as a drawer. Search spans titles + message text (spec §24).

interface Props {
  conversations: Conversation[];
  activeId: string;
  backend: "supabase" | "local";
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onRemove: (id: string) => void;
  onOpenSettings: () => void;
  /** Optional structural nav — when passed, a pinned nav strip appears above
   * the conversation list (Chat / Autonomy / Files / Code). */
  onOpenAutonomy?: () => void;
  onOpenFiles?: () => void;
  onOpenCode?: () => void;
  autonomyBadge?: number;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucket(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  if (day === today) return "Today";
  if (day === today - 86400000) return "Yesterday";
  if (day > today - 7 * 86400000) return "Previous 7 days";
  return "Older";
}

export default function Sidebar(props: Props): JSX.Element {
  const {
    conversations, activeId, backend, onNew, onSelect, onOpenSettings,
    onOpenAutonomy, onOpenFiles, onOpenCode, autonomyBadge = 0,
  } = props;
  const [query, setQuery] = useState("");

  const visible = useMemo(() => conversations.filter((c) => !c.archived), [conversations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.text.toLowerCase().includes(q)),
    );
  }, [visible, query]);

  // Group: pinned first, then date buckets (only when not searching).
  const groups = useMemo(() => {
    if (query.trim()) return [{ label: "Results", items: filtered }];
    const pinned = filtered.filter((c) => c.pinned);
    const rest = filtered.filter((c) => !c.pinned);
    const out: { label: string; items: Conversation[] }[] = [];
    if (pinned.length) out.push({ label: "Pinned", items: pinned });
    const order = ["Today", "Yesterday", "Previous 7 days", "Older"];
    const byBucket: Record<string, Conversation[]> = {};
    for (const c of rest) (byBucket[bucket(c.updatedAt)] ||= []).push(c);
    for (const label of order) if (byBucket[label]?.length) out.push({ label, items: byBucket[label] });
    return out;
  }, [filtered, query]);

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="wordmark" style={{ fontSize: 14 }}>
            {brand.name}
          </span>
          <span style={{ fontSize: 10.5, color: colors.inkFaint }}>{brand.subtitle}</span>
        </div>
        <button className="iconbtn" onClick={onNew} title="New conversation" style={{ height: 32, padding: "0 10px" }}>
          <IconEdit size={15} />
          <span>New</span>
        </button>
      </div>

      {(onOpenAutonomy || onOpenFiles || onOpenCode) && (
        <nav className="sidebar-nav">
          <NavItem icon={<IconMessage size={14} />} label="Chat" active />
          {onOpenAutonomy && (
            <NavItem
              icon={<IconSparkles size={14} />}
              label="Autonomy"
              badge={autonomyBadge}
              onClick={onOpenAutonomy}
            />
          )}
          {onOpenFiles && (
            <NavItem icon={<IconFolder size={14} />} label="Files" onClick={onOpenFiles} />
          )}
          {onOpenCode && (
            <NavItem icon={<IconCode size={14} />} label="Code" onClick={onOpenCode} />
          )}
        </nav>
      )}

      <div className="sidebar-search">
        <IconSearch size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
      </div>

      <div className="sidebar-list jv-scroll">
        {visible.length === 0 ? (
          <div className="sidebar-empty">No conversations yet.</div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-empty">No matches.</div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="sidebar-group">
              <div className="sidebar-group-label">{g.label}</div>
              {g.items.map((c) => (
                <Row key={c.id} c={c} active={c.id === activeId} {...props} />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <button className="sidebar-foot-btn" onClick={onOpenSettings}>
          <IconSliders size={16} />
          <span>Settings</span>
        </button>
        <span className="mono" style={{ fontSize: 9.5, color: colors.inkFaint }} title="Where history is stored">
          {backend === "supabase" ? "SYNCED" : "LOCAL"}
        </span>
      </div>
    </div>
  );
}

function Row({
  c,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onArchive,
  onRemove,
}: Props & { c: Conversation; active: boolean }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const doRename = (): void => {
    setMenu(false);
    const next = window.prompt("Rename conversation", c.title);
    if (next && next.trim()) onRename(c.id, next.trim());
  };
  const doDelete = (): void => {
    setMenu(false);
    if (window.confirm(`Delete "${c.title}"? This can't be undone.`)) onRemove(c.id);
  };

  return (
    <div ref={ref} className={`conv-row ${active ? "active" : ""}`} onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <button className="conv-row-main" onClick={() => onSelect(c.id)} title={c.title}>
        {c.pinned ? <IconPin size={12} /> : null}
        <span className="conv-row-title">{c.title}</span>
      </button>
      <button className="conv-row-menu" onClick={() => setMenu((v) => !v)} aria-label="Conversation actions">
        <IconEllipsis size={15} />
      </button>
      {menu ? (
        <div className="popover conv-menu">
          <button className="pop-item" onClick={doRename}>
            <IconEdit size={14} />
            <span>Rename</span>
          </button>
          <button className="pop-item" onClick={() => { setMenu(false); onTogglePin(c.id); }}>
            <IconPin size={14} />
            <span>{c.pinned ? "Unpin" : "Pin"}</span>
          </button>
          <button className="pop-item" onClick={() => { setMenu(false); onArchive(c.id, true); }}>
            <IconArchive size={14} />
            <span>Archive</span>
          </button>
          <button className="pop-item" onClick={doDelete} style={{ color: "var(--red)" }}>
            <IconTrash size={14} />
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Pinned nav item — icon + label + optional count badge. */
function NavItem({
  icon, label, active, badge, onClick,
}: {
  icon: JSX.Element;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`sidebar-nav-item ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="sidebar-nav-icon">{icon}</span>
      <span className="sidebar-nav-label">{label}</span>
      {badge && badge > 0 ? (
        <span className="sidebar-nav-badge">{badge}</span>
      ) : null}
    </button>
  );
}
