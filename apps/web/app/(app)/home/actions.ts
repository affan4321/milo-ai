"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, calendarConnections } from "@milo/db";
import { connectIcs, syncConnection } from "@milo/calendar";
import { getCurrentUser } from "@/lib/session";

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
