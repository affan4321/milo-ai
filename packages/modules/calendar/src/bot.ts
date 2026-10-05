import { and, eq, gte, inArray, lt, lte, gt, ne, or, sql } from "drizzle-orm";
import { BOT_ACTIVE_STATES, BOT_NAME, CONSENT_MESSAGE, MAX_QUEUE_WAIT_MS, WORKER_ALIVE_MS, detectMeeting, type BotJob } from "@milo/core";
import { ensureWorkspace, botSessions, botWorkers, calendarConnections, calendarEvents, meetings, preferences, users, type Db } from "@milo/db";

/** Platforms the bot has a join script for. Zoom and Teams are added as their adapters land. */
export const SUPPORTED_PLATFORMS = ["meet"] as const;
const JOIN_LEAD_MS = 90_000;      // ask to join a minute and a half before the start
const MIN_REMAINING_MS = 3 * 60_000; // don't bother joining something that is about to end

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** The owner's auto-record rule applied to one event. Unknown information never turns recording ON. */
export function shouldRecord(rule: string, userEmail: string, ev: { organizerEmail?: string | null; attendees: { email: string }[] }): boolean {
  switch (rule) {
    case "all": return true;
    case "owned": return !!ev.organizerEmail && ev.organizerEmail.toLowerCase() === userEmail.toLowerCase();
    case "external": return ev.attendees.some((a) => domainOf(a.email) && domainOf(a.email) !== domainOf(userEmail));
    default: return false; // "none" and anything unrecognised
  }
}

/** Create the meeting + bot session for a link and return the job to queue. Used by "Send Milo" and by the scheduler. */
export async function createBotSession(db: Db, a: {
  ownerId: string; meetingUrl: string; title?: string; calendarEventId?: string; startedAt?: Date; consentMessage?: boolean;
}): Promise<{ job: BotJob } | { error: string }> {
  const link = detectMeeting(a.meetingUrl);
  if (!link) return { error: "That doesn't look like a Google Meet, Zoom or Teams link." };
  if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(link.platform)) return { error: `Milo can't join ${link.platform === "zoom" ? "Zoom" : "Teams"} calls yet. Google Meet works today.` };
  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, a.ownerId));
  const [meeting] = await db.insert(meetings).values({
    ownerId: a.ownerId, workspaceId: await ensureWorkspace(db, a.ownerId), calendarEventId: a.calendarEventId ?? null, title: a.title?.trim() || "Meeting", status: "scheduled", captureSource: "bot", startedAt: a.startedAt ?? new Date(),
  }).returning();
  const [session] = await db.insert(botSessions).values({ meetingId: meeting!.id, meetingUrl: link.url, platform: link.platform }).returning();
  const wantConsent = a.consentMessage ?? prefs?.consentMessage ?? true;
  return { job: { botSessionId: session!.id, meetingId: meeting!.id, url: link.url, platform: link.platform, displayName: BOT_NAME, consentMessage: wantConsent ? CONSENT_MESSAGE : null } };
}

/**
 * Which calendar events need a bot right now? Creates their meetings + sessions and returns jobs for the worker to queue.
 * Safe to run every minute: an event already linked to a meeting is skipped, and two users who invited the bot to the same
 * link within six hours don't put two bots in one call.
 */
export async function planBotJoins(db: Db, now = new Date()): Promise<BotJob[]> {
  const events = await db.select({ ev: calendarEvents, userId: calendarConnections.userId, email: users.email, rule: preferences.autoRecordRule, consent: preferences.consentMessage, onboarded: preferences.onboarded })
    .from(calendarEvents)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarEvents.connectionId))
    .innerJoin(users, eq(users.id, calendarConnections.userId))
    .innerJoin(preferences, eq(preferences.userId, users.id))
    .where(and(
      eq(calendarEvents.record, true), inArray(calendarEvents.platform, [...SUPPORTED_PLATFORMS]),
      lte(calendarEvents.startsAt, new Date(+now + JOIN_LEAD_MS)), gt(calendarEvents.endsAt, new Date(+now + MIN_REMAINING_MS)),
      sql`${calendarEvents.meetingUrl} is not null`,
    ));
  const jobs: BotJob[] = [];
  for (const r of events) {
    if (!r.onboarded || !r.ev.meetingUrl || !shouldRecord(r.rule, r.email, { organizerEmail: r.ev.organizerEmail, attendees: r.ev.attendees })) continue;
    const [already] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.calendarEventId, r.ev.id));
    if (already) continue;
    const url = detectMeeting(r.ev.meetingUrl)?.url ?? r.ev.meetingUrl;
    const [busy] = await db.select({ id: botSessions.id }).from(botSessions)
      .where(and(eq(botSessions.meetingUrl, url), gte(botSessions.createdAt, new Date(+now - 6 * 3_600_000)), inArray(botSessions.state, [...BOT_ACTIVE_STATES, "left"])));
    if (busy) continue;
    const res = await createBotSession(db, { ownerId: r.userId, meetingUrl: r.ev.meetingUrl, title: r.ev.title, calendarEventId: r.ev.id, startedAt: r.ev.startsAt, consentMessage: r.consent });
    if ("job" in res) jobs.push(res.job);
  }
  return jobs;
}

