"use client";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => { try { const t = localStorage.getItem("milo-theme"); if (t === "light" || t === "dark") setTheme(t); } catch {} }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    try { t === "system" ? localStorage.removeItem("milo-theme") : localStorage.setItem("milo-theme", t); } catch {}
    if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  };
  return (
    <button onClick={() => apply(NEXT[theme])} className="mt-2 block underline hover:text-text" aria-label={`Theme: ${theme}. Click to change.`}>
      Theme: {theme}
    </button>
  );
}
