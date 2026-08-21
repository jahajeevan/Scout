"use client";

import { useMemo } from "react";
import { colors } from "@/lib/tokens";

// 20 floating particles (spec §4): gold/blue/white, rising continuously.
// Positions are derived deterministically from the index (no Math.random) so the
// server and client render identically — avoiding React hydration mismatches.

const COUNT = 20;
const PALETTE = [colors.goldPrimary, colors.blueAccent, "rgba(255,255,255,0.8)"];

function pseudo(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

export default function Particles(): JSX.Element {
  // Round every value to a fixed precision. Math.sin is not bit-identical across
  // JS engines, so the raw floats differ between the Node server render and the
  // browser — rounding to 3 dp makes the emitted style strings match exactly and
  // avoids React hydration warnings.
  const particles = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => {
        const size = (2 + pseudo(i, 1) * 2.5).toFixed(3);
        const duration = (11 + pseudo(i, 2) * 12).toFixed(3);
        const delay = (-pseudo(i, 3) * Number(duration)).toFixed(3);
        return {
          left: (pseudo(i, 4) * 100).toFixed(3),
          size,
          duration,
          delay,
          color: PALETTE[Math.floor(pseudo(i, 5) * PALETTE.length)],
        };
      }),
    [],
  );

  return (
    <>
      {particles.map((p, i) => (
        <span
          key={i}
          className="particle"
          style={{
            left: `${p.left}vw`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            boxShadow: `0 0 6px ${p.color}`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </>
  );
}
