import { eq } from "drizzle-orm";
import { getDb, preferences, users } from "@milo/db";
import { nextStep } from "./onboarding";

export async function getPrefs(userId: string) {
  const db = getDb();
  await db.insert(preferences).values({ userId }).onConflictDoNothing();
  const [p] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  return p!;
}

export async function currentStep(user: typeof users.$inferSelect) {
  const p = await getPrefs(user.id);
  return nextStep({ email: user.email, accountChosen: p.accountChosen, calendarDone: p.calendarStepDone, prefsDone: p.prefsStepDone, jobFunction: p.jobFunction });
}
