import { eq, sql } from "drizzle-orm";
import { isBotName, type Sidecar } from "@milo/core";
import { PermanentError } from "@milo/core";
import { recordings, meetings, participants, speakers, transcriptSegments, runStage, type Db } from "@milo/db";
import { nameFromSidecar } from "./naming";
import type { SttProvider, StorageProvider } from "@milo/providers";

const CHUNK = 400;

async function loadSidecar(storage: StorageProvider, key: string | null): Promise<Sidecar | null> {
  if (!key || !(await storage.size(key))) return null;
  try {
    const chunks: Buffer[] = [];
    for await (const c of storage.read(key)) chunks.push(c as Buffer);
    const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return j?.version === 1 && Array.isArray(j.speakerEvents) && Array.isArray(j.participants) ? (j as Sidecar) : null;
  } catch { return null; } // a corrupt sidecar must never fail the transcript
}

/** transcription stage. Idempotent: replaces the meeting's speakers and segments on every run. */
export async function transcribeRecording(db: Db, storage: StorageProvider, stt: SttProvider, recordingId: string) {
  return runStage(db, recordingId, "transcription", async () => {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId));
    if (!rec?.audioKey || !rec.durationMs) throw new Error("media stage has not finished for this recording");

    let segs = await stt.transcribe({ key: rec.audioKey, durationMs: rec.durationMs }, storage);
    const sidecar = await loadSidecar(storage, rec.sidecarKey);
    // Real names from the bot's live captions beat "Speaker 1". Absent or unreadable sidecar just means generic labels.
    if (sidecar) segs = nameFromSidecar(segs, sidecar);
    if (!segs.length) throw new PermanentError("No speech was detected in this recording.");

    const meetingId = rec.meetingId;
    await db.transaction(async (tx) => {
      await tx.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId));
      await tx.delete(speakers).where(eq(speakers.meetingId, meetingId));
      await tx.delete(participants).where(eq(participants.meetingId, meetingId));
      const people = sidecar?.participants.length
        ? await tx.insert(participants).values(sidecar.participants.filter((p) => p.name && !isBotName(p.name)).map((p) => ({ meetingId, name: p.name, joinedMs: p.joinedMs, leftMs: p.leftMs }))).returning()
        : [];
      const personByName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));

      const talk = new Map<string, number>();
      for (const s of segs) talk.set(s.speakerLabel, (talk.get(s.speakerLabel) ?? 0) + (s.endMs - s.startMs));
      const rows = await tx.insert(speakers).values(
        [...talk].sort((a, b) => b[1] - a[1]).map(([label, ms]) => ({ meetingId, label, talkTimeMs: ms, participantId: personByName.get(label.toLowerCase()) ?? null })),
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
