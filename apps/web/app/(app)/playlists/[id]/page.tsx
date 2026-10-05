import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { getPlaylist } from "@milo/playlists";
import { getCurrentUser } from "@/lib/session";
import { ChevronLeft, ListVideo } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { PlaylistControls, ItemControls } from "./controls";

export const dynamic = "force-dynamic";

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getCurrentUser();
  const view = await getPlaylist(getDb(), user.id, id);
  if (!view) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/playlists" className="-ml-1 mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ChevronLeft className="h-4 w-4" />Playlists</Link>
      <PlaylistControls id={id} name={view.playlist.name} count={view.items.length} />
      {view.items.length === 0 ? <EmptyState icon={ListVideo} title="This playlist is empty">Open a meeting and use &ldquo;Add to playlist&rdquo;, or add a highlight.</EmptyState> : (
        <ol className="card divide-y divide-border overflow-hidden">
          {view.items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-3 p-3 transition-colors hover:bg-raised/60 sm:gap-4 sm:pl-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {it.available
                  ? <Link href={`/meetings/${it.meetingId}${it.startMs !== null ? `?t=${it.startMs}` : ""}`} className="block truncate font-medium hover:text-accent-ink">{it.title}</Link>
                  : <span className="block truncate text-muted">{it.title}</span>}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {it.startMs !== null && it.endMs !== null ? <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">{formatMs(it.startMs)}–{formatMs(it.endMs)}</span> : <span>Whole meeting</span>}
                  <span>{dayLabel(it.meetingAt)}</span>{!it.available && <span className="text-warn">No longer available to you</span>}
                </div>
              </div>
              <ItemControls playlistId={id} itemId={it.id} first={i === 0} last={i === view.items.length - 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
