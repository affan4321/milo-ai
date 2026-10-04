import { eq } from "drizzle-orm";
import { getDb, botSessions } from "@milo/db";
import { getProviders } from "@milo/providers";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";
const MAX = 8 * 1024 * 1024;

/** Captions / participants / chat for the meeting, uploaded before the recording so the pipeline can use it. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const [s] = await getDb().select().from(botSessions).where(eq(botSessions.id, (await params).id));
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const text = await req.text();
  if (text.length > MAX) return Response.json({ error: "sidecar too large" }, { status: 413 });
  let j: any; try { j = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (j?.version !== 1 || !Array.isArray(j.speakerEvents) || !Array.isArray(j.participants)) return Response.json({ error: "unexpected sidecar shape" }, { status: 400 });
  await getProviders().storage.put(`meetings/${s.meetingId}/sidecar.json`, Buffer.from(text));
  return Response.json({ ok: true });
}
