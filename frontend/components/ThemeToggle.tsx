"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/icons";

// Toggles the app theme by flipping data-theme on <html> and persisting the
// choice. The initial value is set pre-paint by the inline script in layout.tsx,
// so this only reads/sets from here on (no flash).

export default function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle(): void {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("scout-theme", next);
    } catch {
      /* private mode */
    }
    setDark(!dark);
  }

  return (
    <button className="iconbtn" onClick={toggle} title={dark ? "Switch to light" : "Switch to dark"} aria-label="Toggle theme">
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
