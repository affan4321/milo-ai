"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, meetings, recordings, speakers, pipelineStage } from "@milo/db";
import { getCurrentUser } from "@/lib/session";
import { enqueue } from "@/lib/queue";

async function ownedMeeting(id: string) {
  const user = await getCurrentUser();
  const [m] = await getDb().select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.ownerId, user.id)));
  if (!m) throw new Error("Meeting not found");
  return m;
}

/** Rename applies everywhere because segments reference the speaker row, not a copied name. */
export async function renameSpeakerAction(meetingId: string, speakerId: string, name: string) {
  await ownedMeeting(meetingId);
  const clean = name.trim().slice(0, 80);
  await getDb().update(speakers).set({ displayName: clean || null }).where(and(eq(speakers.id, speakerId), eq(speakers.meetingId, meetingId)));
  revalidatePath(`/meetings/${meetingId}`);
}

/** Re-run one stage. Handlers are idempotent, so this is always safe. */
export async function retryStageAction(meetingId: string, stage: string) {
  await ownedMeeting(meetingId);
  const db = getDb();
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, meetingId));
  if (!rec) return;
  const event = stage === "media" ? Events.RecordingUploaded : stage === "transcription" ? Events.MediaReady : null;
  if (!event) return;
  await db.update(pipelineStage).set({ status: "pending", error: null }).where(and(eq(pipelineStage.recordingId, rec.id), eq(pipelineStage.stage, stage)));
  await enqueue(event, { recordingId: rec.id });
  revalidatePath(`/meetings/${meetingId}`);
}
