import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { getDb, calendarConnections, calendarEvents } from "@milo/db";
import { getCurrentUser } from "@/lib/session";
import { ConnectIcsForm } from "./connect-form";
import { resyncAction } from "./actions";

export const dynamic = "force-dynamic";
const label = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", unknown: "No meeting link" } as const;

export default async function Home() {
  const user = await getCurrentUser();
  const db = getDb();
  const conns = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id));
  const events = conns.length
    ? await db.select().from(calendarEvents)
        .where(and(inArray(calendarEvents.connectionId, conns.map((c) => c.id)), gte(calendarEvents.endsAt, new Date())))
        .orderBy(asc(calendarEvents.startsAt)).limit(50)
    : [];
  const failing = conns.find((c) => c.lastError);
  const lastSync = conns.map((c) => c.lastSyncedAt).filter(Boolean).sort().pop();

  return (
    <div className="max-w-3xl space-y-8">
      {failing && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Calendar sync problem: {failing.lastError} Showing the last synced events.
          {failing.kind === "google" && <a href="/sign-in" className="ml-2 underline">Reconnect Google</a>}
        </div>
      )}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Upcoming meetings</h1>
          {conns.length > 0 && (
            <form action={resyncAction} className="flex items-center gap-3 text-xs text-muted">
              {lastSync && <span>Synced {lastSync.toLocaleTimeString()}</span>}
              <button className="rounded border border-border px-2 py-1 hover:text-text">Sync now</button>
            </form>
          )}
        </div>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">
            {conns.length ? "No upcoming meetings in the next two weeks." : "Connect a calendar below to see your upcoming meetings."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-sm text-muted">{e.startsAt.toLocaleString()} · {label[e.platform as keyof typeof label] ?? label.unknown}</div>
                </div>
                {e.meetingUrl && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">Milo will record</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConnectIcsForm />
      <section className="flex gap-3">
        <button className="rounded bg-accent px-4 py-2 text-sm font-medium text-white">Send Milo to a meeting</button>
        <button className="rounded border border-border px-4 py-2 text-sm">Upload a recording</button>
      </section>
    </div>
  );
}
