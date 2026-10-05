"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@milo/db";
import { addToPlaylist, createPlaylist, deletePlaylist, moveItem, removeItem, renamePlaylist } from "@milo/playlists";
import { getCurrentUser } from "@/lib/session";

export type FormState = { error?: string } | null;

export async function createPlaylistAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const r = await createPlaylist(getDb(), user.id, String(form.get("name") ?? ""));
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/playlists");
  redirect(`/playlists/${(r as { playlist: { id: string } }).playlist.id}`);
}

/** From a meeting page: add the whole meeting (or a highlighted range) to an existing playlist, or to a new one named on the spot. */
export async function addToPlaylistAction(meetingId: string, target: { playlistId?: string; newName?: string }, range?: { startMs: number; endMs: number }): Promise<{ ok: true; playlistId: string; name: string; created: boolean } | { ok: false; error: string }> {
  const user = await getCurrentUser(); const db = getDb();
  let playlistId = target.playlistId, name = "";
  if (!playlistId) {
    const c = await createPlaylist(db, user.id, target.newName ?? "");
    if (!("playlist" in c) || !c.playlist) return { ok: false, error: ("error" in c && c.error) || "Couldn't create the playlist." };
    playlistId = c.playlist.id; name = c.playlist.name;
  }
  const r = await addToPlaylist(db, user.id, playlistId, { meetingId, startMs: range?.startMs ?? null, endMs: range?.endMs ?? null });
  if (!("item" in r) || !r.item) return { ok: false, error: ("error" in r && r.error) || "Couldn't add it." };
  revalidatePath("/playlists"); revalidatePath(`/playlists/${playlistId}`);
  return { ok: true, playlistId, name, created: r.created };
}

export async function moveItemAction(playlistId: string, itemId: string, dir: "up" | "down") { const u = await getCurrentUser(); await moveItem(getDb(), u.id, playlistId, itemId, dir); revalidatePath(`/playlists/${playlistId}`); }
export async function removeItemAction(playlistId: string, itemId: string) { const u = await getCurrentUser(); await removeItem(getDb(), u.id, playlistId, itemId); revalidatePath(`/playlists/${playlistId}`); }
export async function renamePlaylistAction(playlistId: string, name: string): Promise<FormState> { const u = await getCurrentUser(); const r = await renamePlaylist(getDb(), u.id, playlistId, name); revalidatePath(`/playlists/${playlistId}`); revalidatePath("/playlists"); return "error" in r && r.error ? { error: r.error } : null; }
export async function deletePlaylistAction(playlistId: string) { const u = await getCurrentUser(); await deletePlaylist(getDb(), u.id, playlistId); revalidatePath("/playlists"); redirect("/playlists"); }
