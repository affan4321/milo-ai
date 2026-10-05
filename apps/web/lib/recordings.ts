import { eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, meetings, recordings, ensureStages, ensureWorkspace, preferences } from "@milo/db";
import { enqueue } from "@/lib/queue";

export const UPLOAD_EXTS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "wav", "ogg", "aac", "flac"]);
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
export const extOf = (filename: string) => filename.split(".").pop()?.toLowerCase() ?? "";
export const titleFrom = (title: string | null | undefined, filename: string) => (title ?? "").trim() || filename.replace(/\.[^.]+$/, "");

/** A meeting for a user's own upload, shared the way their default visibility says. */
export async function createUploadMeeting(userId: string, title: string) {
  const db = getDb();
  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  const [meeting] = await db.insert(meetings).values({ ownerId: userId, workspaceId: await ensureWorkspace(db, userId), visibility: prefs?.defaultVisibility === "team" ? "team" : "private", title, status: "processing", captureSource: "upload", startedAt: new Date() }).returning();
  return meeting!;
}

/** Start the processing pipeline for a raw file that is already in storage. */
export async function startPipeline(meetingId: string, rawKey: string, sidecarKey?: string | null) {
  const db = getDb();
  const values = { meetingId, rawKey, sidecarKey: sidecarKey ?? null };
  const [existing] = await db.select().from(recordings).where(eq(recordings.meetingId, meetingId));
  const [rec] = existing ? await db.update(recordings).set(values).where(eq(recordings.id, existing.id)).returning() : await db.insert(recordings).values(values).returning();
  await ensureStages(db, rec!.id, ["media", "transcription", "intelligence", "indexing"]);
  await db.update(meetings).set({ status: "processing" }).where(eq(meetings.id, meetingId));
  await enqueue(Events.RecordingUploaded, { recordingId: rec!.id });
  return rec!;
}
