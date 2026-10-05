import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarDays, LogOut, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Avatar, IconTile, PageHeader } from "@/components/ui";
import { whenLabel } from "@/lib/format";
import { eq } from "drizzle-orm";
import { getDb, calendarConnections, templates } from "@milo/db";
import { BUILT_IN_TEMPLATES } from "@milo/intelligence";
import { getCurrentUser } from "@/lib/session";
import { getPrefs } from "@/lib/onboarding-state";
import { signOut } from "@/auth";
import { AutoSave } from "./auto-save";
import { savePrefsAction, syncCalendarAction, disconnectCalendarAction } from "./actions";

export const dynamic = "force-dynamic";
const KIND: Record<string, string> = { google: "Google Calendar", ics: "iCal link", microsoft: "Outlook calendar" };
const row = "flex items-start justify-between gap-6 border-b border-border py-4 [&:nth-last-child(2)]:border-0"; // the last child is AutoSave's status line
const hint = "text-xs leading-relaxed text-muted";

/** A settings group: what it is about on the left, the controls in a card on the right. */
function Group({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-x-10 gap-y-3 border-t border-border py-8 first:border-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)]">
      <div><h2 className="font-semibold tracking-tight">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted">{description}</p></div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUser(), db = getDb();
  const [p, conns, custom] = await Promise.all([getPrefs(user.id), db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id)), db.select().from(templates).where(eq(templates.ownerId, user.id))]);
  const tpls = [...BUILT_IN_TEMPLATES.map((t) => ({ key: t.key, name: t.name })), ...custom.map((t) => ({ key: t.key, name: t.name }))];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Your account, defaults for new meetings, and what Milo emails you about." />

      <Group title="Account" description="The account you are signed in with.">
        <div className="card flex items-center gap-4 p-5">
          <Avatar name={user.name ?? user.email} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{user.name ?? "Your account"}</div><div className={`truncate ${hint}`}>{user.email}</div></div>
          {process.env.GOOGLE_CLIENT_ID && <form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="btn btn-secondary btn-sm"><LogOut />Sign out</button></form>}
        </div>
      </Group>

      <Group title="General" description="Defaults applied to every new meeting.">
        <AutoSave action={savePrefsAction} className="card px-5 pb-3 pt-1">
          <input type="hidden" name="group" value="general" />
          <label className={`${row} max-sm:flex-col max-sm:gap-3`}><span><span className="text-sm font-medium">Default summary template</span><span className={`mt-0.5 block ${hint}`}>Used for every new meeting&apos;s first summary.</span></span>
            <select name="template" defaultValue={p.defaultTemplate} className="field field-sm shrink-0">{tpls.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
          <label className={`${row} max-sm:flex-col max-sm:gap-3`}><span><span className="text-sm font-medium">New meetings are visible to</span><span className={`mt-0.5 block ${hint}`}>Teammates in your workspace can find shared meetings in Team calls, search and Ask Milo. You can change any meeting later.</span></span>
            <select name="visibility" defaultValue={p.defaultVisibility} className="field field-sm shrink-0"><option value="private">Only me</option><option value="team">My team</option></select></label>
        </AutoSave>
      </Group>

      <Group title="Notifications" description="Emails Milo sends to you.">
        <AutoSave action={savePrefsAction} className="card px-5 pb-3 pt-1">
          <input type="hidden" name="group" value="notifications" />
          <label className={row}><span><span className="text-sm font-medium">Email me the recap after each meeting</span><span className={`mt-0.5 block ${hint}`}>Who else receives it is set under <Link className="link" href="/customize">Recording rules</Link>.</span></span><input type="checkbox" name="recap" defaultChecked={p.recapEmail} className="switch mt-0.5" /></label>
          <label className={row}><span><span className="text-sm font-medium">Email me when a watched word comes up</span><span className={`mt-0.5 block ${hint}`}>Manage the words under <Link className="link" href="/alerts">Alerts</Link>.</span></span><input type="checkbox" name="alerts" defaultChecked={p.alertEmails} className="switch mt-0.5" /></label>
        </AutoSave>
      </Group>

      <Group title="Compliance" description="How attendees are told about recording.">
        <AutoSave action={savePrefsAction} className="card px-5 pb-3 pt-1">
          <input type="hidden" name="group" value="compliance" />
          <label className={row}><span><span className="text-sm font-medium">Post a consent message in the meeting chat</span><span className={`mt-0.5 block ${hint}`}>Milo announces that it is recording as soon as it joins. You remain responsible for getting consent where the law requires it, so leave this on unless you tell attendees another way.</span></span><input type="checkbox" name="consent" defaultChecked={p.consentMessage} className="switch mt-0.5" /></label>
        </AutoSave>
      </Group>

      <Group title="Calendars" description="Where Milo learns which meetings to join.">
        {conns.length === 0 ? <div className="card p-5 text-sm text-muted">No calendar connected. <Link className="link" href="/home">Connect one on Home.</Link></div> : (
          <ul className="card divide-y divide-border">
            {conns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <IconTile icon={CalendarDays} size="sm" tone={c.lastError ? "danger" : "accent"} />
                <div className="min-w-0 flex-1"><div className="font-medium">{KIND[c.kind] ?? c.kind}</div>
                  <div className={hint}>{c.lastError ? <span className="text-danger">{c.lastError}</span> : c.lastSyncedAt ? `Synced ${whenLabel(c.lastSyncedAt)}` : "Not synced yet"}</div></div>
                <div className="flex gap-1">
                  <form action={syncCalendarAction.bind(null, c.id)}><button className="btn btn-secondary btn-sm"><RefreshCw />Sync now</button></form>
                  <form action={disconnectCalendarAction.bind(null, c.id)}><button className="btn btn-ghost btn-danger btn-sm">Disconnect</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Link href="/customize" className="card group mt-2 flex items-center gap-4 p-5 transition-all hover:border-accent/50 hover:shadow-pop">
        <IconTile icon={SlidersHorizontal} tone="accent" />
        <span className="flex-1"><span className="block text-sm font-medium">Recording rules and meeting platforms</span><span className={hint}>Choose which meetings Milo joins on its own and who gets the recap.</span></span>
        <ArrowRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
      </Link>
    </div>
  );
}
