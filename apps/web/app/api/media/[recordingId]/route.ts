import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb, meetings, recordings } from "@milo/db";
import { getProviders } from "@milo/providers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4", webm: "video/webm", mp3: "audio/mpeg" };

/** Authenticated media with HTTP Range support, so the player can seek without downloading the whole file. */
export async function GET(req: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const user = await getCurrentUser();
  const { recordingId } = await params;
  const [row] = await getDb().select({ key: recordings.playableKey, owner: meetings.ownerId })
    .from(recordings).innerJoin(meetings, eq(meetings.id, recordings.meetingId)).where(eq(recordings.id, recordingId));
  if (!row || row.owner !== user.id || !row.key) return new Response("Not found", { status: 404 });

  const { storage } = getProviders();
  // Remote storage: send the player straight to the bucket (it handles Range itself); nothing is streamed through this function.
  if (storage.presignGet) return Response.redirect(await storage.presignGet(row.key, 3600), 302);
  const size = await storage.size(row.key);
  if (!size) return new Response("Not found", { status: 404 });
  const type = TYPES[row.key.split(".").pop()!] ?? "application/octet-stream";
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m) return new Response(Readable.toWeb(storage.read(row.key)) as ReadableStream, { headers: { ...base, "content-length": String(size) } });
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (!(start >= 0) || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(Readable.toWeb(storage.read(row.key, { start, end })) as ReadableStream, {
    status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
