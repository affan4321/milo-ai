import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { signOut } from "@/auth";
import { getPrefs } from "@/lib/onboarding-state";
import { Avatar, Logo } from "@/components/ui";
import { ThemeToggle } from "./theme-toggle";
import { SidebarNav } from "./sidebar-nav";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!(await getPrefs(user.id)).onboarded) redirect("/onboarding");
  const signOutForm = process.env.GOOGLE_CLIENT_ID && (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}>
      <button className="btn btn-ghost btn-sm btn-icon" title="Sign out" aria-label="Sign out"><LogOut /></button>
    </form>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <Link href="/home" className="flex h-16 items-center px-6"><Logo /></Link>
        <SidebarNav />
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex items-center justify-between px-1"><span className="text-xs text-muted">Theme</span><ThemeToggle /></div>
          <div className="flex items-center gap-2.5 rounded-lg bg-bg p-2">
            <Avatar name={user.name ?? user.email} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{user.name ?? "Your account"}</div>
              <div className="truncate text-xs text-muted">{user.email}</div>
            </div>
            {signOutForm}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between px-4"><Link href="/home"><Logo size="sm" /></Link><div className="flex items-center gap-2"><ThemeToggle />{signOutForm}</div></div>
          <SidebarNav variant="bar" />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
