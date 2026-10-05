"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";
const OPTIONS = [["system", Monitor, "Match device"], ["light", Sun, "Light"], ["dark", Moon, "Dark"]] as const;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => { try { const t = localStorage.getItem("milo-theme"); if (t === "light" || t === "dark") setTheme(t); } catch {} }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    try { t === "system" ? localStorage.removeItem("milo-theme") : localStorage.setItem("milo-theme", t); } catch {}
    if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  };
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-border bg-bg p-0.5">
      {OPTIONS.map(([value, I, label]) => (
        <button key={value} role="radio" aria-checked={theme === value} aria-label={label} title={label} onClick={() => apply(value)}
          className={`flex h-6 w-7 items-center justify-center rounded-md transition-colors ${theme === value ? "bg-surface text-text shadow-card" : "text-subtle hover:text-text"}`}>
          <I className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
