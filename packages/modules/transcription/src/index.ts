import { eq, sql } from "drizzle-orm";
import { PermanentError } from "@milo/core";
import { recordings, meetings, speakers, transcriptSegments, runStage, type Db } from "@milo/db";
import type { SttProvider, StorageProvider } from "@milo/providers";

const CHUNK = 400;

/** transcription stage. Idempotent: replaces the meeting's speakers and segments on every run. */
export async function transcribeRecording(db: Db, storage: StorageProvider, stt: SttProvider, recordingId: string) {
  return runStage(db, recordingId, "transcription", async () => {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId));
    if (!rec?.audioKey || !rec.durationMs) throw new Error("media stage has not finished for this recording");

    const segs = await stt.transcribe({ key: rec.audioKey, durationMs: rec.durationMs }, storage);
    if (!segs.length) throw new PermanentError("No speech was detected in this recording.");

    const meetingId = rec.meetingId;
    await db.transaction(async (tx) => {
      await tx.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId));
      await tx.delete(speakers).where(eq(speakers.meetingId, meetingId));

      const talk = new Map<string, number>();
      for (const s of segs) talk.set(s.speakerLabel, (talk.get(s.speakerLabel) ?? 0) + (s.endMs - s.startMs));
      const rows = await tx.insert(speakers).values(
        [...talk].sort((a, b) => b[1] - a[1]).map(([label, ms]) => ({ meetingId, label, talkTimeMs: ms })),
      ).returning();
      const byLabel = new Map(rows.map((r) => [r.label, r.id]));

      for (let i = 0; i < segs.length; i += CHUNK) {
        await tx.insert(transcriptSegments).values(segs.slice(i, i + CHUNK).map((s) => ({
          meetingId, speakerId: byLabel.get(s.speakerLabel)!, startMs: s.startMs, endMs: s.endMs, text: s.text, words: s.words,
          tsv: sql`to_tsvector('english', ${s.text})` as unknown as string,
        })));
      }
      await tx.update(meetings).set({ status: "ready" }).where(eq(meetings.id, meetingId));
    });
    return { meetingId, segments: segs.length };
  });
}
