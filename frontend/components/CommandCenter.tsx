"use client";

import { colors } from "@/lib/tokens";
import { brand } from "@/lib/brand";
import { IconClose } from "@/components/icons";

// Secondary surface. System capabilities are preserved but moved out of the
// conversation into a calm drawer (spec §9). Restrained meters, not gauges.

interface Live {
  cpu: number;
  ram: number;
  gpu: number;
  battery: number;
}
interface Weather {
  city: string;
  temp_c: number | null;
  description: string;
  emoji: string;
}
interface CalEvent {
  time: string;
  title: string;
}

interface Props {
  live: Live;
  weather: Weather | null;
  events: CalEvent[] | null;
  connected: boolean;
  modelLabel: string;
  voiceReady: boolean;
  onClose: () => void;
}

function Meter({ label, value }: { label: string; value: number }): JSX.Element {
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", color: colors.inkSoft }}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: colors.ink }}>
          {v}%
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 3, background: "rgba(38,34,28,0.08)", overflow: "hidden" }}>
        <div
          style={{
            width: `${v}%`,
            height: "100%",
            borderRadius: 3,
            background: colors.brass,
            transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>
    </div>
  );
}

export default function CommandCenter({
  live,
  weather,
  events,
  connected,
  modelLabel,
  voiceReady,
  onClose,
}: Props): JSX.Element {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Command Center">
        <div className="drawer-head">
          <span className="eyebrow">Command Center</span>
          <button className="iconbtn" onClick={onClose} style={{ minWidth: 0, padding: "0 9px", height: 30 }}>
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          <div className="block">
            <span className="eyebrow">System</span>
            <Meter label="CPU" value={live.cpu} />
            <Meter label="MEMORY" value={live.ram} />
            <Meter label="GPU" value={live.gpu} />
            <Meter label="BATTERY" value={live.battery} />
          </div>

          <div className="block">
            <span className="eyebrow">Status</span>
            <StatRow k={brand.name} v={connected ? "Connected" : "Offline"} tone={connected ? "green" : "muted"} />
            <StatRow k="Model" v={modelLabel} />
            <StatRow k="Voice" v={voiceReady ? "Ready" : "Idle"} />
          </div>

          {weather ? (
            <div className="block">
              <span className="eyebrow">Weather</span>
              <StatRow
                k={weather.city || "Local"}
                v={weather.temp_c !== null ? `${weather.temp_c}° · ${weather.description}` : weather.description}
              />
            </div>
          ) : null}

          <div className="block">
            <span className="eyebrow">Schedule</span>
            {events && events.length > 0 ? (
              events.map((e, i) => <StatRow key={i} k={e.time} v={e.title} />)
            ) : (
              <span style={{ fontSize: 13, color: colors.inkFaint }}>Nothing scheduled.</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function StatRow({ k, v, tone }: { k: string; v: string; tone?: "green" | "muted" }): JSX.Element {
  const color = tone === "green" ? colors.green : tone === "muted" ? colors.inkFaint : colors.ink;
  return (
    <div className="stat-row">
      <span className="k">{k}</span>
      <span className="v" style={{ color, maxWidth: "62%", textAlign: "right" }}>
        {v}
      </span>
    </div>
  );
}
