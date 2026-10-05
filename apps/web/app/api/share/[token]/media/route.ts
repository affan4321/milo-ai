import { Readable } from "node:stream";
import { getDb } from "@milo/db";
import { getProviders } from "@milo/providers";
import { resolveShare } from "@milo/sharing";

export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { mp4: "video/mp4", m4a: "audio/mp4" };

/** The shared clip's media for a viewer with no account. The token is the only credential; revoking it stops this immediately (no-store). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const look = await resolveShare(getDb(), (await params).token);
  if (!look.ok) return new Response("Not available", { status: look.reason === "not_found" ? 404 : 410, headers: { "cache-control": "no-store" } });
  const key = look.clip.storageKey!, { storage } = getProviders();
  const size = await storage.size(key);
  if (!size) return new Response("Not found", { status: 404 });
  const base = { "content-type": TYPES[key.split(".").pop()!] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (!m) return new Response(Readable.toWeb(storage.read(key)) as ReadableStream, { headers: { ...base, "content-length": String(size) } });
  const start = m[1] ? Number(m[1]) : size - Number(m[2]);
  const end = Math.min(m[1] && m[2] ? Number(m[2]) : size - 1, size - 1);
  if (!(start >= 0) || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  return new Response(Readable.toWeb(storage.read(key, { start, end })) as ReadableStream, { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
}
