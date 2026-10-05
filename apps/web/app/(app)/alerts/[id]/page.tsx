import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { listHits } from "@milo/notify";
import { getCurrentUser } from "@/lib/session";
import { DeleteAlertButton } from "./delete-button";

export const dynamic = "force-dynamic";
const MARK_START = "«", MARK_END = "»";
function Snippet({ text }: { text: string }) {
  return <>{text.split(new RegExp(`(${MARK_START}[^${MARK_END}]*${MARK_END})`)).map((p, i) => p.startsWith(MARK_START) ? <mark key={i} className="rounded bg-amber-400/30 px-0.5 text-text">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</>;
}

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getCurrentUser();
  const view = await listHits(getDb(), user.id, id);
  if (!view) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/alerts" className="text-sm text-muted hover:text-text">← Alerts</Link>
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">&ldquo;{view.alert.keyword}&rdquo;</h1><DeleteAlertButton id={id} keyword={view.alert.keyword} /></div>
      {view.hits.length === 0 ? <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted">Not mentioned in any meeting yet. New meetings are checked automatically.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {view.hits.map((h) => (
            <li key={h.id}><Link href={`/meetings/${h.meetingId}?t=${h.startMs}`} className="block p-3 hover:bg-bg">
              <div className="flex items-center justify-between text-sm"><span className="font-medium">{h.title}</span><span className="text-xs text-muted">{h.meetingAt.toLocaleDateString()} · <span className="font-mono">{formatMs(h.startMs)}</span>{!h.seen && <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">new</span>}</span></div>
              <p className="mt-1 text-sm text-muted"><Snippet text={h.snippet} /></p>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
