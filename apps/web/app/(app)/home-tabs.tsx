import Link from "next/link";

const TABS = [["calls", "My calls", "/home"], ["team", "Team calls", "/home?tab=team"]] as const;

/** Switches Home between your own calls and the ones teammates shared. (Playlists and Alerts live in the sidebar; Deals/CRM sync is deliberately not built.) */
export function HomeTabs({ active }: { active: "calls" | "team" }) {
  return (
    <nav className="mb-6 inline-flex rounded-[10px] border border-border bg-raised p-1 text-sm" aria-label="Which calls to show">
      {TABS.map(([key, label, href]) => (
        <Link key={key} href={href} aria-current={active === key ? "page" : undefined}
          className={`rounded-md px-3.5 py-1.5 transition-colors ${active === key ? "bg-surface font-medium text-text shadow-card" : "text-muted hover:text-text"}`}>{label}</Link>
      ))}
    </nav>
  );
}
