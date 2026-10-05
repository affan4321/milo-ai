"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, meetings, recordings, speakers, pipelineStage, actionItems, clips } from "@milo/db";
import { getProviders } from "@milo/providers";
import { createCustomTemplate, getOrCreateSummary } from "@milo/intelligence";
import { addLiveHighlight, addHighlight, deleteHighlight, createClip, createShare, revokeShares } from "@milo/sharing";
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

export type HighlightResult = { ok: true; startMs: number; endMs: number; created: boolean } | { ok: false; error: string };

/** The Highlight button on the live page: marks the 30 seconds before now. */
export async function addLiveHighlightAction(meetingId: string, note?: string): Promise<HighlightResult> {
  const user = await getCurrentUser();
  await ownedMeeting(meetingId);
  const r = await addLiveHighlight(getDb(), meetingId, { note: note ?? null, createdBy: user.name ?? user.email });
  if ("error" in r) return { ok: false, error: r.error };
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, startMs: r.highlight.startMs, endMs: r.highlight.endMs, created: r.created };
}

/** After the meeting: mark any range (e.g. a selected stretch of the transcript). */
export async function addRangeHighlightAction(meetingId: string, startMs: number, endMs: number, note?: string): Promise<HighlightResult> {
  const user = await getCurrentUser();
  await ownedMeeting(meetingId);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return { ok: false, error: "That range isn't valid." };
  const r = await addHighlight(getDb(), { meetingId, startMs, endMs, note: note ?? null, createdBy: user.name ?? user.email, source: "after" });
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, startMs: r.highlight.startMs, endMs: r.highlight.endMs, created: r.created };
}

export async function deleteHighlightAction(meetingId: string, highlightId: string) {
  await ownedMeeting(meetingId);
  await deleteHighlight(getDb(), meetingId, highlightId);
  revalidatePath(`/meetings/${meetingId}`);
}

export type ClipResult = { ok: true; clipId: string } | { ok: false; error: string };

/** Queue a clip of [startMs, endMs). The worker cuts it; the page shows "preparing" until it's ready. */
export async function createClipAction(meetingId: string, startMs: number, endMs: number, title?: string): Promise<ClipResult> {
  const user = await getCurrentUser();
  await ownedMeeting(meetingId);
  const r = await createClip(getDb(), { meetingId, startMs, endMs, title: title ?? null, createdBy: user.name ?? user.email });
  if (!r.clip) return { ok: false, error: r.error ?? "Couldn't create the clip." };
  await enqueue("clip.create", { clipId: r.clip.id });
  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, clipId: r.clip.id };
}

async function ownedClip(clipId: string) {
  const user = await getCurrentUser();
  const [row] = await getDb().select({ clip: clips, owner: meetings.ownerId }).from(clips).innerJoin(meetings, eq(meetings.id, clips.meetingId)).where(eq(clips.id, clipId));
  if (!row || row.owner !== user.id) throw new Error("Clip not found");
  return row.clip;
}

export async function shareClipAction(clipId: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const clip = await ownedClip(clipId);
  const r = await createShare(getDb(), clipId);
  if (!r.share) return { ok: false, error: r.error ?? "Couldn't create the link." };
  revalidatePath(`/meetings/${clip.meetingId}`);
  return { ok: true, token: r.share.token };
}

export async function revokeClipShareAction(clipId: string) {
  const clip = await ownedClip(clipId);
  await revokeShares(getDb(), clipId);
  revalidatePath(`/meetings/${clip.meetingId}`);
}
