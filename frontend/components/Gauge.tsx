import { colors, fonts } from "@/lib/tokens";

// 270° speedometer-style gauge (spec §4). SVG arc, NOT a bar chart. The filled
// arc uses a smooth 1.5s stroke-dasharray transition and a drop-shadow glow.

interface GaugeProps {
  label: string;
  /** 0–100. */
  value: number;
  color: string;
  unit?: string;
  size?: number;
}

const SWEEP = 270; // degrees of visible arc

export default function Gauge({
  label,
  value,
  color,
  unit = "%",
  size = 74,
}: GaugeProps): JSX.Element {
  const r = size / 2 - 7;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const arcLen = (SWEEP / 360) * circumference;
  const clamped = Math.max(0, Math.min(100, value));
  const filled = (clamped / 100) * arcLen;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Rotate so the 90° gap sits centred at the bottom. */}
        <g transform={`rotate(135 ${cx} ${cy})`}>
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="rgba(20,40,80,0.09)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${circumference}`}
          />
          {/* Filled value */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{
              transition: "stroke-dasharray 1.5s ease",
              filter: `drop-shadow(0 0 4px ${color})`,
            }}
          />
        </g>
        {/* Centre value */}
        <text
          x={cx}
          y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={colors.text100}
          style={{ fontFamily: fonts.mono, fontSize: 15, fontWeight: 700 }}
        >
          {Math.round(clamped)}
        </text>
        <text
          x={cx}
          y={cy + 13}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={colors.text30}
          style={{ fontFamily: fonts.mono, fontSize: 7 }}
        >
          {unit}
        </text>
      </svg>
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.12em",
          color: colors.text70,
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}
