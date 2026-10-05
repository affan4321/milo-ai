import Link from "next/link";
import { getDb } from "@milo/db";
import { listPlaylists } from "@milo/playlists";
import { getCurrentUser } from "@/lib/session";
import { HomeTabs } from "../home-tabs";
import { NewPlaylistForm } from "./new-playlist-form";

export const dynamic = "force-dynamic";

export default async function PlaylistsPage() {
  const user = await getCurrentUser();
  const lists = await listPlaylists(getDb(), user.id);
  return (
    <div className="max-w-3xl space-y-6">
      <HomeTabs active="playlists" />
      <p className="text-sm text-muted">Collect whole meetings or specific moments in one place, in the order you want, for example customer objections or great demos.</p>
      <NewPlaylistForm />
      {lists.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">No playlists yet. Create one above, then use &ldquo;Add to playlist&rdquo; on any meeting or highlight.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {lists.map((p) => (
            <li key={p.id}><Link href={`/playlists/${p.id}`} className="flex items-center justify-between p-4 hover:bg-bg"><span className="font-medium">{p.name}</span><span className="text-sm text-muted">{p.items} {p.items === 1 ? "item" : "items"}</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
