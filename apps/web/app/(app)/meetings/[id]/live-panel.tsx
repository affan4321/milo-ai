"use client";
import { useEffect, useState, useTransition } from "react";
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
    <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div><div className="text-xs text-muted">Recording for</div><div className="font-mono text-2xl">{elapsed === null ? "—" : formatMs(elapsed)}</div></div>
        <div><div className="text-xs text-muted">In the meeting</div><div className="text-lg">{participants === null ? "—" : `${Math.max(0, participants - 1)} ${participants - 1 === 1 ? "person" : "people"}`}</div></div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending || elapsed === null} onClick={press} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">★ Highlight the last 30 seconds</button>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200} className="min-w-0 flex-1 rounded border border-border bg-bg px-3 py-2 text-sm" />
        </div>
        {msg && <p className={`text-sm ${msg.bad ? "text-red-500" : "text-muted"}`}>{msg.text}</p>}
        <p className="text-xs text-muted">Anyone in the meeting can also type <code className="rounded bg-bg px-1">/milo highlight</code> in the chat.</p>
      </div>
      {highlights.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border text-sm">
          {highlights.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span><span className="font-mono text-xs text-muted">{formatMs(h.startMs)}–{formatMs(h.endMs)}</span> {h.note ?? "Highlight"} <span className="text-xs text-muted">· {SOURCE[h.source] ?? h.source}{h.createdBy ? ` · ${h.createdBy}` : ""}</span></span>
              <button onClick={() => start(() => deleteHighlightAction(meetingId, h.id))} className="text-xs text-muted hover:text-text">Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
