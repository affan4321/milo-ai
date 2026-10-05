import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb, meetings } from "@milo/db";
import { getProviders } from "@milo/providers";
import { getCurrentUser } from "@/lib/session";
import { UPLOAD_EXTS, MAX_UPLOAD_BYTES, extOf, titleFrom, createUploadMeeting, startPipeline } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** PUT the raw file as the body. Headers: x-filename (required), x-title (optional). Streams to storage, never buffers. Used with local storage; remote storage uses /api/upload/init + /complete. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  const filename = decodeURIComponent(req.headers.get("x-filename") ?? "");
  const ext = extOf(filename);
  if (!UPLOAD_EXTS.has(ext)) return Response.json({ error: `Unsupported file type ".${ext}". Upload a video or audio recording.` }, { status: 415 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) return Response.json({ error: "That file is larger than 4 GB." }, { status: 413 });
  if (!req.body) return Response.json({ error: "Empty upload." }, { status: 400 });

  const { storage } = getProviders();
  const meeting = await createUploadMeeting(user.id, titleFrom(decodeURIComponent(req.headers.get("x-title") ?? ""), filename));
  const key = `meetings/${meeting.id}/raw.${ext}`;
  try {
    const bytes = await storage.putStream(key, Readable.fromWeb(req.body as never));
    if (!bytes) throw new Error("Empty upload.");
  } catch (e) {
    await getDb().delete(meetings).where(eq(meetings.id, meeting.id));
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 500 });
  }
  await startPipeline(meeting.id, key);
  return Response.json({ meetingId: meeting.id });
}
