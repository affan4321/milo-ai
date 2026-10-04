"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, meetings, recordings, speakers, pipelineStage, actionItems } from "@milo/db";
import { getProviders } from "@milo/providers";
import { createCustomTemplate, getOrCreateSummary } from "@milo/intelligence";
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
  const event = stage === "media" ? Events.RecordingUploaded : stage === "transcription" ? Events.MediaReady : stage === "intelligence" ? Events.TranscriptReady : null;
  if (!event) return;
  await db.update(pipelineStage).set({ status: "pending", error: null }).where(and(eq(pipelineStage.recordingId, rec.id), eq(pipelineStage.stage, stage)));
  await enqueue(event, { recordingId: rec.id });
  revalidatePath(`/meetings/${meetingId}`);
}

export type SummaryResult = { ok: true; content: { sections: { heading: string; bullets: { text: string; ms?: number }[] }[] } } | { ok: false; error: string };

/** Switch template: served from cache when this meeting already has it, otherwise generated once and cached. */
export async function getSummaryAction(meetingId: string, templateKey: string, force = false): Promise<SummaryResult> {
  const m = await ownedMeeting(meetingId);
  try {
    return { ok: true, content: await getOrCreateSummary(getDb(), getProviders().llm, meetingId, templateKey, m.ownerId!, force) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not generate the summary." };
  }
}

export async function createTemplateAction(name: string, prompt: string): Promise<{ ok: true; key: string; name: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  try { return { ok: true, ...(await createCustomTemplate(getDb(), user.id, name, prompt)) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not save the template." }; }
}

export async function toggleActionItemAction(meetingId: string, itemId: string, done: boolean) {
  await ownedMeeting(meetingId);
  await getDb().update(actionItems).set({ done }).where(and(eq(actionItems.id, itemId), eq(actionItems.meetingId, meetingId)));
}
