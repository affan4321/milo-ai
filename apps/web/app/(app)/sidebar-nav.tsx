"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Bell, House, ListVideo, Search, Settings, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";

interface Item { label: string; href: string; icon: LucideIcon; match: string[] }

// `match` lists the path prefixes that belong to an entry, so a meeting page still shows Home as the place you are.
const GROUPS: { label: string | null; items: Item[] }[] = [
  { label: null, items: [
    { label: "Home", href: "/home", icon: House, match: ["/home", "/meetings"] },
    { label: "Search", href: "/search", icon: Search, match: ["/search"] },
    { label: "Ask Milo", href: "/ask", icon: Sparkles, match: ["/ask"] },
  ] },
  { label: "Library", items: [
    { label: "Playlists", href: "/playlists", icon: ListVideo, match: ["/playlists"] },
    { label: "Alerts", href: "/alerts", icon: Bell, match: ["/alerts"] },
  ] },
  { label: "Setup", items: [
    { label: "Recording rules", href: "/customize", icon: SlidersHorizontal, match: ["/customize"] },
    { label: "Settings", href: "/settings", icon: Settings, match: ["/settings"] },
  ] },
];

/** The app's main navigation. `rail` is the desktop sidebar; `bar` is the scrolling strip shown on small screens. */
export function SidebarNav({ variant = "rail" }: { variant?: "rail" | "bar" }) {
  const path = usePathname();
  const isActive = (match: string[]) => match.some((m) => path === m || path.startsWith(`${m}/`));

  if (variant === "bar") {
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]" aria-label="Main">
        {GROUPS.flatMap((g) => g.items).map(({ label, href, icon: I, match }) => (
          <Link key={href} href={href} aria-current={isActive(match) ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${isActive(match) ? "bg-accent/10 font-medium text-accent-ink" : "text-muted"}`}>
            <I className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3" aria-label="Main">
      {GROUPS.map((g, gi) => (
        <div key={gi}>
          {g.label && <div className="eyebrow mb-1.5 px-3">{g.label}</div>}
          <ul className="space-y-0.5">
            {g.items.map(({ label, href, icon: I, match }) => {
              const active = isActive(match);
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "font-medium text-accent-ink" : "text-muted hover:bg-raised hover:text-text"}`}>
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-accent/10" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <I className="relative h-[18px] w-[18px]" /><span className="relative">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
