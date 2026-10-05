import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { signOut } from "@/auth";
import { getPrefs } from "@/lib/onboarding-state";
import type { ReactNode } from "react";

const nav = [["Home", "/home"], ["Search", "/search"], ["Ask Milo", "/ask"], ["Playlists", "/playlists"], ["Alerts", "/alerts"], ["Settings", "/settings"]];

export const dynamic = "force-dynamic";

export default async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!(await getPrefs(user.id)).onboarded) redirect("/onboarding");
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-surface p-4">
        <div className="mb-6 text-lg font-semibold text-accent">Milo</div>
        <nav className="space-y-1 text-sm">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} className="block rounded px-2 py-1.5 text-muted hover:bg-bg hover:text-text">{label}</Link>
          ))}
        </nav>
        <div className="mt-8 border-t border-border pt-4 text-xs text-muted">
          <div className="truncate">{user.email}</div>
          {process.env.GOOGLE_CLIENT_ID && (
            <form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}>
              <button className="mt-1 underline hover:text-text">Sign out</button>
            </form>
          )}
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
