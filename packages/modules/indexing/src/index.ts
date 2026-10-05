import { asc, eq, sql } from "drizzle-orm";
import { PermanentError } from "@milo/core";
import { recordings, speakers, transcriptSegments, runStage, type Db } from "@milo/db";
import type { LlmProvider } from "@milo/providers";

const SHORT = 40;       // only lines this short ("Yes, agreed.") mean nothing alone, so they borrow the next line. Longer lines stand alone, or neighbouring topics blur together.
/**
 * Gemini's free tier allows 100 embedded TEXTS per minute (counted per text, not per request). Indexing paces itself to stay
 * under that with headroom, so a user's search (which must embed its query) is never starved by a big meeting being indexed.
 * A 600-line meeting therefore takes several minutes, which is fine in the background. Override with INDEX_TEXTS_PER_MINUTE
 * (e.g. once billing is enabled).
 */
const DEFAULT_TEXTS_PER_MINUTE = 70;
const CHUNK = 35;

/** What gets embedded for a transcript line: who said it, plus the next line when this one is very short. */
export function embeddingText(seg: { text: string; speaker: string }, next?: { text: string }): string {
  const own = `${seg.speaker}: ${seg.text}`;
  return seg.text.length < SHORT && next ? `${own} ${next.text}` : own;
}

/**
 * indexing stage: embed the meeting's transcript lines for semantic search and Ask.
 * Resumable: only lines without an embedding are processed, so a retry after a rate limit never re-spends the work already done.
 * (Keyword search needs no stage: the transcription stage already stores each line's full-text vector.)
 */
export async function indexRecording(db: Db, llm: LlmProvider, recordingId: string, opts: { textsPerMinute?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const rate = opts.textsPerMinute ?? (Number(process.env.INDEX_TEXTS_PER_MINUTE) || DEFAULT_TEXTS_PER_MINUTE);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return runStage(db, recordingId, "indexing", async () => {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId));
    if (!rec) throw new PermanentError("recording not found");
    const meetingId = rec.meetingId;

    const rows = await db.select({ id: transcriptSegments.id, text: transcriptSegments.text, hasVec: sql<boolean>`${transcriptSegments.embedding} is not null`, label: speakers.label, name: speakers.displayName })
      .from(transcriptSegments).leftJoin(speakers, eq(speakers.id, transcriptSegments.speakerId))
      .where(eq(transcriptSegments.meetingId, meetingId)).orderBy(asc(transcriptSegments.startMs));
    if (!rows.length) throw new PermanentError("There is no transcript to index.");

    const todo = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.hasVec);
    let embedded = 0;
    for (let off = 0; off < todo.length; off += CHUNK) {
      const part = todo.slice(off, off + CHUNK);
      const started = Date.now();
      const vecs = await llm.embed(part.map(({ r, i }) => embeddingText({ text: r.text, speaker: r.name ?? r.label ?? "Speaker" }, rows[i + 1])), "document");
      if (vecs.length !== part.length) throw new Error("embedding provider returned the wrong number of vectors");
      await db.transaction(async (tx) => {
        for (let k = 0; k < part.length; k++) await tx.update(transcriptSegments).set({ embedding: vecs[k]! }).where(eq(transcriptSegments.id, part[k]!.r.id));
      });
      embedded += part.length;
      // Pace: this chunk's texts "cost" part.length / rate minutes. Skip the wait after the last chunk.
      if (Number.isFinite(rate) && off + CHUNK < todo.length) await sleep(Math.max(0, (part.length / rate) * 60_000 - (Date.now() - started)));
    }
    return { meetingId, segments: rows.length, embedded };
  });
}

/** Lines still missing an embedding (used by tests and by search to know whether semantic results are complete). */
export async function unindexedCount(db: Db, meetingId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(transcriptSegments).where(sql`${transcriptSegments.meetingId} = ${meetingId} and ${transcriptSegments.embedding} is null`);
  return r?.n ?? 0;
}

/**
 * Recordings whose transcript has lines without embeddings: meetings processed before indexing existed, or whose indexing failed
 * or was interrupted. The worker sweeps these up so search and Ask cover every meeting without anyone pressing a button.
 */
export async function findUnindexedRecordings(db: Db, limit = 50): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT r.id FROM recordings r JOIN meetings m ON m.id = r.meeting_id
    WHERE m.status = 'ready' AND EXISTS (SELECT 1 FROM transcript_segments s WHERE s.meeting_id = r.meeting_id AND s.embedding IS NULL)
    ORDER BY m.created_at DESC LIMIT ${limit}`) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}
