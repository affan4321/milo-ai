import Link from "next/link";

const TABS = [["calls", "My calls", "/home"], ["team", "Team calls", "/home?tab=team"], ["playlists", "Playlists", "/playlists"], ["alerts", "Alerts", "/alerts"]] as const;

/** The tab strip shared by Home, Playlists and Alerts, as in the original. (Deals/CRM sync is deliberately not built.) */
export function HomeTabs({ active }: { active: "calls" | "team" | "playlists" | "alerts" }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-border text-sm" aria-label="Sections">
      {TABS.map(([key, label, href]) => (
        <Link key={key} href={href} className={`-mb-px border-b-2 px-3 py-2 ${active === key ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}>{label}</Link>
      ))}
    </nav>
  );
}
