import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { PermanentError } from "@milo/core";
import { actionItems, chapters, clips, meetings, recordings, shares, speakers, summaries, transcriptSegments, type Db } from "@milo/db";
import type { StorageProvider } from "@milo/providers";

export const MAX_CLIP_MS = 15 * 60_000;
const MIN_CLIP_MS = 1000;

/** Create a clip request (rendered later by the worker). Ranges are clamped into the recording and capped at 15 minutes. */
export async function createClip(db: Db, a: { meetingId: string; startMs: number; endMs: number; title?: string | null; createdBy?: string | null }) {
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, a.meetingId));
  if (!rec?.playableKey || !rec.durationMs) return { error: "This meeting's recording isn't ready yet." as const };
  if (![a.startMs, a.endMs].every(Number.isFinite)) return { error: "That range isn't valid." as const };
  const startMs = Math.max(0, Math.min(Math.round(a.startMs), rec.durationMs - MIN_CLIP_MS));
  const endMs = Math.min(rec.durationMs, Math.round(a.endMs), startMs + MAX_CLIP_MS);
  if (endMs - startMs < MIN_CLIP_MS) return { error: "A clip needs to be at least a second long." as const };
  const [clip] = await db.insert(clips).values({ meetingId: a.meetingId, startMs, endMs, title: a.title?.trim().slice(0, 120) || null, createdBy: a.createdBy ?? null }).returning();
  return { clip: clip! };
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("ffmpeg timed out")); }, 10 * 60_000);
    p.stderr.on("data", (d) => (err = (err + d).slice(-800)));
    p.on("error", (e) => { clearTimeout(t); reject(e.message.includes("ENOENT") ? new Error("ffmpeg is not installed") : e); });
    p.on("close", (c) => { clearTimeout(t); c === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().split("\n").slice(-2).join(" | ")}`)); });
  });
}

/**
 * Cut the clip out of the playable recording. Re-encoded (not stream-copied) so it starts exactly where asked instead of at the
 * nearest keyframe. Idempotent: output has a fixed key and is overwritten on retry.
 */
export async function renderClip(db: Db, storage: StorageProvider, clipId: string) {
  const [clip] = await db.select().from(clips).where(eq(clips.id, clipId));
  if (!clip) throw new PermanentError("clip not found");
  try {
    const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, clip.meetingId));
    if (!rec?.playableKey) throw new PermanentError("The meeting's recording is missing.");
    const input = await storage.toLocalFile(rec.playableKey);
    const video = rec.playableKey.endsWith(".mp4");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "milo-clip-"));
    try {
      const out = path.join(tmp, video ? "clip.mp4" : "clip.m4a");
      const seek = ["-ss", (clip.startMs / 1000).toFixed(3), "-t", ((clip.endMs - clip.startMs) / 1000).toFixed(3), "-i", input];
      await ffmpeg(video
        ? [...seek, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out]
        : [...seek, "-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out]);
      const key = `clips/${clip.id}${video ? ".mp4" : ".m4a"}`;
      await storage.putFile(key, out);
      await db.update(clips).set({ storageKey: key, status: "ready", error: null }).where(eq(clips.id, clipId));
      return { key };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } catch (e) {
    await db.update(clips).set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(clips.id, clipId));
    throw e;
  }
}

export async function listClips(db: Db, meetingId: string) {
  const rows = await db.select().from(clips).where(eq(clips.meetingId, meetingId)).orderBy(desc(clips.createdAt));
  const out = [];
  for (const c of rows) {
    const [sh] = await db.select().from(shares).where(and(eq(shares.targetType, "clip"), eq(shares.targetId, c.id))).orderBy(desc(shares.id)).limit(1);
    out.push({ ...c, share: sh ?? null });
  }
  return out;
}

// ---------------- sharing ----------------

export const newToken = () => randomBytes(24).toString("base64url"); // 192 bits: not guessable

/** One live link per clip: asking again returns the same one; after a revoke, asking again makes a fresh token. */
export async function createShare(db: Db, clipId: string, o: { expiresInDays?: number | null } = {}) {
  const [clip] = await db.select().from(clips).where(eq(clips.id, clipId));
  if (!clip) return { error: "Clip not found." as const };
  if (clip.status !== "ready") return { error: "The clip is still being prepared." as const };
  const live = (await db.select().from(shares).where(and(eq(shares.targetType, "clip"), eq(shares.targetId, clipId)))).find((s) => !s.revokedAt && (!s.expiresAt || s.expiresAt > new Date()));
  if (live) return { share: live };
  const expiresAt = o.expiresInDays ? new Date(Date.now() + o.expiresInDays * 86_400_000) : null;
  const [share] = await db.insert(shares).values({ token: newToken(), targetType: "clip", targetId: clipId, expiresAt }).returning();
  return { share: share! };
}

export async function revokeShares(db: Db, clipId: string) {
  const n = await db.update(shares).set({ revokedAt: new Date() }).where(and(eq(shares.targetType, "clip"), eq(shares.targetId, clipId))).returning();
  return n.length;
}

export type ShareLookup = { ok: true; share: typeof shares.$inferSelect; clip: typeof clips.$inferSelect; meeting: typeof meetings.$inferSelect } | { ok: false; reason: "not_found" | "revoked" | "expired" | "not_ready" };

/** Resolve a public token. Never reveals whether a revoked token ever existed beyond "revoked". */
export async function resolveShare(db: Db, token: string, now = new Date()): Promise<ShareLookup> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: "not_found" };
  const [share] = await db.select().from(shares).where(eq(shares.token, token));
  if (!share || share.targetType !== "clip") return { ok: false, reason: "not_found" };
  if (share.revokedAt) return { ok: false, reason: "revoked" };
  if (share.expiresAt && share.expiresAt <= now) return { ok: false, reason: "expired" };
  const [clip] = await db.select().from(clips).where(eq(clips.id, share.targetId));
  if (!clip) return { ok: false, reason: "not_found" };
  if (clip.status !== "ready" || !clip.storageKey) return { ok: false, reason: "not_ready" };
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, clip.meetingId));
  return meeting ? { ok: true, share, clip, meeting } : { ok: false, reason: "not_found" };
}

export async function countView(db: Db, shareId: string) {
  const [s] = await db.select().from(shares).where(eq(shares.id, shareId));
  if (s) await db.update(shares).set({ views: s.views + 1 }).where(eq(shares.id, shareId));
}

/**
 * Everything a viewer with no account sees alongside the clip: the transcript for just that stretch (times relative to the clip),
 * and a short recap built from what Milo already knows about the meeting, so someone who wasn't there has context.
 * Nothing outside the clip's range is included.
 */
export async function buildShareView(db: Db, clip: typeof clips.$inferSelect) {
  const segs = await db.select({ startMs: transcriptSegments.startMs, endMs: transcriptSegments.endMs, text: transcriptSegments.text, label: speakers.label, name: speakers.displayName })
    .from(transcriptSegments).leftJoin(speakers, eq(speakers.id, transcriptSegments.speakerId))
    .where(and(eq(transcriptSegments.meetingId, clip.meetingId), lt(transcriptSegments.startMs, clip.endMs), gte(transcriptSegments.endMs, clip.startMs)))
    .orderBy(asc(transcriptSegments.startMs));
  const transcript = segs.map((s) => ({ startMs: Math.max(0, s.startMs - clip.startMs), text: s.text, speaker: s.name ?? s.label ?? "Speaker" }));

  const inRange = (ms?: number | null) => typeof ms === "number" && ms >= clip.startMs && ms <= clip.endMs;
  const sums = await db.select().from(summaries).where(eq(summaries.meetingId, clip.meetingId)).orderBy(asc(summaries.createdAt));
  const points = (sums[0]?.content.sections ?? []).flatMap((sec) => sec.bullets.filter((b) => inRange(b.ms)).map((b) => b.text)).slice(0, 5);
  const chs = await db.select().from(chapters).where(eq(chapters.meetingId, clip.meetingId)).orderBy(asc(chapters.startMs));
  const topic = [...chs].reverse().find((c) => c.startMs <= clip.startMs)?.title ?? chs.find((c) => inRange(c.startMs))?.title ?? null;
  const items = (await db.select().from(actionItems).where(eq(actionItems.meetingId, clip.meetingId))).filter((a) => inRange(a.sourceMs)).map((a) => ({ text: a.text, assignee: a.assignee })).slice(0, 5);
  return { transcript, recap: { topic, points, actionItems: items } };
}

