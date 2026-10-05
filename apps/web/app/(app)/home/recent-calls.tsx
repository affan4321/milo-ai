"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Trash2, Upload, Video } from "lucide-react";
import { Badge, IconTile } from "@/components/ui";
import { deleteCallsAction } from "./actions";

export type RecentCall = { id: string; title: string; sub: string; upload: boolean; status: "ready" | "failed" | "processing" };

const StatusBadge = ({ s }: { s: RecentCall["status"] }) => s === "ready" ? <Badge tone="success" dot>Ready</Badge> : s === "failed" ? <Badge tone="danger" dot>Failed</Badge> : <Badge tone="warn" dot pulse>Processing</Badge>;

/** The Recent calls list, with select-and-delete. Deleting is permanent, so it always asks first and says what goes with the call. */
export function RecentCalls({ items }: { items: RecentCall[] }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const leave = () => { setSelecting(false); setPicked(new Set()); };
  const remove = (ids: string[], what: string) => {
    if (!ids.length || pending) return;
    if (!window.confirm(`Permanently delete ${what}? This removes the recording, transcript, summary and any shared clip links. It can't be undone.`)) return;
    setMsg(null);
    start(async () => {
      const r = await deleteCallsAction(ids);
      if (!r.ok) { setMsg({ tone: "err", text: r.error }); return; }
      const busy = r.busy ? ` ${r.busy} ${r.busy === 1 ? "call is" : "calls are"} still recording or processing, so ${r.busy === 1 ? "it was" : "they were"} kept. Try again when finished.` : "";
      setMsg({ tone: "ok", text: `Deleted ${r.deleted} ${r.deleted === 1 ? "call" : "calls"}.${busy}` });
      leave(); router.refresh();
    });
  };
  const all = picked.size === items.length && items.length > 0;
  const n = picked.size;

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2 text-sm">
          {!selecting ? (
            <>
              <button onClick={() => setSelecting(true)} className="btn btn-secondary btn-sm">Select</button>
              <button disabled={pending} onClick={() => remove(items.map((i) => i.id), items.length === 1 ? "this call" : `all ${items.length} calls shown`)} className="btn btn-ghost btn-sm"><Trash2 />Clear all</button>
            </>
          ) : (
            <>
              <label className="mr-auto flex cursor-pointer items-center gap-2 text-muted"><input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(items.map((i) => i.id)))} aria-label="Select all calls" />{n ? `${n} selected` : "Select all"}</label>
              <button disabled={!n || pending} onClick={() => remove([...picked], n === 1 ? "this call" : `these ${n} calls`)} className="btn btn-danger btn-sm"><Trash2 />{pending ? "Deleting…" : `Delete${n ? ` (${n})` : ""}`}</button>
              <button disabled={pending} onClick={leave} className="btn btn-ghost btn-sm">Cancel</button>
            </>
          )}
        </div>
      )}
      {msg && <p role="status" className={`mb-2 text-sm ${msg.tone === "err" ? "text-danger" : "text-muted"}`}>{msg.text}</p>}
      <ul className="card divide-y divide-border overflow-hidden">
        {items.map((m) => {
          const body = (
            <>
              {selecting && <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${m.title}`} className="h-4 w-4 shrink-0" />}
              <IconTile icon={m.upload ? Upload : Video} tone="accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.title}</div>
                <div className="mt-0.5 truncate text-sm text-muted">{m.sub}</div>
              </div>
              <StatusBadge s={m.status} />
              {!selecting && <ArrowRight className="hidden h-4 w-4 shrink-0 text-subtle transition-transform sm:block group-hover:translate-x-0.5 group-hover:text-text" />}
            </>
          );
          const cls = "group flex items-center gap-3 p-3 transition-colors hover:bg-raised sm:gap-4 sm:p-4";
          return <li key={m.id}>{selecting ? <div onClick={() => toggle(m.id)} className={`${cls} cursor-pointer ${picked.has(m.id) ? "bg-raised" : ""}`}>{body}</div> : <Link href={`/meetings/${m.id}`} className={cls}>{body}</Link>}</li>;
        })}
      </ul>
    </div>
  );
}
