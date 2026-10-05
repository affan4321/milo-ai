import Link from "next/link";
import { getDb } from "@milo/db";
import { listPlaylists } from "@milo/playlists";
import { getCurrentUser } from "@/lib/session";
import { ArrowRight, ListVideo } from "lucide-react";
import { EmptyState, IconTile, PageHeader } from "@/components/ui";
import { NewPlaylistForm } from "./new-playlist-form";

export const dynamic = "force-dynamic";

export default async function PlaylistsPage() {
  const user = await getCurrentUser();
  const lists = await listPlaylists(getDb(), user.id);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Playlists" description="Collect whole meetings or specific moments in one place, in the order you want, for example customer objections or great demos." />
      <div className="space-y-6">
        <NewPlaylistForm />
        {lists.length === 0 ? <EmptyState icon={ListVideo} title="No playlists yet">Create one above, then use &ldquo;Add to playlist&rdquo; on any meeting or highlight.</EmptyState> : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {lists.map((p) => (
              <li key={p.id}><Link href={`/playlists/${p.id}`} className="card group flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop">
                <IconTile icon={ListVideo} tone="accent" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="text-sm text-muted">{p.items} {p.items === 1 ? "item" : "items"}</span></span>
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-subtle transition-transform sm:block group-hover:translate-x-0.5 group-hover:text-text" />
              </Link></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
