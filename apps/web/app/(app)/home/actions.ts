"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS } from "@milo/core";
import { getDb, calendarConnections, calendarEvents } from "@milo/db";
import { connectIcs, createBotSession, syncConnection } from "@milo/calendar";
import { getCurrentUser } from "@/lib/session";
import { enqueue } from "@/lib/queue";

export type ConnectState = { error?: string; synced?: number } | null;

export async function connectIcsAction(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await getCurrentUser();
  try {
    const r = await connectIcs(getDb(), user.id, String(form.get("url") ?? ""));
    revalidatePath("/home");
    return r.error ? { error: r.error } : { synced: r.synced };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not connect" };
  }
}

export async function resyncAction() {
  const user = await getCurrentUser();
  const db = getDb();
  for (const c of await db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id))) await syncConnection(db, c.id);
  revalidatePath("/home");
}

export async function toggleRecordAction(eventId: string, record: boolean) {
  const user = await getCurrentUser();
  const db = getDb();
  const [row] = await db.select({ id: calendarEvents.id }).from(calendarEvents)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarEvents.connectionId))
    .where(and(eq(calendarEvents.id, eventId), eq(calendarConnections.userId, user.id)));
  if (!row) return;
  await db.update(calendarEvents).set({ record }).where(eq(calendarEvents.id, eventId));
  revalidatePath("/home");
}

export type SendState = { error?: string } | null;
export async function sendMiloAction(_p: SendState, form: FormData): Promise<SendState> {
  const user = await getCurrentUser();
  const r = await createBotSession(getDb(), { ownerId: user.id, meetingUrl: String(form.get("url") ?? ""), title: String(form.get("title") ?? "") });
  if ("error" in r) return { error: r.error };
  await enqueue(BOT_JOIN_QUEUE, r.job, BOT_QUEUE_OPTIONS);
  redirect(`/meetings/${r.job.meetingId}`);
}
