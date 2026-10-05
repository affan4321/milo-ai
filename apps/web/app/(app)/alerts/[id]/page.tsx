import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { listHits } from "@milo/notify";
import { getCurrentUser } from "@/lib/session";
import { BellRing } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { DeleteAlertButton } from "./delete-button";

export const dynamic = "force-dynamic";
const MARK_START = "«", MARK_END = "»";
function Snippet({ text }: { text: string }) {
  return <>{text.split(new RegExp(`(${MARK_START}[^${MARK_END}]*${MARK_END})`)).map((p, i) => p.startsWith(MARK_START) ? <mark key={i} className="rounded bg-warn/25 px-0.5 font-medium text-text">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</>;
}

export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getCurrentUser();
  const view = await listHits(getDb(), user.id, id);
  if (!view) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/alerts", label: "Alerts" }} eyebrow="Alert" title={<>&ldquo;{view.alert.keyword}&rdquo;</>}
        description={`${view.hits.length} ${view.hits.length === 1 ? "mention" : "mentions"} so far. New meetings are checked automatically.`}
        actions={<DeleteAlertButton id={id} keyword={view.alert.keyword} />} />
      {view.hits.length === 0 ? <EmptyState icon={BellRing} title="Not mentioned yet">This hasn&apos;t come up in any meeting. New meetings are checked automatically.</EmptyState> : (
        <ul className="card divide-y divide-border overflow-hidden">
          {view.hits.map((h) => (
            <li key={h.id}><Link href={`/meetings/${h.meetingId}?t=${h.startMs}`} className="block p-4 transition-colors hover:bg-raised">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{h.title}</span>{!h.seen && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">new</span>}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{dayLabel(h.meetingAt)}<span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">{formatMs(h.startMs)}</span></span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted"><Snippet text={h.snippet} /></p>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}
