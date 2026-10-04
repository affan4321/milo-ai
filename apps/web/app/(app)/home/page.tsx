import Link from "next/link";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { BOT_ACTIVE_STATES } from "@milo/core";
import { botCapacity } from "@milo/calendar";
import { botStatusText } from "@/lib/bot-status";
import { getDb, calendarConnections, calendarEvents, meetings, botSessions } from "@milo/db";
import { AutoRefresh } from "../meetings/[id]/auto-refresh";
import { SendMilo } from "./send-milo";
import { RecordToggle } from "./record-toggle";
import { UploadButton } from "./upload-button";
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
  const recent = await db.select().from(meetings).where(eq(meetings.ownerId, user.id)).orderBy(desc(meetings.createdAt)).limit(20);
  const live = await db.select({ s: botSessions, title: meetings.title }).from(botSessions)
    .innerJoin(meetings, eq(meetings.id, botSessions.meetingId))
    .where(and(eq(meetings.ownerId, user.id), inArray(botSessions.state, [...BOT_ACTIVE_STATES]))).orderBy(desc(botSessions.createdAt));
  const cap = live.length ? await botCapacity(db) : { alive: 0, busy: 0 };
  const failing = conns.find((c) => c.lastError);
  const lastSync = conns.map((c) => c.lastSyncedAt).filter(Boolean).sort().pop();

  return (
    <div className="max-w-3xl space-y-8">
      {live.length > 0 && <AutoRefresh ms={3000} />}
      {live.length > 0 && (
        <section className="space-y-2">
          {live.map(({ s, title }) => (
            <Link key={s.id} href={`/meetings/${s.meetingId}`} className="flex items-center justify-between rounded-lg border border-accent/50 bg-accent/10 p-4 hover:bg-accent/15">
              <div><div className="font-medium">{title}</div><div className="text-sm text-muted">{botStatusText(s, cap)}</div></div>
              <span className={`h-2.5 w-2.5 rounded-full ${s.state === "recording" ? "animate-pulse bg-red-500" : "bg-amber-500"}`} />
            </Link>
          ))}
        </section>
      )}
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
                {e.meetingUrl && e.platform === "meet" && <RecordToggle eventId={e.id} record={e.record} />}
                {e.meetingUrl && e.platform !== "meet" && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted" title="Milo can only join Google Meet calls so far">Meet only for now</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConnectIcsForm />
      <section className="flex flex-wrap items-start gap-3">
        <SendMilo />
        <UploadButton />
      </section>
      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">My calls</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {recent.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex items-center justify-between p-4 hover:bg-bg">
                  <div>
                    <div className="font-medium">{m.title}</div>
                    <div className="text-sm text-muted">{m.createdAt.toLocaleString()} · {m.captureSource}</div>
                  </div>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{m.status === "ready" ? "Ready" : m.status === "failed" ? "Failed" : "Processing"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
