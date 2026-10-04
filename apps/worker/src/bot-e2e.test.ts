// End-to-end: real bot container + mock Meet + web API + worker pipeline + Postgres.
// Needs: postgres, web (BOT_TOKEN set), worker (STT_PROVIDER=fake LLM_PROVIDER=fake), the `bot` container, and the mock server:
//   MOCK_AUDIO=<speech.m4a> node apps/bot/test/mock-meet/server.mjs 8801
// Run: npx tsx --env-file=.env apps/worker/src/bot-e2e.test.ts
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS, CONSENT_MESSAGE, type BotJob } from "@milo/core";
import { getDb, users, preferences, meetings, botSessions, recordings, speakers, participants, transcriptSegments } from "@milo/db";
import { LocalStorage } from "@milo/providers";

const MOCK = "http://localhost:8801", MOCK_FROM_BOT = "http://host.docker.internal:8801";
const db = getDb(), boss = new PgBoss(process.env.DATABASE_URL!);
let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const control = (code: string, b: object) => fetch(`${MOCK}/control/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()) as Promise<any>;
const room = (code: string) => fetch(`${MOCK}/state/${code}`).then((r) => r.json()) as Promise<any>;
async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 90_000, every = 700): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for: ${what}`); await sleep(every); }
}

await boss.start();
await boss.createQueue(BOT_JOIN_QUEUE, { name: BOT_JOIN_QUEUE, ...BOT_QUEUE_OPTIONS } as never);
const [user] = await db.insert(users).values({ email: `bot-e2e-${Date.now()}@milo.local` }).returning();
await db.insert(preferences).values({ userId: user!.id, onboarded: true });

async function start(code: string, mode?: string) {
  await control(code, { do: "reset" }); if (mode) await control(code, { do: "mode", mode });
  const [m] = await db.insert(meetings).values({ ownerId: user!.id, title: `e2e ${code}`, status: "scheduled", captureSource: "bot" }).returning();
  const [s] = await db.insert(botSessions).values({ meetingId: m!.id, meetingUrl: `${MOCK_FROM_BOT}/m/${code}`, platform: "meet" }).returning();
  const job: BotJob = { botSessionId: s!.id, meetingId: m!.id, url: `${MOCK_FROM_BOT}/m/${code}`, platform: "meet", displayName: "Milo AI Notetaker", consentMessage: CONSENT_MESSAGE };
  await boss.send(BOT_JOIN_QUEUE, job, BOT_QUEUE_OPTIONS);
  const session = async () => (await db.select().from(botSessions).where(eq(botSessions.id, s!.id)))[0]!;
  const meeting = async () => (await db.select().from(meetings).where(eq(meetings.id, m!.id)))[0]!;
  return { m: m!, s: s!, session, meeting };
}

