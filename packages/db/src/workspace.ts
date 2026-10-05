import { and, eq } from "drizzle-orm";
import { emailDomain, isPersonalEmail } from "@milo/core";
import { memberships, users, workspaces } from "./schema";
import type { Db } from "./client";

/**
 * The workspace a user's meetings belong to, creating it on first use.
 * Work emails share one workspace per domain (teammates land together); personal emails get a private one of their own.
 * Seeing a teammate's meeting additionally needs that meeting's `visibility = "team"`, so joining by domain exposes nothing by itself.
 */
export async function ensureWorkspace(db: Db, userId: string): Promise<string> {
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
  if (m) return m.workspaceId;
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("user not found");
  let workspaceId: string, role = "owner";
  if (isPersonalEmail(u.email)) {
    workspaceId = (await db.insert(workspaces).values({ name: `${u.name ?? u.email}'s notes` }).returning())[0]!.id;
  } else {
    const domain = emailDomain(u.email);
    const [existing] = await db.select().from(workspaces).where(eq(workspaces.name, domain));
    if (existing) { workspaceId = existing.id; role = "member"; }
    else workspaceId = (await db.insert(workspaces).values({ name: domain }).returning())[0]!.id;
  }
  await db.insert(memberships).values({ userId, workspaceId, role }).onConflictDoNothing();
  const [again] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  return again!.workspaceId;
}
