import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, users, preferences } from "@milo/db";
import { auth } from "@/auth";

/**
 * Signed-in user, or redirect to /sign-in. With no Google credentials configured (local dev without keys) it
 * falls back to a single dev user so the app is still usable.
 */
export async function getCurrentUser() {
  const db = getDb();
  if (!process.env.GOOGLE_CLIENT_ID) {
    const email = process.env.DEV_USER_EMAIL ?? "dev@milo.local";
    const [found] = await db.select().from(users).where(eq(users.email, email));
    if (found) return found;
    const [user] = await db.insert(users).values({ email, name: "Dev User" }).returning();
    await db.insert(preferences).values({ userId: user!.id });
    return user!;
  }
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) redirect("/sign-in");
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) redirect("/sign-in");
  return user;
}
