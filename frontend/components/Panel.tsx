"use client";

import type { CSSProperties, ReactNode } from "react";

// Glass panel (spec §4). NOTE: the spec's mouse-driven 3D tilt was removed at the
// user's explicit request — the panels no longer shift when the cursor moves over
// them. The glass, hover border, glint sweep, and scan line are retained.

interface PanelProps {
  title?: string;
  children: ReactNode;
  /** Stagger the scan-line animation so panels don't sweep in unison. */
  scanDelay?: number;
  /** Extra classes for layout (sizing/flex). */
  className?: string;
  style?: CSSProperties;
}

export default function Panel({
  title,
  children,
  scanDelay = 0,
  className = "",
  style,
}: PanelProps): JSX.Element {
  return (
    <div
      className={`panel ${className}`}
      style={{
        padding: "12px 13px",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div className="panel-scan" style={{ animationDelay: `${scanDelay}s` }} />
      <div className="panel-glint" />
      {title ? (
        <div className="panel-title">
          <span>{title}</span>
        </div>
      ) : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
