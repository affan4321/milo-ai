import { eq, sql } from "drizzle-orm";
import { calendarConnections, calendarEvents, type Db } from "@milo/db";
import { GoogleCalendar, IcsCalendar, type CalendarProvider } from "@milo/providers";

function providerFor(conn: typeof calendarConnections.$inferSelect): CalendarProvider | null {
  if (conn.kind === "ics" && conn.icsUrl) return new IcsCalendar(conn.icsUrl);
  if (conn.kind === "google" && conn.refreshToken) {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
    if (!clientId || !clientSecret) throw new Error("Google credentials are not configured on the server");
    return new GoogleCalendar({ clientId, clientSecret, refreshToken: conn.refreshToken });
  }
  return null;
}

/** Fetch a connection's events and upsert them. Failures are recorded on the connection, never thrown past the caller's UI. */
export async function syncConnection(db: Db, connectionId: string, provider?: CalendarProvider) {
  const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId));
  if (!conn) throw new Error("connection not found");
  try {
    const p = provider ?? providerFor(conn);
    if (!p) throw new Error(`no provider for connection kind "${conn.kind}"`);
    const events = await p.listUpcoming();
    for (const e of events) {
      await db.insert(calendarEvents).values({
        connectionId, externalId: e.externalId, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt,
        attendees: e.attendees, meetingUrl: e.meetingUrl, platform: e.platform,
      }).onConflictDoUpdate({
        target: [calendarEvents.connectionId, calendarEvents.externalId],
        set: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, attendees: e.attendees, meetingUrl: e.meetingUrl, platform: e.platform },
      });
    }
    await db.update(calendarConnections).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(calendarConnections.id, connectionId));
    return { synced: events.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(calendarConnections).set({ lastError: message }).where(eq(calendarConnections.id, connectionId));
    return { synced: 0, error: message };
  }
}

export async function connectIcs(db: Db, userId: string, icsUrl: string) {
  const url = icsUrl.trim().replace(/^webcal:/i, "https:");
  if (!/^https?:\/\//i.test(url)) throw new Error("Paste the secret iCal address (starts with https://)");
  const [existing] = await db.select().from(calendarConnections).where(sql`${calendarConnections.userId} = ${userId} and ${calendarConnections.icsUrl} = ${url}`);
  const conn = existing ?? (await db.insert(calendarConnections).values({ userId, kind: "ics", icsUrl: url }).returning())[0]!;
  return { connectionId: conn.id, ...(await syncConnection(db, conn.id)) };
}

/** Called at Google sign-in. Keeps one google connection per user and refreshes its token (Google only returns one on consent). */
export async function saveGoogleConnection(db: Db, userId: string, refreshToken: string | undefined) {
  const [existing] = await db.select().from(calendarConnections).where(sql`${calendarConnections.userId} = ${userId} and ${calendarConnections.kind} = 'google'`);
  if (existing) {
    if (refreshToken) await db.update(calendarConnections).set({ refreshToken, lastError: null }).where(eq(calendarConnections.id, existing.id));
    return existing.id;
  }
  if (!refreshToken) return null;
  return (await db.insert(calendarConnections).values({ userId, kind: "google", refreshToken }).returning())[0]!.id;
}
