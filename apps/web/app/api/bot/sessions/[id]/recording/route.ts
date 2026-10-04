import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { Events } from "@milo/core";
import { getDb, botSessions, meetings, recordings, ensureStages } from "@milo/db";
import { getProviders } from "@milo/providers";
import { botAuthorized, unauthorized } from "@/lib/bot-auth";
import { enqueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Streams the bot's recording into storage, then starts the same pipeline an upload uses. Safe to repeat: a retry overwrites. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!botAuthorized(req)) return unauthorized();
  const db = getDb(), { storage } = getProviders();
  const [s] = await db.select().from(botSessions).where(eq(botSessions.id, (await params).id));
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });
  const ext = (new URL(req.url).searchParams.get("ext") ?? "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  const rawKey = `meetings/${s.meetingId}/raw.${ext}`;
  const bytes = await storage.putStream(rawKey, Readable.fromWeb(req.body as never));
  if (!bytes) return Response.json({ error: "empty recording" }, { status: 400 });
  const sidecarKey = `meetings/${s.meetingId}/sidecar.json`;
  const values = { meetingId: s.meetingId, rawKey, sidecarKey: (await storage.size(sidecarKey)) ? sidecarKey : null };
  const [existing] = await db.select().from(recordings).where(eq(recordings.meetingId, s.meetingId));
  const [rec] = existing ? await db.update(recordings).set(values).where(eq(recordings.id, existing.id)).returning() : await db.insert(recordings).values(values).returning();
  await ensureStages(db, rec!.id, ["media", "transcription", "intelligence"]);
  await db.update(meetings).set({ status: "processing" }).where(eq(meetings.id, s.meetingId));
  await enqueue(Events.RecordingUploaded, { recordingId: rec!.id });
  return Response.json({ ok: true, bytes });
}
