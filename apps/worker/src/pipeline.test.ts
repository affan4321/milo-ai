// Integration: media -> transcription on a real file against Postgres.
// Run: npx tsx --env-file=.env apps/worker/src/pipeline.test.ts <sample.mp4>
import { eq } from "drizzle-orm";
import { getDb, users, meetings, recordings, transcriptSegments, speakers, pipelineStage, summaries, actionItems, chapters } from "@milo/db";
import { LocalStorage, FakeStt, FakeLlm } from "@milo/providers";
import { generateInsights, getOrCreateSummary } from "@milo/intelligence";
import { processMedia } from "@milo/media";
import { transcribeRecording } from "@milo/transcription";
import fs from "node:fs";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

const file = process.argv[2]!;
const db = getDb(), storage = new LocalStorage();
const assert = (c: unknown, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

const [u] = await db.insert(users).values({ email: `pipe-${Date.now()}@milo.local` }).returning();
const [m] = await db.insert(meetings).values({ ownerId: u!.id, title: "pipeline test", status: "processing", captureSource: "upload" }).returning();
const [r] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: `meetings/${m!.id}/raw${file.slice(file.lastIndexOf("."))}` }).returning();
await storage.putStream(r!.rawKey!, fs.createReadStream(file));

const t0 = Date.now();
const media = await processMedia(db, storage, r!.id);
console.log("media", media, `${Date.now() - t0}ms`);
const out = await transcribeRecording(db, storage, new FakeStt(), r!.id);
console.log("transcript", out);
const segs = await db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, m!.id));
const sp = await db.select().from(speakers).where(eq(speakers.meetingId, m!.id));
assert(segs.length === out.segments && segs.length > 0, "segments stored");
assert(segs.every((s) => s.endMs > s.startMs && s.speakerId), "segments have times and speakers");
assert(await storage.size(`meetings/${m!.id}/playable.mp4`), "playable stored");
// idempotent: re-running replaces rather than duplicates
await transcribeRecording(db, storage, new FakeStt(), r!.id);
assert((await db.select().from(transcriptSegments).where(eq(transcriptSegments.meetingId, m!.id))).length === segs.length, "rerun is idempotent");
const stages = await db.select().from(pipelineStage).where(eq(pipelineStage.recordingId, r!.id));
assert(stages.every((s) => s.status === "done"), "stages done");
console.log("speakers:", sp.length, "stages:", stages.map((s) => `${s.stage}:${s.status}x${s.attempts}`).join(" "));

// intelligence: one call fills summary + action items + chapters; every cited time is inside the recording
const llm = new FakeLlm();
const ins = await generateInsights(db, llm, r!.id);
const sum = await db.select().from(summaries).where(eq(summaries.meetingId, m!.id));
const items = await db.select().from(actionItems).where(eq(actionItems.meetingId, m!.id));
const chs = await db.select().from(chapters).where(eq(chapters.meetingId, m!.id));
assert(sum.length === 1 && sum[0]!.templateKey === "general", "summary stored under default template");
assert(sum[0]!.content.sections.flatMap((x) => x.bullets).every((b) => b.ms === undefined || (b.ms >= 0 && b.ms <= media.durationMs)), "bullet times inside recording");
assert(items.length === ins.actionItems && items.length > 0 && chs.length === ins.chapters && chs[0]!.startMs === 0, "action items + chapters stored");
await db.update(actionItems).set({ done: true }).where(eq(actionItems.id, items[0]!.id));
await generateInsights(db, llm, r!.id);
const items2 = await db.select().from(actionItems).where(eq(actionItems.meetingId, m!.id));
assert(items2.length === items.length && items2.filter((i) => i.done).length === 1, "rerun keeps ticked action items and doesn't duplicate");
// template switch: separate cache entry, second call served from cache
const a = await getOrCreateSummary(db, llm, m!.id, "sales-discovery", u!.id);
const cacheBefore = (await db.select().from(summaries).where(eq(summaries.meetingId, m!.id))).length;
await getOrCreateSummary(db, llm, m!.id, "sales-discovery", u!.id);
assert(a.sections.length > 0 && cacheBefore === 2 && (await db.select().from(summaries).where(eq(summaries.meetingId, m!.id))).length === 2, "template cached per meeting");
let badTpl = false; try { await getOrCreateSummary(db, llm, m!.id, "custom-doesnotexist", u!.id); } catch { badTpl = true; } assert(badTpl, "unknown template rejected");

// failure path: a file with no audio fails the media stage with a readable error and records it
const [r2] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: `meetings/${m!.id}/silent.mp4` }).returning();
await storage.putStream(r2!.rawKey!, fs.createReadStream(file.replace(/\.mp4$/, "-silent.mp4")));
let failed = false; try { await processMedia(db, storage, r2!.id); } catch { failed = true; }
const [st] = await db.select().from(pipelineStage).where(eq(pipelineStage.recordingId, r2!.id));
assert(failed && st!.status === "failed" && /no audio/i.test(st!.error ?? ""), "no-audio file fails with readable error");
await db.delete(meetings).where(eq(meetings.id, m!.id)); // cascades to recordings, segments, stages
await db.delete(users).where(eq(users.id, u!.id));
console.log("ok"); process.exit(0);
