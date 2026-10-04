import { getDb } from "@milo/db";
import { recordWorkerBeat } from "@milo/calendar";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

/** Each bot container reports here every few seconds: who it is, whether it is in a meeting. Lets the app tell "all busy" from "none running". */
export async function POST(req: Request) {
  if (!botAuthorized(req)) return unauthorized();
  const b = await req.json().catch(() => null) as { id?: string; busy?: boolean; sessionId?: string | null } | null;
  if (!b?.id || typeof b.id !== "string" || b.id.length > 100 || typeof b.busy !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
  await recordWorkerBeat(getDb(), { id: b.id, busy: b.busy, sessionId: b.sessionId ?? null });
  return Response.json({ ok: true });
}
