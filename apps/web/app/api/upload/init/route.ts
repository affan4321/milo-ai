import { randomUUID } from "node:crypto";
import { getProviders, contentTypeFor } from "@milo/providers";
import { getCurrentUser } from "@/lib/session";
import { UPLOAD_EXTS, MAX_UPLOAD_BYTES, extOf } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/**
 * Step 1 of a direct upload: the browser asks where to put the file. On remote storage it gets a presigned URL and sends the file
 * straight to the bucket (serverless hosting can't carry recordings through the app). On local storage it is told to use the
 * streaming PUT /api/upload instead.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const b = (await req.json().catch(() => ({}))) as { filename?: string; size?: number };
  const ext = extOf(b.filename ?? "");
  if (!UPLOAD_EXTS.has(ext)) return Response.json({ error: `Unsupported file type ".${ext}". Upload a video or audio recording.` }, { status: 415 });
  if ((b.size ?? 0) > MAX_UPLOAD_BYTES) return Response.json({ error: "That file is larger than 4 GB." }, { status: 413 });
  const { storage } = getProviders();
  if (!storage.presignPut) return Response.json({ mode: "proxy" });
  const key = `uploads/${user.id}/${randomUUID()}/raw.${ext}`;
  return Response.json({ mode: "direct", key, url: await storage.presignPut(key, 4 * 3600), contentType: contentTypeFor(key) });
}
