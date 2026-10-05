import { eq } from "drizzle-orm";
import { getDb, botSessions } from "@milo/db";
import { applyBotState } from "@milo/calendar";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";
const STATES = ["joining", "waiting_room", "recording", "left", "failed"] as const;

/** The bot asks this before joining, so a job picked up late for a session that already failed is dropped. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const [s] = await getDb().select().from(botSessions).where(eq(botSessions.id, (await params).id));
  return s ? Response.json({ state: s.state, reason: s.reason }) : Response.json({ error: "not found" }, { status: 404 });
}

/** The bot reports its state here; repeating a state is a heartbeat. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const body = await req.json().catch(() => null) as { state?: string; reason?: string; recordingStartedAtMs?: number; participants?: number } | null;
  if (!body || !(STATES as readonly string[]).includes(body.state ?? "")) return Response.json({ error: "bad state" }, { status: 400 });
  const r = await applyBotState(getDb(), (await params).id, { state: body.state as (typeof STATES)[number], reason: body.reason, recordingStartedAtMs: body.recordingStartedAtMs, participants: body.participants });
  return r.ok ? Response.json(r) : Response.json(r, { status: 404 });
}
