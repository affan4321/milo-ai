import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, meetings, recordings, ensureStages } from "@milo/db";
import { getProviders } from "@milo/providers";
import { getCurrentUser } from "@/lib/session";
import { enqueue } from "@/lib/queue";

export const dynamic = "force-dynamic";
const MAX_BYTES = 4 * 1024 ** 3;
const EXTS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "wav", "ogg", "aac", "flac"]);

/** PUT the raw file as the body. Headers: x-filename (required), x-title (optional). Streams to storage, never buffers. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  const filename = decodeURIComponent(req.headers.get("x-filename") ?? "");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTS.has(ext)) return Response.json({ error: `Unsupported file type ".${ext}". Upload a video or audio recording.` }, { status: 415 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "That file is larger than 4 GB." }, { status: 413 });
  if (!req.body) return Response.json({ error: "Empty upload." }, { status: 400 });

  const db = getDb(), { storage } = getProviders();
  const title = decodeURIComponent(req.headers.get("x-title") ?? "").trim() || filename.replace(/\.[^.]+$/, "");
  const [meeting] = await db.insert(meetings).values({ ownerId: user.id, title, status: "processing", captureSource: "upload", startedAt: new Date() }).returning();
  const key = `meetings/${meeting!.id}/raw.${ext}`;
  try {
    const bytes = await storage.putStream(key, Readable.fromWeb(req.body as never));
    if (!bytes) throw new Error("Empty upload.");
  } catch (e) {
    await db.delete(meetings).where(eq(meetings.id, meeting!.id));
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 500 });
  }
  const [rec] = await db.insert(recordings).values({ meetingId: meeting!.id, rawKey: key }).returning();
  await ensureStages(db, rec!.id, ["media", "transcription"]);
  await enqueue(Events.RecordingUploaded, { recordingId: rec!.id });
  return Response.json({ meetingId: meeting!.id });
}
