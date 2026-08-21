"use client";

import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@/hooks/useModels";
import { colors } from "@/lib/tokens";
import { IconChevron, IconDot } from "@/components/icons";

// Capability-aware model selector. Lives in the composer. Explicit selection
// only — never silently switches (spec §5). Each model shows provider + the
// capabilities it actually has, so the composer can gate its controls.

const CAP_LABEL: Record<string, string> = {
  text: "Reasoning",
  tools: "Tools",
  vision: "Vision",
  documents: "Documents",
};

const CAP_CLASS: Record<string, string> = {
  Reasoning: "tag-reason",
  Tools: "tag-tools",
  Vision: "tag-vision",
  Documents: "tag-docs",
};

const PROVIDER_LABEL: Record<string, string> = {
  zai: "Z.ai",
  nvidia: "NVIDIA",
};

function caps(m: ModelInfo): string[] {
  // Show a compact, human ordering.
  const order = ["text", "tools", "vision", "documents"];
  return order.filter((c) => m.capabilities.includes(c)).map((c) => CAP_LABEL[c]);
}

interface Props {
  models: ModelInfo[];
  active: ModelInfo | null;
  onSelect: (id: string) => void;
  align?: "left" | "right";
  down?: boolean;
}

export default function ModelSelector({ models, active, onSelect, align = "left", down = false }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="ghost" onClick={() => setOpen((v) => !v)} title="Choose model" style={{ maxWidth: 220 }}>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 600,
            color: colors.ink,
          }}
        >
          {active ? active.label : "Model"}
        </span>
        <IconChevron />
      </button>

      {open ? (
        <div className={`popover ${down ? "down" : ""}`} style={{ [align]: 0, width: 320, maxHeight: "min(70vh, 560px)", overflowY: "auto" }}>
          <div className="eyebrow" style={{ padding: "6px 11px 4px" }}>
            Model
          </div>
          {models.map((m) => {
            const selected = active?.id === m.id;
            return (
              <button
                key={m.id}
                className="pop-item"
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
              >
                <span style={{ color: selected ? colors.brass : "transparent", display: "flex" }}>
                  <IconDot size={7} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: colors.ink,
                    }}
                  >
                    {m.label}
                    <span className="mono" style={{ fontSize: 10, color: colors.inkFaint, fontWeight: 400 }}>
                      {PROVIDER_LABEL[m.endpoint] ?? m.endpoint}
                    </span>
                    {!m.available ? (
                      <span className="tag" style={{ color: colors.amber, borderColor: "rgba(192,138,46,0.4)" }}>
                        needs key
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    {caps(m).map((c) => (
                      <span key={c} className={`tag ${CAP_CLASS[c] ?? ""}`}>
                        {c}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
