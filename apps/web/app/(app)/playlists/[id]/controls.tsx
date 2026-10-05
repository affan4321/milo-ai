"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2, X } from "lucide-react";
import { deletePlaylistAction, moveItemAction, removeItemAction, renamePlaylistAction } from "../actions";

export function PlaylistControls({ id, name, count }: { id: string; name: string; count: number }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(name), [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => { const r = await renamePlaylistAction(id, draft); if (r?.error) setErr(r.error); else { setErr(null); setEditing(false); } });
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2"><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} aria-label="Playlist name" className="field field-lg font-semibold" />
          <button disabled={pending} onClick={save} className="btn btn-primary">Save</button><button onClick={() => { setEditing(false); setDraft(name); setErr(null); }} className="btn btn-ghost">Cancel</button></div>
      ) : <div><h1 className="text-2xl font-semibold tracking-tight">{name}</h1><p className="mt-1 text-sm text-muted">{count} {count === 1 ? "item" : "items"}, played in this order</p></div>}
      <div className="flex gap-2">
        {!editing && <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm"><Pencil />Rename</button>}
        <button disabled={pending} onClick={() => { if (window.confirm(`Delete the playlist “${name}”? The meetings in it are not affected.`)) start(() => deletePlaylistAction(id)); }} className="btn btn-ghost btn-danger btn-sm"><Trash2 />Delete</button>
      </div>
      {err && <p className="w-full text-sm text-danger">{err}</p>}
    </div>
  );
}

export function ItemControls({ playlistId, itemId, first, last }: { playlistId: string; itemId: string; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const b = "btn btn-ghost btn-sm btn-icon";
  return (
    <div className="flex shrink-0 gap-0.5">
      <button disabled={pending || first} onClick={() => start(() => moveItemAction(playlistId, itemId, "up"))} className={b} aria-label="Move up" title="Move up"><ArrowUp /></button>
      <button disabled={pending || last} onClick={() => start(() => moveItemAction(playlistId, itemId, "down"))} className={b} aria-label="Move down" title="Move down"><ArrowDown /></button>
      <button disabled={pending} onClick={() => start(() => removeItemAction(playlistId, itemId))} className={`${b} btn-danger`} aria-label="Remove from playlist" title="Remove"><X /></button>
    </div>
  );
}
