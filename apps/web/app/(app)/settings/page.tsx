import Link from "next/link";
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
const h = "mb-3 text-xs font-semibold uppercase tracking-wide text-muted";
const row = "flex items-start justify-between gap-4 py-2";
const hint = "text-xs text-muted";

export default async function SettingsPage() {
  const user = await getCurrentUser(), db = getDb();
  const [p, conns, custom] = await Promise.all([getPrefs(user.id), db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id)), db.select().from(templates).where(eq(templates.ownerId, user.id))]);
  const tpls = [...BUILT_IN_TEMPLATES.map((t) => ({ key: t.key, name: t.name })), ...custom.map((t) => ({ key: t.key, name: t.name }))];
  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section><h2 className={h}>Account</h2>
        <div className={row}><div><div className="text-sm font-medium">{user.name ?? "Your account"}</div><div className={hint}>{user.email}</div></div>
          {process.env.GOOGLE_CLIENT_ID && <form action={async () => { "use server"; await signOut({ redirectTo: "/sign-in" }); }}><button className="text-sm text-muted underline hover:text-text">Sign out</button></form>}</div>
      </section>

      <section><h2 className={h}>General</h2>
        <AutoSave action={savePrefsAction}>
          <input type="hidden" name="group" value="general" />
          <label className={row}><span><span className="text-sm">Default summary template</span><span className={`block ${hint}`}>Used for every new meeting&apos;s first summary.</span></span>
            <select name="template" defaultValue={p.defaultTemplate} className="rounded border border-border bg-surface px-2 py-1 text-sm">{tpls.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
          <label className={row}><span><span className="text-sm">New meetings are visible to</span><span className={`block ${hint}`}>Teammates in your workspace can find shared meetings in Team calls, search and Ask Milo. You can change any meeting later.</span></span>
            <select name="visibility" defaultValue={p.defaultVisibility} className="rounded border border-border bg-surface px-2 py-1 text-sm"><option value="private">Only me</option><option value="team">My team</option></select></label>
        </AutoSave>
      </section>

      <section><h2 className={h}>Notifications</h2>
        <AutoSave action={savePrefsAction}>
          <input type="hidden" name="group" value="notifications" />
          <label className={row}><span><span className="text-sm">Email me the recap after each meeting</span><span className={`block ${hint}`}>Who else receives it is set on the <Link className="underline" href="/customize">customize page</Link>.</span></span><input type="checkbox" name="recap" defaultChecked={p.recapEmail} className="mt-1" /></label>
          <label className={row}><span><span className="text-sm">Email me when a watched word comes up</span><span className={`block ${hint}`}>Manage the words under <Link className="underline" href="/alerts">Alerts</Link>.</span></span><input type="checkbox" name="alerts" defaultChecked={p.alertEmails} className="mt-1" /></label>
        </AutoSave>
      </section>

      <section><h2 className={h}>Compliance</h2>
        <AutoSave action={savePrefsAction}>
          <input type="hidden" name="group" value="compliance" />
          <label className={row}><span><span className="text-sm">Post a consent message in the meeting chat</span><span className={`block ${hint}`}>Milo announces that it is recording as soon as it joins. You remain responsible for getting consent where the law requires it, so leave this on unless you tell attendees another way.</span></span><input type="checkbox" name="consent" defaultChecked={p.consentMessage} className="mt-1" /></label>
        </AutoSave>
      </section>

      <section><h2 className={h}>Calendars</h2>
        {conns.length === 0 ? <p className={hint}>No calendar connected. <Link className="underline" href="/home">Connect one on Home.</Link></p> : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {conns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div><div className="font-medium">{KIND[c.kind] ?? c.kind}</div>
                  <div className={hint}>{c.lastError ? <span className="text-red-500">{c.lastError}</span> : c.lastSyncedAt ? `Synced ${c.lastSyncedAt.toLocaleString()}` : "Not synced yet"}</div></div>
                <div className="flex gap-3 text-xs">
                  <form action={syncCalendarAction.bind(null, c.id)}><button className="text-muted underline hover:text-text">Sync now</button></form>
                  <form action={disconnectCalendarAction.bind(null, c.id)}><button className="text-muted underline hover:text-red-500">Disconnect</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm"><Link href="/customize" className="text-accent hover:underline">Advanced: auto-record rules and meeting platforms →</Link></p>
    </div>
  );
}
