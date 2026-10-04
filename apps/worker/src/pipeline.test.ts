// Integration: media -> transcription on a real file against Postgres.
// Run: npx tsx --env-file=.env apps/worker/src/pipeline.test.ts <sample.mp4>
import { eq } from "drizzle-orm";
import { getDb, users, meetings, recordings, transcriptSegments, speakers, pipelineStage } from "@milo/db";
import { LocalStorage, FakeStt } from "@milo/providers";
import { processMedia } from "@milo/media";
import { transcribeRecording } from "@milo/transcription";
import fs from "node:fs";

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

// failure path: a file with no audio fails the media stage with a readable error and records it
const [r2] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: `meetings/${m!.id}/silent.mp4` }).returning();
await storage.putStream(r2!.rawKey!, fs.createReadStream(file.replace(/\.mp4$/, "-silent.mp4")));
let failed = false; try { await processMedia(db, storage, r2!.id); } catch { failed = true; }
const [st] = await db.select().from(pipelineStage).where(eq(pipelineStage.recordingId, r2!.id));
assert(failed && st!.status === "failed" && /no audio/i.test(st!.error ?? ""), "no-audio file fails with readable error");
await db.delete(meetings).where(eq(meetings.id, m!.id)); // cascades to recordings, segments, stages
await db.delete(users).where(eq(users.id, u!.id));
console.log("ok"); process.exit(0);
