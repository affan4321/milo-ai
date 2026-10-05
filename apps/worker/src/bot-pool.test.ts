// Concurrency: N bot replicas, N+1 simultaneous meetings. Needs the same setup as bot-e2e.test.ts, plus `docker compose up -d --scale bot=2 bot`.
// Run: npx tsx --env-file=.env apps/worker/src/bot-pool.test.ts
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS, CONSENT_MESSAGE, type BotJob } from "@milo/core";
import { getDb, users, preferences, meetings, botSessions, botWorkers, recordings } from "@milo/db";
import { botCapacity } from "@milo/calendar";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

const MOCK = "http://localhost:8801", FROM_BOT = "http://host.docker.internal:8801";
const REPLICAS = Number(process.env.REPLICAS ?? 2);
const db = getDb(), boss = new PgBoss(process.env.DATABASE_URL!);
let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const control = (code: string, b: object) => fetch(`${MOCK}/control/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`); await sleep(700); }
}

await boss.start();
await boss.createQueue(BOT_JOIN_QUEUE, { name: BOT_JOIN_QUEUE, ...BOT_QUEUE_OPTIONS } as never);
const [user] = await db.insert(users).values({ email: `pool-${Date.now()}@milo.local` }).returning();
await db.insert(preferences).values({ userId: user!.id, onboarded: true });
const sessions: { code: string; id: string; meetingId: string }[] = [];

try {
  await db.delete(botWorkers); // forget bots from earlier runs; live ones re-register on their next beat (every 15 s)
  await until(`${REPLICAS} bots reporting`, async () => (await botCapacity(db)).alive >= REPLICAS, 90_000);
  check(true, `${REPLICAS} bot replicas are alive and reporting`);

  const N = REPLICAS + 1;
  for (let i = 1; i <= N; i++) {
    const code = `pool-${Date.now() % 100000}-${i}`;
    await control(code, { do: "reset" }); await control(code, { do: "mode", mode: "nowait" });
    const [m] = await db.insert(meetings).values({ ownerId: user!.id, title: `pool ${i}`, status: "scheduled", captureSource: "bot" }).returning();
    const url = `${FROM_BOT}/m/${code}`;
    const [s] = await db.insert(botSessions).values({ meetingId: m!.id, meetingUrl: url, platform: "meet" }).returning();
    await boss.send(BOT_JOIN_QUEUE, { botSessionId: s!.id, meetingId: m!.id, url, platform: "meet", displayName: "Milo AI Notetaker", consentMessage: CONSENT_MESSAGE } as BotJob, BOT_QUEUE_OPTIONS);
    sessions.push({ code, id: s!.id, meetingId: m!.id });
  }
  const states = async () => Promise.all(sessions.map(async (s) => (await db.select().from(botSessions).where(eq(botSessions.id, s.id)))[0]!.state));

  await until(`${REPLICAS} recording at once`, async () => (await states()).filter((x) => x === "recording").length === REPLICAS, 90_000);
  const st = await states();
  check(st.filter((x) => x === "recording").length === REPLICAS && st.filter((x) => x === "scheduled").length === 1, `${REPLICAS} meetings recorded at the same time, 1 queued (${st.join(", ")})`);
  const cap = await botCapacity(db);
  check(cap.alive === REPLICAS && cap.busy === REPLICAS, `capacity shows all ${REPLICAS} bots busy (${JSON.stringify(cap)})`);
  const workers = await db.select().from(botWorkers);
  check(new Set(workers.map((w) => w.id)).size === REPLICAS && workers.filter((w) => w.busy).every((w) => !!w.sessionId), "each bot has its own id and reports which meeting it is in");

  // profile isolation: every replica works in its own directory
  const ids = execFileSync("docker", ["compose", "ps", "-q", "bot"]).toString().trim().split("\n").filter(Boolean);
  // PID 1 is the bot process; the entrypoint exported BOT_PROFILE_DIR only into its environment, not into `docker exec` shells.
  const dirs = ids.map((id) => execFileSync("docker", ["exec", id, "sh", "-c", "tr '\\0' '\\n' < /proc/1/environ | grep '^BOT_PROFILE_DIR=' | cut -d= -f2; ls /work/profile | head -3 | tr '\\n' ' '"]).toString().trim().split("\n"));
  check(ids.length === REPLICAS && dirs.every((d) => d[0] === "/work/profile") && dirs.every((d) => (d[1] ?? "").length > 0), "each container works in its own copy of the profile (/work/profile, populated)");

  // free a bot: the queued meeting must pick it up
  const first = sessions[st.indexOf("recording")]!;
  await sleep(13_000); // the bot drops recordings shorter than 10 s as "too short"
  await control(first.code, { do: "end" });
  await until("first meeting left", async () => (await db.select().from(botSessions).where(eq(botSessions.id, first.id)))[0]!.state === "left", 60_000);
  const queued = sessions[(await states()).indexOf("scheduled") >= 0 ? (await states()).indexOf("scheduled") : st.indexOf("scheduled")]!;
  await until("queued meeting starts recording once a bot is free", async () => (await db.select().from(botSessions).where(eq(botSessions.id, queued.id)))[0]!.state === "recording", 60_000);
  check(true, "the queued meeting started recording as soon as a bot freed up");

  await sleep(14_000); // long enough to be worth keeping (the bot drops recordings under 10 s)
  for (const s of sessions) await control(s.code, { do: "end" });
  await until("all sessions left", async () => (await states()).every((x) => x === "left"), 90_000);
  await until("all recordings handed over", async () => (await db.select().from(recordings).where(eq(recordings.meetingId, sessions[0]!.meetingId))).length > 0
    && (await Promise.all(sessions.map(async (s) => (await db.select().from(recordings).where(eq(recordings.meetingId, s.meetingId))).length))).every((n) => n === 1), 90_000);
  check(true, `all ${N} meetings ended with a recording handed over`);
} catch (e) {
  console.error("  FAIL", e instanceof Error ? e.message : e); fails++;
} finally {
  for (const m of await db.select().from(meetings).where(eq(meetings.ownerId, user!.id))) await db.delete(meetings).where(eq(meetings.id, m.id));
  await db.delete(users).where(eq(users.id, user!.id));
  await boss.stop({ graceful: false });
}
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
