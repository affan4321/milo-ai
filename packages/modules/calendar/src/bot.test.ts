// Run: npx tsx --env-file=.env packages/modules/calendar/src/bot.test.ts
import { eq } from "drizzle-orm";
import { getDb, users, preferences, calendarConnections, calendarEvents, meetings, botSessions, botWorkers } from "@milo/db";
import { planBotJoins, shouldRecord, createBotSession, applyBotState, reapStaleBotSessions, recordWorkerBeat, botCapacity } from "./bot";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

// rule matrix (pure)
const ev = (o: string | null, ...att: string[]) => ({ organizerEmail: o, attendees: att.map((email) => ({ email })) });
check(shouldRecord("all", "me@acme.io", ev(null)), "all records everything");
check(!shouldRecord("none", "me@acme.io", ev("me@acme.io", "x@y.com")), "none never records");
check(!shouldRecord("bogus", "me@acme.io", ev("me@acme.io")), "unknown rule never records");
check(shouldRecord("owned", "Me@Acme.io", ev("me@acme.io")), "owned: organizer match is case-insensitive");
check(!shouldRecord("owned", "me@acme.io", ev("boss@acme.io")) && !shouldRecord("owned", "me@acme.io", ev(null)), "owned: other organizer or unknown organizer does not record");
check(shouldRecord("external", "me@acme.io", ev(null, "a@acme.io", "c@client.com")), "external: one outside attendee is enough");
check(!shouldRecord("external", "me@acme.io", ev(null, "a@acme.io", "b@ACME.io")), "external: all-internal does not record");
check(!shouldRecord("external", "me@acme.io", ev(null)), "external: no attendee info does not record");

// scheduler against a real DB
const db = getDb();
const stamp = Date.now();
const [u] = await db.insert(users).values({ email: `sched-${stamp}@acme.io` }).returning();
await db.insert(preferences).values({ userId: u!.id, onboarded: true, autoRecordRule: "all" });
const [conn] = await db.insert(calendarConnections).values({ userId: u!.id, kind: "ics", icsUrl: "http://x" }).returning();
const now = new Date();
const mk = (id: string, startMin: number, durMin: number, url: string | null, platform = "meet", record = true) => ({
  connectionId: conn!.id, externalId: id, title: id, startsAt: new Date(+now + startMin * 60_000), endsAt: new Date(+now + (startMin + durMin) * 60_000),
  attendees: [{ email: "x@client.com" }], organizerEmail: u!.email, meetingUrl: url, platform, record,
});
await db.insert(calendarEvents).values([
  mk("starting-now", 1, 30, `https://meet.google.com/aaa-bbbb-${stamp % 1000}`),
  mk("later", 60, 30, "https://meet.google.com/lat-eeee-eee"),
  mk("already-over", -60, 30, "https://meet.google.com/old-oooo-ooo"),
  mk("almost-over", -28, 30, "https://meet.google.com/alm-ostt-ove"),
  mk("no-link", 1, 30, null, "unknown"),
  mk("zoom", 1, 30, "https://zoom.us/j/123456789", "zoom"),
  mk("unsupported", 1, 30, "https://example.com/call", "webex"),
  mk("opted-out", 1, 30, "https://meet.google.com/opt-outt-out", "meet", false),
]);
let jobs = await planBotJoins(db, now);
check(jobs.length === 2 && jobs.some((j) => j.url.includes("aaa-bbbb")) && jobs.some((j) => j.platform === "zoom"), `only meetings starting now on supported platforms get a bot (Meet and Zoom) (got ${jobs.map((j) => j.url).join(", ")})`);
check(jobs[0]!.displayName === "Milo AI Notetaker" && !!jobs[0]!.consentMessage, "job names the bot and carries the consent message");
jobs = await planBotJoins(db, now); check(jobs.length === 0, "second run is a no-op (no duplicate bot)");