try {
  // ---------------- A. happy path ----------------
  console.log("A. admitted, talks, ends -> full pipeline");
  const A = await start("e2e-happy");
  await until("waiting room reported", async () => (await A.session()).state === "waiting_room");
  check((await room("e2e-happy")).state === "waiting" && (await room("e2e-happy")).joinedAs === "Milo AI Notetaker", "bot asked to join under the name 'Milo AI Notetaker'");
  await control("e2e-happy", { do: "admit" });
  await until("recording reported", async () => (await A.session()).state === "recording");
  check((await A.meeting()).status === "recording", "meeting marked recording");
  await control("e2e-happy", { do: "others", count: 2 });
  await until("consent message in chat", async () => (await room("e2e-happy")).messages.some((x: any) => x.from === "Milo AI Notetaker"), 30_000);
  check((await room("e2e-happy")).messages.find((x: any) => x.from === "Milo AI Notetaker").text === CONSENT_MESSAGE, "consent message posted in the meeting chat");
  const script = [["Ada", "Good morning everyone, let us start."], ["Bob", "I will send the notes after the call."], ["Ada", "Great, thanks Bob."], ["Bob", "One more thing about pricing."]];
  for (const [name, text] of script) { await control("e2e-happy", { do: "caption", name, text }); await sleep(6500); }
  await control("e2e-happy", { do: "chat", from: "Ada", text: "/milo highlight" });
  await sleep(1500);
  await control("e2e-happy", { do: "end" });
  await until("session left", async () => (await A.session()).state === "left", 60_000);
  const meetingA = await until("meeting processed", async () => { const x = await A.meeting(); return x.status === "ready" ? x : x.status === "failed" ? (() => { throw new Error("meeting failed"); })() : undefined; }, 180_000, 2000);
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, A.m.id));
  check(!!rec?.sidecarKey && (rec.durationMs ?? 0) > 20_000, `recording stored with sidecar, ${Math.round((rec?.durationMs ?? 0) / 1000)}s`);
  const storage = new LocalStorage();
  const out = execFileSync("ffmpeg", ["-i", await storage.toLocalFile(rec!.playableKey!), "-af", "volumedetect", "-vn", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString() + "";
  void out;
  const vol = (() => { try { execFileSync("ffmpeg", ["-i", "x"], { stdio: "ignore" }); } catch {} return null; })(); void vol;
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", await storage.toLocalFile(rec!.playableKey!)]).toString());
  check(info.streams.some((s: any) => s.codec_type === "video") && info.streams.some((s: any) => s.codec_type === "audio"), "playable file has video and audio");
  const side = JSON.parse((await storage.read(rec!.sidecarKey!)[Symbol.asyncIterator]().next()).value.toString());
  check(side.endedBy === "ended" && side.captions.length >= 3 && side.chat.some((c: any) => c.text === "/milo highlight"), `sidecar: ${side.captions.length} captions, chat captured, endedBy ${side.endedBy}`);
  check(side.speakerEvents.some((e: any) => e.name === "Ada") && side.speakerEvents.some((e: any) => e.name === "Bob"), "sidecar has speaker events for both people");
  const sp = await db.select().from(speakers).where(eq(speakers.meetingId, A.m.id));
  const names = sp.map((x) => x.label);
  check(names.includes("Ada") && names.includes("Bob"), `speakers named from captions (got ${names.join(", ")})`);
  const people = await db.select().from(participants).where(eq(participants.meetingId, A.m.id));
  check(people.length >= 1 && !people.some((p) => /milo/i.test(p.name)), `participants stored without the bot (${people.map((p) => p.name).join(", ") || "none"})`);
  check((await db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, A.m.id))).length > 0, "transcript produced");
  void meetingA;

  // ---------------- B. removed mid-call: partial recording still processed ----------------
  console.log("B. removed mid-call");
  await control("e2e-removed", { do: "reset" }); await control("e2e-removed", { do: "mode", mode: "nowait" });
  const B = await start("e2e-removed", "nowait");
  await until("recording", async () => (await B.session()).state === "recording");
  await sleep(22_000);
  await control("e2e-removed", { do: "remove" });
  await until("session left", async () => (await B.session()).state === "left", 60_000);
  await until("partial recording processed", async () => (await B.meeting()).status === "ready", 180_000, 2000);
  const [recB] = await db.select().from(recordings).where(eq(recordings.meetingId, B.m.id));
  check((recB?.durationMs ?? 0) > 12_000, `partial recording kept (${Math.round((recB?.durationMs ?? 0) / 1000)}s)`);

  // ---------------- C. refusals ----------------
  for (const [code, mode, reason] of [["e2e-denied", "denied", "denied"], ["e2e-blocked", "blocked", "guests_blocked"], ["e2e-captcha", "captcha", "captcha"]] as const) {
    console.log(`C. ${mode}`);
    const C = await start(code, mode);
    await until(`${mode} -> failed`, async () => (await C.session()).state === "failed", 90_000);
    check((await C.session()).reason === reason, `reported reason '${(await C.session()).reason}' (wanted '${reason}')`);
    check(!(await db.select().from(recordings).where(eq(recordings.meetingId, C.m.id))).length && (await C.meeting()).status === "failed", "no recording, meeting marked failed");
  }

  // ---------------- D. never admitted (container runs with a short BOT_JOIN_TIMEOUT_MS) ----------------
  console.log("D. host never admits");
  const D = await start("e2e-nobody");
  await until("waiting room", async () => (await D.session()).state === "waiting_room");
  await until("timed out", async () => (await D.session()).state === "failed", 120_000);
  check((await D.session()).reason === "not_admitted", `reported reason '${(await D.session()).reason}'`);
} catch (e) {
  console.error("  FAIL", e instanceof Error ? e.message : e); fails++;
} finally {
  for (const m of await db.select().from(meetings).where(eq(meetings.ownerId, user!.id))) await db.delete(meetings).where(eq(meetings.id, m.id));
  await db.delete(users).where(eq(users.id, user!.id));
  await boss.stop({ graceful: false }); 
}
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
