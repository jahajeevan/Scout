import { colors, fonts } from "@/lib/tokens";

// A single calendar/schedule row. Real events arrive in Phase 4 (Calendar
// integration); for now the Schedule panel feeds it placeholder events.

interface CalRowProps {
  time: string;
  title: string;
  accent?: string;
}

export default function CalRow({
  time,
  title,
  accent = colors.goldPrimary,
}: CalRowProps): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <span
        style={{
          width: 3,
          height: 22,
          borderRadius: 2,
          background: accent,
          boxShadow: `0 0 6px ${accent}`,
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          className="mono"
          style={{ fontSize: 9, color: colors.text70, lineHeight: 1.2 }}
        >
          {time}
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontSize: 11,
            color: colors.text100,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
      </div>
    </div>
  );
}