// owner turned the consent message off -> job carries none
await db.update(preferences).set({ consentMessage: false }).where(eq(preferences.userId, u!.id));
const [e2] = await db.insert(calendarEvents).values(mk("no-consent-msg", 1, 30, "https://meet.google.com/ncm-aaaa-aaa")).returning();
jobs = await planBotJoins(db, now); check(jobs.length === 1 && jobs[0]!.consentMessage === null, "consent message off -> none posted");

// rule none -> nothing; two users, same link -> one bot
await db.update(preferences).set({ autoRecordRule: "none" }).where(eq(preferences.userId, u!.id));
await db.insert(calendarEvents).values(mk("rule-none", 1, 30, "https://meet.google.com/rno-nenn-one"));
check((await planBotJoins(db, now)).length === 0, "rule 'none' schedules nothing");
const [u2] = await db.insert(users).values({ email: `sched2-${stamp}@acme.io` }).returning();
await db.insert(preferences).values({ userId: u2!.id, onboarded: true, autoRecordRule: "all" });
const [c2] = await db.insert(calendarConnections).values({ userId: u2!.id, kind: "ics", icsUrl: "http://y" }).returning();
await db.insert(calendarEvents).values({ ...mk("starting-now", 1, 30, `https://meet.google.com/aaa-bbbb-${stamp % 1000}`), connectionId: c2!.id });
check((await planBotJoins(db, now)).length === 0, "same link already has a bot -> second user doesn't add another");

