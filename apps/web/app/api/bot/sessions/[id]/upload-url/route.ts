import { eq } from "drizzle-orm";
import { getDb, botSessions } from "@milo/db";
import { getProviders, contentTypeFor } from "@milo/providers";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

/** Where the bot should put its files. Remote storage: a presigned URL (files skip the web app). Local storage: "proxy" (use the PUT routes). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const { storage } = getProviders();
  if (!storage.presignPut) return Response.json({ mode: "proxy" });
  const [s] = await getDb().select().from(botSessions).where(eq(botSessions.id, (await params).id));
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; ext?: string };
  const ext = (b.ext ?? "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  const key = b.kind === "sidecar" ? `meetings/${s.meetingId}/sidecar.json` : b.kind === "recording" ? `meetings/${s.meetingId}/raw.${ext}` : "";
  if (!key) return Response.json({ error: "kind must be 'recording' or 'sidecar'" }, { status: 400 });
  return Response.json({ mode: "direct", url: await storage.presignPut(key, 4 * 3600), contentType: contentTypeFor(key) });
}
