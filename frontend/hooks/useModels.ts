"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The chat model catalog (spec §20). Mirrors GET /models from the backend, whose
// per-model capability flags drive which chat controls appear (image/PDF upload
// only for vision models). Selecting a model POSTs /model, which sets the active
// model server-side — so streaming chat AND voice both use the chosen model.

export interface ModelInfo {
  id: string;
  label: string;
  endpoint: string;
  capabilities: string[];
  vision: boolean;
  documents: boolean;
  tools: boolean;
  context: number;
  note: string;
  available: boolean;
  active: boolean;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

interface UseModels {
  models: ModelInfo[];
  activeId: string;
  active: ModelInfo | null;
  select: (id: string) => void;
  reload: () => void;
}

export function useModels(): UseModels {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const busyRef = useRef<boolean>(false);

  const load = useCallback((): void => {
    const base = backendBase();
    if (!base) return;
    fetch(`${base}/models`)
      .then((r) => r.json())
      .then((d: { models?: ModelInfo[]; active?: string }) => {
        setModels(d.models ?? []);
        // Don't clobber an in-flight local selection with a stale poll.
        if (!busyRef.current) setActiveId(d.active ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15000);
    return () => window.clearInterval(id);
  }, [load]);

  const select = useCallback((id: string): void => {
    const base = backendBase();
    if (!base) return;
    busyRef.current = true;
    setActiveId(id);
    setModels((prev) => prev.map((m) => ({ ...m, active: m.id === id })));
    fetch(`${base}/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: id }),
    })
      .then((r) => r.json())
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
      });
  }, []);

  const active = models.find((m) => m.id === activeId) ?? null;
  return { models, activeId, active, select, reload: load };
}