// manual "Send Milo": validation
const bad = await createBotSession(db, { ownerId: u!.id, meetingUrl: "https://example.com/nope" }); check("error" in bad, "non-meeting link rejected");
const zoom = await createBotSession(db, { ownerId: u!.id, meetingUrl: "https://zoom.us/j/999" }); check("job" in zoom && zoom.job.platform === "zoom", "Zoom link accepted");
const teamsS = await createBotSession(db, { ownerId: u!.id, meetingUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0" }); check("job" in teamsS && teamsS.job.platform === "teams", "Teams link accepted");
const okS = await createBotSession(db, { ownerId: u!.id, meetingUrl: "  https://meet.google.com/abc-defg-hij?authuser=1 ", title: "Ad hoc" });
check("job" in okS && okS.job.url === "https://meet.google.com/abc-defg-hij?authuser=1" && okS.job.platform === "meet", "manual link accepted and trimmed");

// per-platform switch: a platform the owner turned off is never auto-recorded
await db.update(preferences).set({ autoRecordRule: "all", recordPlatforms: ["zoom", "teams"] }).where(eq(preferences.userId, u!.id));
await db.insert(calendarEvents).values(mk("meet-switched-off", 1, 30, "https://meet.google.com/swi-tchd-off"));
check((await planBotJoins(db, now)).length === 0, "platform switched off in settings -> no automatic join");
await db.update(preferences).set({ recordPlatforms: ["meet", "zoom", "teams"] }).where(eq(preferences.userId, u!.id));
// default visibility: new meetings can start out shared with the team
await db.update(preferences).set({ defaultVisibility: "team" }).where(eq(preferences.userId, u!.id));
const vis = await createBotSession(db, { ownerId: u!.id, meetingUrl: "https://meet.google.com/vis-ibil-ity" });
check((await db.select().from(meetings).where(eq(meetings.id, (vis as any).job.meetingId)))[0]!.visibility === "team", "default visibility 'team' applies to new meetings");
await db.update(preferences).set({ defaultVisibility: "private" }).where(eq(preferences.userId, u!.id));
const vis2 = await createBotSession(db, { ownerId: u!.id, meetingUrl: "https://meet.google.com/vis-ibil-two" });
check((await db.select().from(meetings).where(eq(meetings.id, (vis2 as any).job.meetingId)))[0]!.visibility === "private", "...and 'private' is the default otherwise");

// state machine + heartbeat + reaper
const sid = (okS as any).job.botSessionId as string, mid = (okS as any).job.meetingId as string;
const st = async () => (await db.select().from(botSessions).where(eq(botSessions.id, sid)))[0]!;
await applyBotState(db, sid, { state: "waiting_room" }); check((await st()).state === "waiting_room", "scheduled -> waiting_room");
await applyBotState(db, sid, { state: "joining" }); check((await st()).state === "waiting_room", "states never move backwards");
const t0 = (await st()).updatedAt; await new Promise((r) => setTimeout(r, 20)); await applyBotState(db, sid, { state: "waiting_room" });
check(+(await st()).updatedAt > +t0, "repeating a state is a heartbeat");
await applyBotState(db, sid, { state: "recording" });
check((await st()).state === "recording" && !!(await st()).startedAt && (await db.select().from(meetings).where(eq(meetings.id, mid)))[0]!.status === "recording", "recording sets session + meeting");
check(await reapStaleBotSessions(db, new Date()) === 0, "fresh session is not reaped");
check(await reapStaleBotSessions(db, new Date(Date.now() + 4 * 60_000)) >= 1, "silent session is reaped");
check((await st()).state === "failed" && (await st()).reason === "recording_error", "reaped recording session -> recording_error");
await applyBotState(db, sid, { state: "recording" }); check((await st()).state === "failed", "terminal state sticks");
check((await applyBotState(db, "00000000-0000-0000-0000-000000000000", { state: "joining" })).ok === false, "unknown session rejected");
// busy vs down: a queued ('scheduled') meeting waits when bots are alive but busy, and fails fast when none are running
await db.delete(botWorkers);
const q = async () => { const r = await createBotSession(db, { ownerId: u!.id, meetingUrl: `https://meet.google.com/qqq-${Math.random().toString(36).slice(2, 6)}-qqq` }); return (r as any).job.botSessionId as string; };
const stateOf = async (id: string) => (await db.select().from(botSessions).where(eq(botSessions.id, id)))[0]!;
const t = new Date(); const later = (min: number) => new Date(+t + min * 60_000);
let qid = await q();
check(await reapStaleBotSessions(db, later(1)) === 0 && (await stateOf(qid)).state === "scheduled", "a 1-minute-old queued session is left alone");
check(await reapStaleBotSessions(db, later(3)) >= 1 && (await stateOf(qid)).reason === "bot_unavailable", "no bots running -> failed as bot_unavailable after 2 min");
qid = await q();
await recordWorkerBeat(db, { id: "w1", busy: true, sessionId: "00000000-0000-0000-0000-000000000001" }, later(2.5));
await recordWorkerBeat(db, { id: "w2", busy: false }, later(2.5));
check(JSON.stringify(await botCapacity(db, later(3))) === '{"alive":2,"busy":1}', "capacity counts live and busy bots");
check(JSON.stringify(await botCapacity(db, later(5))) === '{"alive":0,"busy":0}', "bots that stop reporting stop counting");
await reapStaleBotSessions(db, later(3)); check((await stateOf(qid)).state === "scheduled", "bots alive but busy -> queued session keeps waiting");
await recordWorkerBeat(db, { id: "w1", busy: true }, later(10.5));
await reapStaleBotSessions(db, later(11)); check((await stateOf(qid)).state === "failed" && (await stateOf(qid)).reason === "bot_busy", "waited past the cap -> failed as bot_busy");
await db.delete(botWorkers);

for (const m of await db.select().from(meetings).where(eq(meetings.ownerId, u!.id))) await db.delete(meetings).where(eq(meetings.id, m.id));
for (const m of await db.select().from(meetings).where(eq(meetings.ownerId, u2!.id))) await db.delete(meetings).where(eq(meetings.id, m.id));
await db.delete(users).where(eq(users.id, u!.id)); await db.delete(users).where(eq(users.id, u2!.id));
void e2; void botSessions;
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
