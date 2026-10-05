"use client";
import { useEffect, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { formatMs } from "@milo/core";
import { addLiveHighlightAction, deleteHighlightAction } from "./actions";

export interface HighlightView { id: string; startMs: number; endMs: number; note: string | null; source: string; createdBy: string | null }
const SOURCE: Record<string, string> = { live_button: "button", chat_command: "chat", after: "added later" };

/** What the owner sees while Milo is in the meeting: a running clock, who's there, and a one-press Highlight. */
export function LivePanel({ meetingId, startedAtMs, participants, highlights }: { meetingId: string; startedAtMs: number | null; participants: number | null; highlights: HighlightView[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = startedAtMs ? now - startedAtMs : null;

  function press() {
    start(async () => {
      const r = await addLiveHighlightAction(meetingId, note);
      if (r.ok) { setMsg({ text: r.created ? `Saved: ${formatMs(r.startMs)}–${formatMs(r.endMs)}` : "Already saved (same moment)" }); setNote(""); }
      else setMsg({ text: r.error, bad: true });
    });
  }
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
        <div className="p-4 sm:p-5"><div className="eyebrow flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />Recording for</div><div className="mt-1 font-mono text-2xl font-medium tabular-nums tracking-tight sm:text-3xl">{elapsed === null ? "—" : formatMs(elapsed)}</div></div>
        <div className="p-4 sm:p-5"><div className="eyebrow">In the meeting</div><div className="mt-1 text-2xl font-medium tracking-tight sm:text-3xl">{participants === null ? "—" : <>{Math.max(0, participants - 1)} <span className="text-base font-normal text-muted">{participants - 1 === 1 ? "person" : "people"}</span></>}</div></div>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200} aria-label="Highlight note" className="field min-w-0 flex-[1_1_12rem]" />
          <button disabled={pending || elapsed === null} onClick={press} className="btn btn-primary"><Star />Highlight the last 30 seconds</button>
        </div>
        {msg && <p className={`text-sm ${msg.bad ? "text-danger" : "text-success"}`} role="status">{msg.text}</p>}
        <p className="text-xs text-muted">Anyone in the meeting can also type <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-text">/milo highlight</code> in the chat.</p>
      </div>
      {highlights.length > 0 && (
        <ul className="divide-y divide-border border-t border-border text-sm">
          {highlights.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-2.5">
              <span className="min-w-0"><span className="mr-2 font-mono text-xs text-accent-ink">{formatMs(h.startMs)}–{formatMs(h.endMs)}</span>{h.note ?? "Highlight"} <span className="text-xs text-subtle">· {SOURCE[h.source] ?? h.source}{h.createdBy ? ` · ${h.createdBy}` : ""}</span></span>
              <button onClick={() => start(() => deleteHighlightAction(meetingId, h.id))} className="btn btn-ghost btn-danger btn-sm">Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
