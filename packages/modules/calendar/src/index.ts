import { eq, sql } from "drizzle-orm";
import { calendarConnections, calendarEvents, type Db } from "@milo/db";
import { GoogleCalendar, IcsCalendar, MicrosoftCalendar, type CalendarProvider } from "@milo/providers";

function providerFor(conn: typeof calendarConnections.$inferSelect): CalendarProvider | null {
  if (conn.kind === "ics" && conn.icsUrl) return new IcsCalendar(conn.icsUrl);
  if (conn.kind === "google" && conn.refreshToken) {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
    if (!clientId || !clientSecret) throw new Error("Google credentials are not configured on the server");
    return new GoogleCalendar({ clientId, clientSecret, refreshToken: conn.refreshToken });
  }
  if (conn.kind === "microsoft" && conn.refreshToken) {
    const { AZURE_AD_CLIENT_ID: clientId, AZURE_AD_CLIENT_SECRET: clientSecret, AZURE_AD_TENANT_ID: tenant } = process.env;
    if (!clientId || !clientSecret) throw new Error("Microsoft credentials are not configured on the server");
    return new MicrosoftCalendar({ clientId, clientSecret, refreshToken: conn.refreshToken, tenant: tenant || "common" });
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
        attendees: e.attendees, organizerEmail: e.organizerEmail ?? null, meetingUrl: e.meetingUrl, platform: e.platform,
      }).onConflictDoUpdate({
        target: [calendarEvents.connectionId, calendarEvents.externalId],
        set: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, attendees: e.attendees, organizerEmail: e.organizerEmail ?? null, meetingUrl: e.meetingUrl, platform: e.platform },
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

/** Called at OAuth sign-in. Keeps one connection of that kind per user and refreshes its token (providers only return one on consent). */
export async function saveOAuthConnection(db: Db, userId: string, kind: "google" | "microsoft", refreshToken: string | undefined) {
  const [existing] = await db.select().from(calendarConnections).where(sql`${calendarConnections.userId} = ${userId} and ${calendarConnections.kind} = ${kind}`);
  if (existing) {
    if (refreshToken) await db.update(calendarConnections).set({ refreshToken, lastError: null }).where(eq(calendarConnections.id, existing.id));
    return existing.id;
  }
  if (!refreshToken) return null;
  return (await db.insert(calendarConnections).values({ userId, kind, refreshToken }).returning())[0]!.id;
}
export const saveGoogleConnection = (db: Db, userId: string, refreshToken: string | undefined) => saveOAuthConnection(db, userId, "google", refreshToken);
export * from "./bot";
