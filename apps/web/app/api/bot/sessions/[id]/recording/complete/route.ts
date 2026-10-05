import { eq } from "drizzle-orm";
import { getDb, botSessions } from "@milo/db";
import { getProviders } from "@milo/providers";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";
import { startPipeline } from "@/lib/recordings";

export const dynamic = "force-dynamic";

/** The bot has put its recording (and sidecar) straight into the bucket; start processing. Safe to repeat. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const { storage } = getProviders();
  const [s] = await getDb().select().from(botSessions).where(eq(botSessions.id, (await params).id));
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const ext = (new URL(req.url).searchParams.get("ext") ?? "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  const rawKey = `meetings/${s.meetingId}/raw.${ext}`, sidecarKey = `meetings/${s.meetingId}/sidecar.json`;
  if (!(await storage.size(rawKey))) return Response.json({ error: "recording not found in storage" }, { status: 409 });
  await startPipeline(s.meetingId, rawKey, (await storage.size(sidecarKey)) ? sidecarKey : null);
  return Response.json({ ok: true });
}
