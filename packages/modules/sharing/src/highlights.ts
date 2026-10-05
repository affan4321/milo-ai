import { and, asc, desc, eq } from "drizzle-orm";
import { highlightRange } from "@milo/core";
import { botSessions, highlights, type Db } from "@milo/db";

export type HighlightSource = "live_button" | "chat_command" | "after";
export interface HighlightInput { meetingId: string; startMs: number; endMs: number; note?: string | null; createdBy?: string | null; source: HighlightSource }

/** Two presses (or one press and one chat command) within this window are the same moment. */
const DEDUPE_MS = 5000;

export async function addHighlight(db: Db, h: HighlightInput) {
  const startMs = Math.max(0, Math.round(h.startMs)), endMs = Math.max(startMs + 1000, Math.round(h.endMs));
  const existing = await db.select().from(highlights).where(and(eq(highlights.meetingId, h.meetingId), eq(highlights.source, h.source)));
  const dup = existing.find((e) => Math.abs(e.endMs - endMs) < DEDUPE_MS && (e.createdBy ?? "") === (h.createdBy ?? ""));
  if (dup) return { highlight: dup, created: false as const };
  const [row] = await db.insert(highlights).values({ meetingId: h.meetingId, startMs, endMs, note: h.note?.trim().slice(0, 200) || null, createdBy: h.createdBy ?? null, source: h.source }).returning();
  return { highlight: row!, created: true as const };
}

/** A highlight at a moment on the recording's clock: marks the 30 seconds before it. */
export function addHighlightAt(db: Db, meetingId: string, atMs: number, o: { note?: string | null; createdBy?: string | null; source: HighlightSource }) {
  const { startMs, endMs } = highlightRange(atMs);
  return addHighlight(db, { meetingId, startMs, endMs, ...o });
}

/**
 * The Highlight button on the live page. The recording's clock comes from the bot's report of when it started recording,
 * so "now" can be converted to a position on the recording. Fails clearly when nothing is recording.
 */
export async function addLiveHighlight(db: Db, meetingId: string, o: { note?: string | null; createdBy?: string | null; now?: Date }) {
  const [s] = await db.select().from(botSessions).where(eq(botSessions.meetingId, meetingId));
  if (!s || s.state !== "recording" || !s.recordingStartedAt) return { error: "Milo isn't recording this meeting right now." as const };
  const atMs = (o.now ?? new Date()).getTime() - s.recordingStartedAt.getTime();
  if (atMs < 0) return { error: "The recording hasn't started yet." as const };
  return addHighlightAt(db, meetingId, atMs, { note: o.note, createdBy: o.createdBy, source: "live_button" });
}

export const listHighlights = (db: Db, meetingId: string) => db.select().from(highlights).where(eq(highlights.meetingId, meetingId)).orderBy(asc(highlights.startMs));
export async function deleteHighlight(db: Db, meetingId: string, id: string) { await db.delete(highlights).where(and(eq(highlights.id, id), eq(highlights.meetingId, meetingId))); }
export const latestHighlight = (db: Db, meetingId: string) => db.select().from(highlights).where(eq(highlights.meetingId, meetingId)).orderBy(desc(highlights.endMs)).limit(1);
