import { and, asc, eq, sql } from "drizzle-orm";
import { ensureWorkspace, playlistItems, playlists, type Db } from "@milo/db";

export const MAX_PLAYLISTS = 50, MAX_ITEMS = 200;
const cleanName = (n: string) => n.trim().replace(/\s+/g, " ").slice(0, 80);

/** A meeting the user may put in a playlist: their own, or a teammate's that was shared with the team (same rule as search). */
async function canSee(db: Db, userId: string, meetingId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM meetings m WHERE m.id = ${meetingId} AND m.status = 'ready'
      AND (m.owner_id = ${userId} OR (m.visibility = 'team' AND m.workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = ${userId}))) LIMIT 1`) as unknown as unknown[];
  return r.length > 0;
}
const owned = async (db: Db, userId: string, id: string) => (await db.select().from(playlists).where(and(eq(playlists.id, id), eq(playlists.ownerId, userId))))[0] ?? null;

export async function createPlaylist(db: Db, userId: string, name: string) {
  const n = cleanName(name);
  if (!n) return { error: "Give the playlist a name." as const };
  const mine = await db.select().from(playlists).where(eq(playlists.ownerId, userId));
  if (mine.length >= MAX_PLAYLISTS) return { error: `You can have up to ${MAX_PLAYLISTS} playlists.` as const };
  if (mine.some((p) => p.name.toLowerCase() === n.toLowerCase())) return { error: "You already have a playlist with that name." as const };
  const [p] = await db.insert(playlists).values({ ownerId: userId, workspaceId: await ensureWorkspace(db, userId), name: n }).returning();
  return { playlist: p! };
}

export async function renamePlaylist(db: Db, userId: string, id: string, name: string) {
  const n = cleanName(name); if (!n) return { error: "Give the playlist a name." as const };
  if (!(await owned(db, userId, id))) return { error: "Playlist not found." as const };
  const clash = (await db.select().from(playlists).where(eq(playlists.ownerId, userId))).some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
  if (clash) return { error: "You already have a playlist with that name." as const };
  await db.update(playlists).set({ name: n }).where(eq(playlists.id, id)); return { ok: true as const };
}
export const deletePlaylist = async (db: Db, userId: string, id: string) => (await db.delete(playlists).where(and(eq(playlists.id, id), eq(playlists.ownerId, userId))).returning()).length > 0;

export async function listPlaylists(db: Db, userId: string) {
  const rows = await db.execute(sql`SELECT p.id, p.name, p.created_at, (SELECT count(*)::int FROM playlist_items i WHERE i.playlist_id = p.id) AS items FROM playlists p WHERE p.owner_id = ${userId} ORDER BY p.created_at DESC`) as unknown as { id: string; name: string; created_at: string; items: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, items: r.items, createdAt: new Date(r.created_at) }));
}

/** Add a whole meeting, or a range of one. Adding the same thing twice is a no-op. */
export async function addToPlaylist(db: Db, userId: string, playlistId: string, a: { meetingId: string; startMs?: number | null; endMs?: number | null }) {
  if (!(await owned(db, userId, playlistId))) return { error: "Playlist not found." as const };
  if (!(await canSee(db, userId, a.meetingId))) return { error: "That meeting isn't available to you." as const };
  const hasRange = typeof a.startMs === "number" && typeof a.endMs === "number";
  if (hasRange && (!Number.isFinite(a.startMs) || !Number.isFinite(a.endMs) || a.endMs! <= a.startMs!)) return { error: "That range isn't valid." as const };
  const startMs = hasRange ? Math.max(0, Math.round(a.startMs!)) : null, endMs = hasRange ? Math.round(a.endMs!) : null;
  const items = await db.select().from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(asc(playlistItems.position));
  const dup = items.find((i) => i.meetingId === a.meetingId && (i.startMs ?? null) === startMs && (i.endMs ?? null) === endMs);
  if (dup) return { item: dup, created: false as const };
  if (items.length >= MAX_ITEMS) return { error: `A playlist can hold up to ${MAX_ITEMS} items.` as const };
  const [item] = await db.insert(playlistItems).values({ playlistId, meetingId: a.meetingId, startMs, endMs, position: (items.at(-1)?.position ?? -1) + 1 }).returning();
  return { item: item!, created: true as const };
}

export async function removeItem(db: Db, userId: string, playlistId: string, itemId: string) {
  if (!(await owned(db, userId, playlistId))) return false;
  return (await db.delete(playlistItems).where(and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, playlistId))).returning()).length > 0;
}

/** Move one item up or down by swapping positions with its neighbour. */
export async function moveItem(db: Db, userId: string, playlistId: string, itemId: string, dir: "up" | "down") {
  if (!(await owned(db, userId, playlistId))) return false;
  const items = await db.select().from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(asc(playlistItems.position), asc(playlistItems.id));
  const i = items.findIndex((x) => x.id === itemId), j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= items.length) return false;
  // Re-number everything so ties or gaps can never make a swap a no-op.
  const order = items.map((x) => x.id); [order[i], order[j]] = [order[j]!, order[i]!];
  await db.transaction(async (tx) => { for (const [pos, id] of order.entries()) await tx.update(playlistItems).set({ position: pos }).where(eq(playlistItems.id, id)); });
  return true;
}

/** A playlist with its items resolved. An item whose meeting is no longer visible to the user stays listed but marked unavailable. */
export async function getPlaylist(db: Db, userId: string, id: string) {
  const p = await owned(db, userId, id); if (!p) return null;
  const rows = await db.execute(sql`
    SELECT i.id, i.meeting_id, i.start_ms, i.end_ms, i.position, m.title, m.created_at AS meeting_at,
           (m.status = 'ready' AND (m.owner_id = ${userId} OR (m.visibility = 'team' AND m.workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = ${userId})))) AS available
    FROM playlist_items i JOIN meetings m ON m.id = i.meeting_id WHERE i.playlist_id = ${id} ORDER BY i.position, i.id`) as unknown as { id: string; meeting_id: string; start_ms: number | null; end_ms: number | null; title: string; meeting_at: string; available: boolean }[];
  return { playlist: p, items: rows.map((r) => ({ id: r.id, meetingId: r.meeting_id, startMs: r.start_ms, endMs: r.end_ms, title: r.available ? r.title : "Unavailable meeting", meetingAt: new Date(r.meeting_at), available: r.available })) };
}
