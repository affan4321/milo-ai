// End-to-end: real bot container + mock Meet + web API + worker pipeline + Postgres.
// Needs: postgres, web (BOT_TOKEN set), worker (STT_PROVIDER=fake LLM_PROVIDER=fake), the `bot` container, and the mock server:
//   MOCK_AUDIO=<speech.m4a> node apps/bot/test/mock-meet/server.mjs 8801
// Run: npx tsx --env-file=.env apps/worker/src/bot-e2e.test.ts
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS, CONSENT_MESSAGE, type BotJob } from "@milo/core";
import { getDb, users, preferences, meetings, botSessions, recordings, speakers, participants, transcriptSegments, highlights } from "@milo/db";
import { addLiveHighlight } from "@milo/sharing";
import { LocalStorage } from "@milo/providers";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

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
  await sleep(5000); // the waiting room has a "Leave call" button just like a real call: the bot must NOT start recording until admitted
  check((await A.session()).state === "waiting_room" && (await A.meeting()).status !== "recording", "still in the waiting room after 5s: not recording yet");
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
  const endedAt = Date.now();
  await control("e2e-happy", { do: "end" });
  await until("session left", async () => (await A.session()).state === "left", 60_000);
  const leaveSecs = (Date.now() - endedAt) / 1000;
  check(leaveSecs < 12, `bot notices the call ended and leaves quickly (${leaveSecs.toFixed(1)}s)`);
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

  // ---------------- E. one other person talking: every speaker label must become that person ----------------
  console.log("E. bot + one person (the real-call 'Speaker 1' regression)");
  await control("e2e-solo", { do: "reset" }); await control("e2e-solo", { do: "mode", mode: "nowait" }); await control("e2e-solo", { do: "others", count: 1 });
  const E = await start("e2e-solo", "nowait"); await control("e2e-solo", { do: "others", count: 1 });
  await until("recording", async () => (await E.session()).state === "recording");
  for (let i = 0; i < 7; i++) { await control("e2e-solo", { do: "caption", name: "Ada", text: `this is sentence number ${i} said by one person` }); await sleep(3200); }
  await control("e2e-solo", { do: "end" });
  await until("session left", async () => (await E.session()).state === "left", 60_000);
  await until("processed", async () => (await E.meeting()).status === "ready", 180_000, 2000);
  const spE = (await db.select().from(speakers).where(eq(speakers.meetingId, E.m.id))).map((x) => x.label);
  check(spE.length === 1 && spE[0] === "Ada", `a one-person call has exactly one speaker, named (got: ${spE.join(", ")})`);

  // ---------------- F. everyone else leaves: the bot must follow within seconds ----------------
  console.log("F. last person leaves -> bot leaves promptly");
  await control("e2e-alone", { do: "reset" }); await control("e2e-alone", { do: "mode", mode: "nowait" });
  const F = await start("e2e-alone", "nowait"); await control("e2e-alone", { do: "others", count: 2 });
  await until("recording", async () => (await F.session()).state === "recording");
  await sleep(14_000);                                   // long enough to be a real recording, and for the bot to see others present
  const goneAt = Date.now();
  await control("e2e-alone", { do: "others", count: 0 });  // everyone else leaves; the call itself keeps going
  await until("bot leaves on its own", async () => (await F.session()).state === "left", 60_000);
  const aloneSecs = (Date.now() - goneAt) / 1000;
  check(aloneSecs < 30, `bot left ${aloneSecs.toFixed(1)}s after the last person left (grace 15s + a few seconds)`);

  // ---------------- G. highlights: chat command and live button ----------------
  console.log("G. highlights from the meeting chat and from the live button");
  await control("e2e-hl", { do: "reset" }); await control("e2e-hl", { do: "mode", mode: "nowait" }); await control("e2e-hl", { do: "others", count: 2 });
  const G = await start("e2e-hl", "nowait"); await control("e2e-hl", { do: "others", count: 2 });
  await until("recording with clock", async () => { const x = await G.session(); return x.state === "recording" && !!x.recordingStartedAt; });
  const clock = +(await G.session()).recordingStartedAt!;
  await sleep(15_000);
  const cmdAt = Date.now() - clock;
  await control("e2e-hl", { do: "chat", from: "Ada", text: "/milo highlight budget concern" });
  const hl1 = await until("chat highlight saved", async () => (await db.select().from(highlights).where(eq(highlights.meetingId, G.m.id)))[0], 30_000);
  check(hl1.source === "chat_command" && hl1.note === "budget concern" && hl1.createdBy === "Ada", `chat command saved with note and sender (${hl1.source}, '${hl1.note}', ${hl1.createdBy})`);
  check(Math.abs(hl1.endMs - cmdAt) < 4000 && hl1.startMs === Math.max(0, hl1.endMs - 30_000), `highlight lands on the recording clock: ends ${hl1.endMs}ms, expected about ${cmdAt}ms, covers 30 s`);
  await until("bot confirmed in chat", async () => (await room("e2e-hl")).messages.some((x: any) => x.from === "Milo AI Notetaker" && /Highlight saved/.test(x.text)), 20_000);
  check(true, "bot confirmed the highlight in the meeting chat");
  await sleep(1500);
  check((await db.select().from(highlights).where(eq(highlights.meetingId, G.m.id))).length === 1, "the bot's own confirmation did not create another highlight");
  await sleep(8_000);
  const live = await addLiveHighlight(db, G.m.id, { createdBy: "owner" });
  check("highlight" in live && live.created && live.highlight.source === "live_button" && Math.abs(live.highlight.endMs - (Date.now() - clock)) < 3000, "live Highlight button saves the last 30 s of the running recording");
  check((await G.session()).participantCount === 3, `participant count reported to the app (${(await G.session()).participantCount})`);
  await control("e2e-hl", { do: "end" });
  await until("left", async () => (await G.session()).state === "left", 60_000);
  check((await addLiveHighlight(db, G.m.id, {}) as any).error !== undefined, "after the bot leaves, the live button refuses");
  await until("processed", async () => (await G.meeting()).status === "ready", 180_000, 2000);
  check((await db.select().from(highlights).where(eq(highlights.meetingId, G.m.id))).length === 2, "both highlights kept after processing");

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
