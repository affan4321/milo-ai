"use client";
import { useState, useTransition } from "react";
import { addToPlaylistAction } from "../../playlists/actions";

/** Add this meeting (or a highlighted range of it) to a playlist, picking an existing one or naming a new one. */
export function AddToPlaylist({ meetingId, playlists, range, label = "Add to playlist" }: { meetingId: string; playlists: { id: string; name: string }[]; range?: { startMs: number; endMs: number }; label?: string }) {
  const [open, setOpen] = useState(false), [pick, setPick] = useState(playlists[0]?.id ?? "__new__"), [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null), [pending, start] = useTransition();
  function add() {
    setMsg(null);
    start(async () => {
      const r = await addToPlaylistAction(meetingId, pick === "__new__" ? { newName: name } : { playlistId: pick }, range);
      if (r.ok) { setMsg({ text: r.created ? "Added." : "Already in that playlist." }); setName(""); setOpen(false); setTimeout(() => setMsg(null), 2500); }
      else setMsg({ text: r.error, bad: true });
    });
  }
  return (
    <span className="relative inline-block text-xs">
      <button onClick={() => setOpen((o) => !o)} className="text-accent hover:underline">{label}</button>
      {msg && <span className={`ml-2 ${msg.bad ? "text-red-500" : "text-muted"}`}>{msg.text}</span>}
      {open && (
        <span className="absolute left-0 top-6 z-20 flex w-64 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded border border-border bg-bg px-2 py-1">
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__new__">New playlist…</option>
          </select>
          {pick === "__new__" && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" maxLength={80} className="rounded border border-border bg-bg px-2 py-1" />}
          <span className="flex gap-2"><button disabled={pending || (pick === "__new__" && !name.trim())} onClick={add} className="rounded bg-accent px-3 py-1 font-medium text-white disabled:opacity-60">{pending ? "Adding…" : "Add"}</button><button onClick={() => setOpen(false)} className="text-muted underline">Cancel</button></span>
        </span>
      )}
    </span>
  );
}
