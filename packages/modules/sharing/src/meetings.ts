import { and, eq, inArray } from "drizzle-orm";
import { BOT_ACTIVE_STATES } from "@milo/core";
import { botSessions, clips, meetings, pipelineStage, recordings, shares, type Db } from "@milo/db";
import type { StorageProvider } from "@milo/providers";

export type DeleteMeetingsResult = { deleted: string[]; skipped: { id: string; reason: "not_found" | "in_progress" }[] };

const MAX_PER_CALL = 100;

/**
 * Permanently delete the owner's meetings: database rows (transcript, summaries, action items, highlights, clips, playlist entries,
 * alert hits... all cascade from the meeting), the share links of its clips (they point at clips without a database link, so they
 * would otherwise survive), and the files in storage (the database cascade does not touch those).
 *
 * Only the owner's own meetings are ever touched, and a meeting that is being recorded or processed right now is skipped, because
 * deleting under a running job would only make that job fail. Storage cleanup is best-effort and runs AFTER the rows are gone: a
 * leftover file wastes space, but a meeting that still shows up with no files would be broken.
 */
export async function deleteMeetings(db: Db, storage: StorageProvider, ownerId: string, ids: string[]): Promise<DeleteMeetingsResult> {
  const wanted = [...new Set(ids)].slice(0, MAX_PER_CALL);
  if (!wanted.length) return { deleted: [], skipped: [] };
  const owned = (await db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.ownerId, ownerId), inArray(meetings.id, wanted)))).map((m) => m.id);
  const skipped: DeleteMeetingsResult["skipped"] = wanted.filter((id) => !owned.includes(id)).map((id) => ({ id, reason: "not_found" as const }));
  if (!owned.length) return { deleted: [], skipped };

  const recording = (await db.select({ id: botSessions.meetingId }).from(botSessions).where(and(inArray(botSessions.meetingId, owned), inArray(botSessions.state, [...BOT_ACTIVE_STATES])))).map((r) => r.id);
  const processing = (await db.select({ id: recordings.meetingId }).from(recordings).innerJoin(pipelineStage, eq(pipelineStage.recordingId, recordings.id))
    .where(and(inArray(recordings.meetingId, owned), eq(pipelineStage.status, "running")))).map((r) => r.id);
  const busy = new Set([...recording, ...processing]);
  for (const id of busy) skipped.push({ id: id!, reason: "in_progress" });
  const doomed = owned.filter((id) => !busy.has(id));
  if (!doomed.length) return { deleted: [], skipped };

  const recs = await db.select().from(recordings).where(inArray(recordings.meetingId, doomed));
  const clipRows = await db.select({ id: clips.id, key: clips.storageKey }).from(clips).where(inArray(clips.meetingId, doomed));
  const keys = [...recs.flatMap((r) => [r.rawKey, r.playableKey, r.audioKey, r.sidecarKey]), ...clipRows.map((c) => c.key)].filter((k): k is string => !!k);

  if (clipRows.length) await db.delete(shares).where(and(eq(shares.targetType, "clip"), inArray(shares.targetId, clipRows.map((c) => c.id))));
  const gone = await db.delete(meetings).where(and(eq(meetings.ownerId, ownerId), inArray(meetings.id, doomed))).returning({ id: meetings.id });

  for (const key of keys) await storage.delete(key).catch((e) => console.warn(`[delete] could not remove ${key}: ${e instanceof Error ? e.message : e}`));
  return { deleted: gone.map((g) => g.id), skipped };
}
