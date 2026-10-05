"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, preferences, calendarConnections, calendarEvents, meetings } from "@milo/db";
import { BUILT_IN_TEMPLATES } from "@milo/intelligence";
import { syncConnection } from "@milo/calendar";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";
import { getCurrentUser } from "@/lib/session";
import { getPrefs } from "@/lib/onboarding-state";

type Result = { error?: string } | null;
const oneOf = (v: FormDataEntryValue | null, allowed: readonly string[]) => (typeof v === "string" && allowed.includes(v) ? v : null);

/** One action for every settings group; the hidden `group` field says which fields to read. Invalid values are rejected, never stored. */
export async function savePrefsAction(form: FormData): Promise<Result> {
  const user = await getCurrentUser();
  const db = getDb();
  const cur = await getPrefs(user.id);
  const set: Partial<typeof preferences.$inferInsert> = {};
  switch (form.get("group")) {
    case "rules": {
      const record = oneOf(form.get("record"), RECORD_RULES.map((r) => r.value)), share = oneOf(form.get("share"), SHARE_RULES.map((r) => r.value));
      if (!record || !share) return { error: "Choose one of the listed options." };
      set.autoRecordRule = record; set.autoShareRule = share; break;
    }
    case "platforms": {
      // Only Google Meet can be switched today; the other platforms' entries are left as they are.
      const rest = cur.recordPlatforms.filter((p) => p !== "meet");
      set.recordPlatforms = form.get("meet") === "on" ? ["meet", ...rest] : rest; break;
    }
    case "general": {
      const custom = (await db.query.templates.findMany({ where: (t, { eq }) => eq(t.ownerId, user.id) })).map((t) => t.key);
      const tpl = oneOf(form.get("template"), [...BUILT_IN_TEMPLATES.map((t) => t.key), ...custom]), vis = oneOf(form.get("visibility"), ["private", "team"]);
      if (!tpl || !vis) return { error: "Choose one of the listed options." };
      set.defaultTemplate = tpl; set.defaultVisibility = vis; break;
    }
    case "notifications": set.recapEmail = form.get("recap") === "on"; set.alertEmails = form.get("alerts") === "on"; break;
    case "compliance": set.consentMessage = form.get("consent") === "on"; break;
    default: return { error: "Unknown settings group." };
  }
  await db.update(preferences).set(set).where(eq(preferences.userId, user.id));
  revalidatePath("/settings"); revalidatePath("/customize"); revalidatePath("/home");
  return null;
}

export async function syncCalendarAction(connectionId: string) {
  const user = await getCurrentUser(); const db = getDb();
  const [c] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, user.id)));
  if (c) await syncConnection(db, c.id);
  revalidatePath("/settings");
}

/** Disconnect a calendar. Meetings already recorded from its events are kept (only their link to the event is cleared). */
export async function disconnectCalendarAction(connectionId: string) {
  const user = await getCurrentUser(); const db = getDb();
  const [c] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, user.id)));
  if (!c) return;
  const evs = (await db.select({ id: calendarEvents.id }).from(calendarEvents).where(eq(calendarEvents.connectionId, c.id))).map((e) => e.id);
  if (evs.length) await db.update(meetings).set({ calendarEventId: null }).where(inArray(meetings.calendarEventId, evs));
  await db.delete(calendarConnections).where(eq(calendarConnections.id, c.id)); // its events go with it
  revalidatePath("/settings"); revalidatePath("/home");
}
