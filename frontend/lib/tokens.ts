// Scout — TypeScript design token map.
//
// One source of truth for `style={{ color: colors.ink }}` throughout the app.
// Every token points at a CSS variable defined in globals.css so both light and
// dark themes retone automatically. Legacy keys are kept aliased so components
// that were written against the older Nightfall/JARVIS names still work.

export const colors = {
  // ── Surfaces ─────────────────────────────────────────────────────────
  bg:            "var(--bg)",
  surface:       "var(--surface)",
  surface2:      "var(--surface-2)",
  surface3:      "var(--surface-3)",

  // ── Borders ──────────────────────────────────────────────────────────
  border:        "var(--border)",
  borderStrong:  "var(--border-strong)",

  // ── Ink ──────────────────────────────────────────────────────────────
  ink:           "var(--ink)",
  inkSoft:       "var(--ink-soft)",
  inkQuiet:      "var(--ink-quiet)",
  inkDisabled:   "var(--ink-disabled)",

  // ── Accent (interactive/active/focus only) ───────────────────────────
  accent:        "var(--accent)",
  accentHover:   "var(--accent-hover)",
  accentFg:      "var(--accent-fg)",
  accentSubtle:  "var(--accent-subtle)",

  // ── Semantic (rare) ──────────────────────────────────────────────────
  success:       "var(--success)",
  warning:       "var(--warning)",
  danger:        "var(--danger)",

  // ── Legacy aliases (do not use in new code) ──────────────────────────
  surfaceMuted:  "var(--surface-2)",
  surfaceSunken: "var(--surface-3)",
  glassPanel:    "var(--surface)",
  panelBorder:   "var(--border)",
  panelBorderHover: "var(--accent)",
  goldPrimary:   "var(--accent)",
  goldBright:    "var(--accent-hover)",
  goldGlow:      "var(--accent-subtle)",
  brass:         "var(--accent)",
  brassBright:   "var(--accent-hover)",
  brassSoft:     "var(--accent-subtle)",
  blueAccent:    "var(--ink-soft)",
  blueGlow:      "var(--border)",
  champagne:     "var(--accent-subtle)",
  green:         "var(--success)",
  amber:         "var(--warning)",
  red:           "var(--danger)",
  gpuPurple:     "var(--success)",
  text100:       "var(--ink)",
  text70:        "var(--ink-soft)",
  text30:        "var(--ink-quiet)",
  inkFaint:      "var(--ink-quiet)",
  hairline:      "var(--border)",
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  display: "var(--font-display)",  // Inter — every UI + heading
  mono:    "var(--font-mono)",     // JetBrains Mono — code + tabular meta
} as const;

// Radii scale in pixels; keep in sync with --r-* variables in globals.css.
export const radii = { sm: 5, md: 8, lg: 12, xl: 16, pill: 999 } as const;

export const motion = {
  fast: "140ms cubic-bezier(0.16,1,0.30,1)",
  base: "220ms cubic-bezier(0.16,1,0.30,1)",
  slow: "380ms cubic-bezier(0.16,1,0.30,1)",
} as const;

// Gauge / chart literal hex — canvas contexts can't resolve CSS vars.
// Tuned to sit inside the new palette in both themes.
export const gaugeColors = {
  cpu:     "#9C7A34",   // accent brass
  ram:     "#59564F",   // ink-soft (light) / a soft neutral
  gpu:     "#8F8B82",
  battery: "#4E7B5D",   // success sage
} as const;