const ORDER = ["scheduled", "joining", "waiting_room", "recording"] as const;
const TERMINAL = ["left", "failed"];
export type BotStateUpdate = {
  state: "joining" | "waiting_room" | "recording" | "left" | "failed"; reason?: string;
  /** Epoch ms of recording time 0 (sent with "recording") and the current participant count (sent with any heartbeat). */
  recordingStartedAtMs?: number; participants?: number;
};

/**
 * Apply a state report from the bot. Repeating the current state is a heartbeat (bumps updatedAt). States never move backwards and
 * terminal states stick, so a late or duplicate report can't resurrect a finished session.
 */
export async function applyBotState(db: Db, sessionId: string, u: BotStateUpdate, now = new Date()): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const [s] = await db.select().from(botSessions).where(eq(botSessions.id, sessionId));
  if (!s) return { ok: false, error: "unknown session" };
  if (TERMINAL.includes(s.state)) return { ok: true, state: s.state };
  const cur = ORDER.indexOf(s.state as (typeof ORDER)[number]), next = ORDER.indexOf(u.state as (typeof ORDER)[number]);
  if (next >= 0 && cur > next) return { ok: true, state: s.state };
  await db.update(botSessions).set({
    state: u.state, reason: u.state === "failed" ? u.reason ?? "join_error" : null, updatedAt: now,
    ...(u.state === "recording" && s.state !== "recording" ? { startedAt: now } : {}),
    ...(u.state === "recording" && u.recordingStartedAtMs && Number.isFinite(u.recordingStartedAtMs) ? { recordingStartedAt: new Date(u.recordingStartedAtMs) } : {}),
    ...(typeof u.participants === "number" && u.participants >= 0 && u.participants < 10_000 ? { participantCount: Math.round(u.participants) } : {}),
  }).where(eq(botSessions.id, sessionId));
  if (u.state === "recording") await db.update(meetings).set({ status: "recording" }).where(eq(meetings.id, s.meetingId));
  if (u.state === "failed") await db.update(meetings).set({ status: "failed" }).where(and(eq(meetings.id, s.meetingId), inArray(meetings.status, ["scheduled", "recording"])));
  return { ok: true, state: u.state };
}

export async function recordWorkerBeat(db: Db, w: { id: string; busy: boolean; sessionId?: string | null }, now = new Date()) {
  await db.delete(botWorkers).where(lt(botWorkers.lastSeenAt, new Date(+now - 6 * 3_600_000))); // forget bots that vanished long ago
  await db.insert(botWorkers).values({ id: w.id, busy: w.busy, sessionId: w.sessionId ?? null, lastSeenAt: now })
    .onConflictDoUpdate({ target: botWorkers.id, set: { busy: w.busy, sessionId: w.sessionId ?? null, lastSeenAt: now } });
}

/** How many bots are running, and how many of them are in a meeting. Stale rows (crashed bots) don't count. */
export async function botCapacity(db: Db, now = new Date()): Promise<{ alive: number; busy: number }> {
  const live = await db.select().from(botWorkers).where(gte(botWorkers.lastSeenAt, new Date(+now - WORKER_ALIVE_MS)));
  return { alive: live.length, busy: live.filter((w) => w.busy).length };
}

/**
 * Sessions that stopped making progress fail with a plain reason instead of hanging on screen.
 * - active session whose bot went silent for 3 min: the bot crashed -> recording_error / bot_unavailable
 * - still 'scheduled' and NO bot is running (2 min): bot_unavailable
 * - still 'scheduled' while bots ARE running but all busy: keep waiting for a free one, up to MAX_QUEUE_WAIT_MS, then bot_busy
 */
export async function reapStaleBotSessions(db: Db, now = new Date()): Promise<number> {
  const { alive } = await botCapacity(db, now);
  const stale = await db.select().from(botSessions).where(and(
    inArray(botSessions.state, [...BOT_ACTIVE_STATES]),
    or(
      and(eq(botSessions.state, "scheduled"), lt(botSessions.createdAt, new Date(+now - 2 * 60_000))),
      and(ne(botSessions.state, "scheduled"), lt(botSessions.updatedAt, new Date(+now - 3 * 60_000))),
    ),
  ));
  let n = 0;
  for (const s of stale) {
    if (s.state === "scheduled" && alive > 0) {
      if (+now - +s.createdAt < MAX_QUEUE_WAIT_MS) continue; // a bot exists and is just busy: keep waiting
      await applyBotState(db, s.id, { state: "failed", reason: "bot_busy" }, now); n++; continue;
    }
    await applyBotState(db, s.id, { state: "failed", reason: s.state === "recording" ? "recording_error" : "bot_unavailable" }, now); n++;
  }
  return n;
}
