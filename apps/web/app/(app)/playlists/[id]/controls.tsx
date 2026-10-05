"use client";
import { useState, useTransition } from "react";
import { deletePlaylistAction, moveItemAction, removeItemAction, renamePlaylistAction } from "../actions";

export function PlaylistControls({ id, name, count }: { id: string; name: string; count: number }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(name), [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => { const r = await renamePlaylistAction(id, draft); if (r?.error) setErr(r.error); else { setErr(null); setEditing(false); } });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {editing ? (
        <div className="flex items-center gap-2"><input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80} className="rounded border border-border bg-surface px-2 py-1 text-lg font-semibold" />
          <button disabled={pending} onClick={save} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white">Save</button><button onClick={() => { setEditing(false); setDraft(name); setErr(null); }} className="text-xs text-muted underline">Cancel</button></div>
      ) : <h1 className="text-xl font-semibold">{name} <span className="ml-2 text-sm font-normal text-muted">{count} {count === 1 ? "item" : "items"}</span></h1>}
      <div className="flex gap-3 text-xs">
        {!editing && <button onClick={() => setEditing(true)} className="text-muted underline hover:text-text">Rename</button>}
        <button disabled={pending} onClick={() => { if (window.confirm(`Delete the playlist “${name}”? The meetings in it are not affected.`)) start(() => deletePlaylistAction(id)); }} className="text-muted underline hover:text-red-500">Delete</button>
      </div>
      {err && <p className="w-full text-sm text-red-500">{err}</p>}
    </div>
  );
}

export function ItemControls({ playlistId, itemId, first, last }: { playlistId: string; itemId: string; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  const b = "rounded border border-border px-2 py-1 text-xs hover:border-accent disabled:opacity-40";
  return (
    <div className="flex shrink-0 gap-1">
      <button disabled={pending || first} onClick={() => start(() => moveItemAction(playlistId, itemId, "up"))} className={b} aria-label="Move up" title="Move up">↑</button>
      <button disabled={pending || last} onClick={() => start(() => moveItemAction(playlistId, itemId, "down"))} className={b} aria-label="Move down" title="Move down">↓</button>
      <button disabled={pending} onClick={() => start(() => removeItemAction(playlistId, itemId))} className={b} aria-label="Remove from playlist" title="Remove">✕</button>
    </div>
  );
}
