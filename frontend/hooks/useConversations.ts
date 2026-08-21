"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/hooks/useJARVIS";
import { supabase, CONVERSATIONS_TABLE } from "@/lib/supabase";

// Persistent conversation history (spec §22). Source of truth is Supabase when
// reachable; otherwise a localStorage cache keeps everything working. Writes go
// to both, so a Supabase outage never loses data and never blocks the UI.

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export type Backend = "supabase" | "local";

const CACHE = "scout.conversations.v1";
const AKEY = "scout.activeId.v1";
const NEW_TITLE = "New conversation";

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  if (!firstUser) return NEW_TITLE;
  const t = firstUser.text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 48) + "…" : t;
}

function readCache(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "[]") as Conversation[];
  } catch {
    return [];
  }
}
function writeCache(list: Conversation[]): void {
  try {
    localStorage.setItem(CACHE, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

function fromRow(r: Record<string, unknown>): Conversation {
  return {
    id: String(r.id),
    title: (r.title as string) || NEW_TITLE,
    messages: (r.messages as ChatMessage[]) ?? [],
    pinned: !!r.pinned,
    archived: !!r.archived,
    createdAt: new Date((r.created_at as string) ?? Date.now()).getTime(),
    updatedAt: new Date((r.updated_at as string) ?? Date.now()).getTime(),
  };
}
function toRow(c: Conversation): Record<string, unknown> {
  return {
    id: c.id,
    title: c.title,
    messages: c.messages,
    pinned: c.pinned,
    archived: c.archived,
    created_at: new Date(c.createdAt).toISOString(),
    updated_at: new Date(c.updatedAt).toISOString(),
  };
}

function sortConvos(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

interface UseConversations {
  ready: boolean;
  backend: Backend;
  conversations: Conversation[];
  activeId: string;
  active: Conversation | null;
  newConversation: () => void;
  select: (id: string) => ChatMessage[];
  rename: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  archive: (id: string, archived: boolean) => void;
  remove: (id: string) => void;
  syncActive: (messages: ChatMessage[]) => void;
}

export function useConversations(): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState<Backend>(supabase ? "supabase" : "local");
  const activeRef = useRef<string>("");
  activeRef.current = activeId;
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  // Persist a single conversation to Supabase (best-effort) + cache.
  const persist = useCallback((c: Conversation) => {
    if (supabase) {
      supabase
        .from(CONVERSATIONS_TABLE)
        .upsert(toRow(c))
        .then(({ error }) => {
          if (error) setBackend("local");
        });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: Conversation[] = [];
      if (supabase) {
        const { data, error } = await supabase
          .from(CONVERSATIONS_TABLE)
          .select("*")
          .order("updated_at", { ascending: false });
        if (error || !data) {
          setBackend("local");
          list = readCache();
        } else {
          setBackend("supabase");
          list = data.map(fromRow);
          // Merge any local-only cache that predates the table (best effort).
          const cached = readCache();
          const ids = new Set(list.map((c) => c.id));
          for (const c of cached) if (!ids.has(c.id)) list.push(c);
        }
      } else {
        list = readCache();
      }
      if (cancelled) return;
      list = sortConvos(list.filter((c) => !c.archived).concat(list.filter((c) => c.archived)));
      setConversations(list);
      const savedActive = (() => {
        try {
          return localStorage.getItem(AKEY) || "";
        } catch {
          return "";
        }
      })();
      const firstVisible = list.find((c) => !c.archived);
      setActiveId(savedActive && list.some((c) => c.id === savedActive) ? savedActive : firstVisible?.id ?? "");
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror to cache + remember active whenever state changes.
  useEffect(() => {
    if (!ready) return;
    writeCache(conversations);
  }, [conversations, ready]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(AKEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId, ready]);

  const newConversation = useCallback(() => {
    // If we already have an empty untitled convo (e.g. from the previous launch),
    // just activate it instead of stacking another one — keeps the sidebar clean.
    const existingEmpty = conversations.find(
      (c) => c.title === NEW_TITLE && c.messages.length === 0 && !c.archived,
    );
    if (existingEmpty) {
      setActiveId(existingEmpty.id);
      return;
    }
    const now = Date.now();
    const c: Conversation = {
      id: uid(),
      title: NEW_TITLE,
      messages: [],
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => sortConvos([c, ...prev]));
    setActiveId(c.id);
    persist(c);
  }, [conversations, persist]);

  const select = useCallback(
    (id: string): ChatMessage[] => {
      setActiveId(id);
      const c = conversations.find((x) => x.id === id);
      return c ? c.messages : [];
    },
    [conversations],
  );

  const rename = useCallback(
    (id: string, title: string) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title, updatedAt: Date.now() } : c));
        const c = next.find((x) => x.id === id);
        if (c) persist(c);
        return sortConvos(next);
      });
    },
    [persist],
  );

  const togglePin = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned, updatedAt: Date.now() } : c));
        const c = next.find((x) => x.id === id);
        if (c) persist(c);
        return sortConvos(next);
      });
    },
    [persist],
  );

  const archive = useCallback(
    (id: string, archived: boolean) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, archived, updatedAt: Date.now() } : c));
        const c = next.find((x) => x.id === id);
        if (c) persist(c);
        return sortConvos(next);
      });
      if (archived && activeRef.current === id) setActiveId("");
    },
    [persist],
  );

  const remove = useCallback((id: string) => {
    setConversations((prev) => sortConvos(prev.filter((c) => c.id !== id)));
    if (supabase) supabase.from(CONVERSATIONS_TABLE).delete().eq("id", id).then(() => {});
    if (activeRef.current === id) setActiveId("");
  }, []);

  // Persist the live message buffer into the active conversation, creating one
  // if needed. Called by the page on meaningful message changes (not per token).
  // Side effects (id creation, persist, setActiveId) live OUTSIDE the state
  // updater so React StrictMode's double-invocation can't create duplicates.
  const syncActive = useCallback(
    (messages: ChatMessage[]) => {
      if (messages.length === 0) return;
      const id = activeRef.current;
      const existing = conversationsRef.current.find((c) => c.id === id);
      if (!id || !existing) {
        const newId = uid();
        activeRef.current = newId;
        setActiveId(newId);
        const now = Date.now();
        const c: Conversation = {
          id: newId,
          title: deriveTitle(messages),
          messages,
          pinned: false,
          archived: false,
          createdAt: now,
          updatedAt: now,
        };
        persist(c);
        setConversations((prev) => sortConvos([c, ...prev]));
        return;
      }
      const title = existing.title === NEW_TITLE ? deriveTitle(messages) : existing.title;
      const updated: Conversation = { ...existing, messages, title, updatedAt: Date.now() };
      persist(updated);
      setConversations((prev) => sortConvos(prev.map((c) => (c.id === id ? updated : c))));
    },
    [persist],
  );

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return {
    ready,
    backend,
    conversations,
    activeId,
    active,
    newConversation,
    select,
    rename,
    togglePin,
    archive,
    remove,
    syncActive,
  };
}
