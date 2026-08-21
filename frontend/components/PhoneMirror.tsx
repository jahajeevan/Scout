"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { colors, fonts } from "@/lib/tokens";
import * as sound from "@/lib/sound";

// Live phone mirror + control. Polls JPEG frames from the backend's /phone/screen
// and forwards taps / swipes / keys / text back over the ADB link. Coordinates are
// mapped from the on-screen image to the phone's real resolution (sent as headers).

function base(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

export default function PhoneMirror({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [src, setSrc] = useState<string>("");
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [offline, setOffline] = useState<boolean>(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const objUrl = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    const b = base();
    if (!b) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${b}/phone/screen`, { cache: "no-store" });
        if (!alive) return;
        if (r.status === 503) {
          setOffline(true);
          return;
        }
        setOffline(false);
        const w = parseInt(r.headers.get("X-Phone-W") || "0", 10);
        const h = parseInt(r.headers.get("X-Phone-H") || "0", 10);
        if (w && h) setDims({ w, h });
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (objUrl.current) URL.revokeObjectURL(objUrl.current);
        objUrl.current = url;
        setSrc(url);
      } catch {
        if (alive) setOffline(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 450);
    return () => {
      alive = false;
      window.clearInterval(id);
      if (objUrl.current) {
        URL.revokeObjectURL(objUrl.current);
        objUrl.current = "";
      }
    };
  }, [open]);

  const toPhone = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img || !dims.w || !dims.h) return null;
      const rect = img.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;
      if (px < 0 || px > 1 || py < 0 || py > 1) return null;
      return { x: Math.round(px * dims.w), y: Math.round(py * dims.h) };
    },
    [dims],
  );

  const post = (path: string, body: unknown): void => {
    const b = base();
    if (!b) return;
    fetch(`${b}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  };

  if (!open) return null;
  const aspect = dims.w && dims.h ? `${dims.w} / ${dims.h}` : "9 / 19.5";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "rgba(3,5,8,0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
      >
        <div
          style={{
            fontFamily: fonts.display,
            letterSpacing: "0.22em",
            color: colors.goldBright,
            fontSize: 11,
            textShadow: `0 0 14px ${colors.goldGlow}`,
          }}
        >
          PHONE · ONEPLUS NORD 4
        </div>

        <div
          style={{
            position: "relative",
            height: "70vh",
            aspectRatio: aspect,
            border: `1.5px solid ${colors.panelBorderHover}`,
            borderRadius: 22,
            overflow: "hidden",
            boxShadow: `0 0 44px rgba(240,168,48,0.22)`,
            background: "#000",
          }}
        >
          {offline || !src ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: colors.text30,
                fontFamily: fonts.display,
                fontSize: 12,
                textAlign: "center",
                padding: 24,
                lineHeight: 1.7,
              }}
            >
              Phone offline, sir.
              <br />
              Wake it and keep it on Wi-Fi (a charger keeps the link alive).
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt="phone screen"
              draggable={false}
              onMouseDown={(e) => {
                dragStart.current = { x: e.clientX, y: e.clientY };
              }}
              onMouseUp={(e) => {
                const s = dragStart.current;
                dragStart.current = null;
                const start = s ? toPhone(s.x, s.y) : null;
                const end = toPhone(e.clientX, e.clientY);
                if (!start || !end) return;
                const dist = Math.hypot(end.x - start.x, end.y - start.y);
                sound.sfx("tick");
                if (dist < 14) post("/phone/tap", { x: end.x, y: end.y });
                else post("/phone/swipe", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, ms: 180 });
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "fill",
                cursor: "pointer",
                userSelect: "none",
                display: "block",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <NavBtn label="◀  Back" onClick={() => post("/phone/key", { key: "back" })} />
          <NavBtn label="●  Home" onClick={() => post("/phone/key", { key: "home" })} />
          <NavBtn label="▬  Recent" onClick={() => post("/phone/key", { key: "recents" })} />
        </div>

        <PhoneType onType={(t) => post("/phone/text", { text: t })} onEnter={() => post("/phone/key", { key: "enter" })} />

        <button className="qa-chip" onClick={onClose}>
          ✕ Close mirror
        </button>
      </div>
    </div>
  );
}

function NavBtn({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      className="qa-chip"
      onClick={() => {
        sound.sfx("tick");
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function PhoneType({
  onType,
  onEnter,
}: {
  onType: (t: string) => void;
  onEnter: () => void;
}): JSX.Element {
  const [text, setText] = useState<string>("");
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (text) onType(text);
            onEnter();
            setText("");
          }
        }}
        placeholder="Type on phone…"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${colors.panelBorder}`,
          borderRadius: 10,
          padding: "7px 11px",
          color: colors.text100,
          fontFamily: fonts.display,
          fontSize: 12,
          outline: "none",
          width: 200,
        }}
      />
      <button
        className="qa-chip"
        onClick={() => {
          if (text) onType(text);
          setText("");
        }}
      >
        Send text
      </button>
    </div>
  );
}
