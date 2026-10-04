"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, preferences, workspaces, memberships } from "@milo/db";
import { getCurrentUser } from "@/lib/session";
import { JOB_FUNCTIONS, validatePreferences } from "@/lib/onboarding";

const patch = async (userId: string, set: Partial<typeof preferences.$inferInsert>) => {
  await getDb().update(preferences).set(set).where(eq(preferences.userId, userId));
};

export async function chooseAccountAction(form: FormData) {
  const user = await getCurrentUser();
  const type = form.get("type") === "personal" ? "personal" : "team";
  const db = getDb();
  const [existing] = await db.select().from(memberships).where(eq(memberships.userId, user.id));
  if (!existing) {
    const domain = user.email.split("@")[1] ?? "workspace";
    const [ws] = await db.insert(workspaces).values({ name: type === "personal" ? `${user.name ?? user.email}'s notes` : domain }).returning();
    await db.insert(memberships).values({ userId: user.id, workspaceId: ws!.id, role: "owner" });
  }
  await patch(user.id, { accountType: type, accountChosen: true });
  redirect("/onboarding");
}

export async function finishCalendarAction() {
  const user = await getCurrentUser();
  await patch(user.id, { calendarStepDone: true });
  redirect("/onboarding");
}

export type PrefsState = { error?: string; values?: { record: string; share: string; consent: boolean } } | null;
export async function savePreferencesAction(_p: PrefsState, form: FormData): Promise<PrefsState> {
  const user = await getCurrentUser();
  const input = { record: String(form.get("record")), share: String(form.get("share")), consent: form.get("consent") === "on" };
  const error = validatePreferences(input);
  if (error) return { error, values: input };
  await patch(user.id, {
    autoRecordRule: input.record, autoShareRule: input.share,
    consentAcknowledgedAt: input.consent ? new Date() : null, prefsStepDone: true,
  });
  redirect("/onboarding");
}

export async function saveRoleAction(form: FormData) {
  const user = await getCurrentUser();
  const role = String(form.get("role"));
  if (!(JOB_FUNCTIONS as readonly string[]).includes(role)) redirect("/onboarding/role");
  await patch(user.id, { jobFunction: role, onboarded: true });
  redirect("/home");
}
