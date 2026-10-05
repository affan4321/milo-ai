import { eq } from "drizzle-orm";
import { getDb, botSessions } from "@milo/db";
import { addHighlightAt } from "@milo/sharing";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

/** The bot saw `/milo highlight` in the meeting chat. atMs is on the recording's clock; the highlight covers the 30 s before it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const [s] = await getDb().select().from(botSessions).where(eq(botSessions.id, (await params).id));
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => null) as { atMs?: number; by?: string; note?: string | null } | null;
  if (!b || typeof b.atMs !== "number" || !Number.isFinite(b.atMs) || b.atMs < 0 || b.atMs > 24 * 3_600_000) return Response.json({ error: "bad atMs" }, { status: 400 });
  const r = await addHighlightAt(getDb(), s.meetingId, b.atMs, { note: b.note ?? null, createdBy: typeof b.by === "string" ? b.by.slice(0, 80) : null, source: "chat_command" });
  return Response.json({ ok: true, created: r.created, startMs: r.highlight.startMs, endMs: r.highlight.endMs });
}
