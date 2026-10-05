import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { getPlaylist } from "@milo/playlists";
import { getCurrentUser } from "@/lib/session";
import { PlaylistControls, ItemControls } from "./controls";

export const dynamic = "force-dynamic";

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getCurrentUser();
  const view = await getPlaylist(getDb(), user.id, id);
  if (!view) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/playlists" className="text-sm text-muted hover:text-text">← Playlists</Link>
      <PlaylistControls id={id} name={view.playlist.name} count={view.items.length} />
      {view.items.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">Empty. Open a meeting and use &ldquo;Add to playlist&rdquo;, or add a highlight.</p> : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
          {view.items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-3 p-3">
              <span className="w-6 text-center font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {it.available
                  ? <Link href={`/meetings/${it.meetingId}${it.startMs !== null ? `?t=${it.startMs}` : ""}`} className="font-medium hover:underline">{it.title}</Link>
                  : <span className="text-muted">{it.title}</span>}
                <div className="text-xs text-muted">{it.startMs !== null && it.endMs !== null ? `${formatMs(it.startMs)}–${formatMs(it.endMs)}` : "Whole meeting"} · {it.meetingAt.toLocaleDateString()}{!it.available && " · no longer available to you"}</div>
              </div>
              <ItemControls playlistId={id} itemId={it.id} first={i === 0} last={i === view.items.length - 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
