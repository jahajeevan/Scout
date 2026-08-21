import type { Config } from "tailwindcss";

// Tailwind is used only for layout utilities (flex/grid/spacing). All colours,
// fonts, and bespoke animations come from the design tokens in lib/tokens.ts and
// the keyframes in styles/globals.css — the spec forbids changing the palette or
// pulling in a component library, so this config stays deliberately thin.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
