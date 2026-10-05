// WARNING: spends real Gemini requests (a few embedding + 1-2 generation calls). Run deliberately.
// Live check that REAL embeddings find the right moment when the question shares no words with it.
// Run: npx tsx --env-file=.env apps/worker/src/search-live.test.ts
import { eq, sql } from "drizzle-orm";
import { getDb, users, meetings, recordings, speakers, transcriptSegments, ensureWorkspace, askThreads } from "@milo/db";
import { getProviders } from "@milo/providers";
import { indexRecording } from "@milo/indexing";
import { searchMeetings, askMilo } from "@milo/search";

const db = getDb(), llm = getProviders().llm;
console.log("embedding via:", process.env.GEMINI_EMBED_MODELS || "gemini-embedding-001", "| answers via:", process.env.GEMINI_MODEL);
const [u] = await db.insert(users).values({ email: `live-${Date.now()}@live-test.io` }).returning();
const [m] = await db.insert(meetings).values({ ownerId: u!.id, workspaceId: await ensureWorkspace(db, u!.id), title: "Weekly product sync", status: "ready", captureSource: "upload" }).returning();
const [rec] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: "x", durationMs: 900_000 }).returning();
const [ada, ben] = await db.insert(speakers).values([{ meetingId: m!.id, label: "Ada", displayName: "Ada" }, { meetingId: m!.id, label: "Ben", displayName: "Ben" }]).returning();
const lines: [typeof ada, string][] = [
  [ada, "Good morning everyone, let's get started with the agenda."],
  [ben, "We are shipping the new billing page on October twentieth, assuming QA signs off."],
  [ada, "The customer in Berlin is unhappy about how long support takes to reply."],
  [ben, "We should hire another person for the helpdesk to cut the response time."],
  [ada, "Engineering estimates the migration to the new database will take about three weeks."],
  [ben, "Marketing plans to announce everything with a launch email on Monday morning."],
  [ada, "Budget for the offsite is capped at fifteen thousand dollars."],
  [ben, "Let's circle back on the hiring plan after the board meeting."],
];
await db.insert(transcriptSegments).values(lines.map(([sp, text], i) => ({ meetingId: m!.id, speakerId: sp!.id, startMs: i * 30_000, endMs: i * 30_000 + 20_000, text, tsv: sql`to_tsvector('english', ${text})` as unknown as string })));
try {
  const r = await indexRecording(db, llm, rec!.id); console.log(`indexed ${r.embedded}/${r.segments} lines`);
  const tests: [string, string][] = [
    ["when does the cost page go live?", "billing page on October"],          // no shared words with the line
    ["which client is complaining?", "customer in Berlin"],
    ["how long will moving the data take?", "migration to the new database"],
    ["what is the spending limit for the team trip?", "offsite"],
    ["how do we speed up replies to users?", "hire another person for the helpdesk"],
  ];
  let good = 0, top3 = 0;
  for (const [q, want] of tests) {
    const res = await searchMeetings(db, llm, u!.id, { q, scope: "my" });
    const top = res.results[0]?.hits[0];
    const ok = !!top && top.text.includes(want); good += ok ? 1 : 0;
    const in3 = (res.results[0]?.hits ?? []).slice(0, 3).some((h) => h.text.includes(want)); top3 += in3 ? 1 : 0;
    console.log(`${ok ? "ok  " : in3 ? "top3" : "MISS"} "${q}" -> ${top ? `"${top.text.slice(0, 60)}…" (${top.via})` : "nothing"}${res.degraded ? " [degraded]" : ""}`);
  }
  console.log(`semantic top-1 correct: ${good}/${tests.length}, in top 3: ${top3}/${tests.length}`);
  const a: any = await askMilo(db, llm, u!.id, { question: "What is the launch date for the billing page, and who is announcing it?", scope: "my" });
  console.log("ASK ->", a.error ?? a.answer); if (a.citations) for (const c of a.citations) console.log(`  [${c.n}] ${c.speaker} @${Math.round(c.startMs / 1000)}s: ${c.snippet.slice(0, 70).replace(/\n/g, " ")}`);
} finally {
  await db.delete(askThreads).where(eq(askThreads.userId, u!.id)); await db.delete(meetings).where(eq(meetings.id, m!.id)); await db.execute(sql`delete from workspaces where name like '%-test.io' or id in (select workspace_id from memberships where user_id = ${u!.id})`).catch(() => {}); await db.delete(users).where(eq(users.id, u!.id)).catch(() => {});
}
process.exit(0);
