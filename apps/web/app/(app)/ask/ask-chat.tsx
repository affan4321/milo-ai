"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMs } from "@milo/core";
import { askAction, editAction } from "./actions";

type Scope = "my" | "team" | "all";
interface Citation { n: number; meetingId: string; title: string; startMs: number; speaker: string; snippet: string }
interface Msg { id: string; role: "user" | "assistant"; content: string; citations: Citation[] }
const SCOPES: { value: Scope; label: string }[] = [{ value: "my", label: "My calls" }, { value: "team", label: "Team calls" }, { value: "all", label: "All calls" }];
const EXAMPLES = ["What did we decide about pricing?", "What action items did I take on this week?", "What concerns did customers raise?"];
const NOTE = "Answered from keyword matches only; meaning-based matching is unavailable right now.";

/** Turns [1] markers in an answer into links to the cited moment. */
function Answer({ text, citations }: { text: string; citations: Citation[] }) {
  return <>{text.split(/(\[\d+\])/).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part); const c = m && citations.find((x) => x.n === Number(m[1]));
    return c ? <Link key={i} href={`/meetings/${c.meetingId}?t=${c.startMs}`} title={`${c.title} · ${formatMs(c.startMs)}`} className="mx-0.5 rounded bg-accent/15 px-1 text-xs font-medium text-accent hover:bg-accent/25">{c.n}</Link> : <span key={i}>{part}</span>;
  })}</>;
}

export function AskChat({ initial }: { initial: { threadId: string; scope: Scope; messages: Msg[] } | null }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>(initial?.messages ?? []);
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "my");
  const [threadId, setThreadId] = useState<string | null>(initial?.threadId ?? null);
  const [q, setQ] = useState("");
  const [pendingQ, setPendingQ] = useState<string | null>(null);   // shown immediately while the answer is being worked out
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  function apply(r: Awaited<ReturnType<typeof askAction>>) {
    if ("error" in r) { setError(r.error); return false; }
    setMsgs(r.messages); setDegraded(r.degraded);
    if (!threadId) { setThreadId(r.threadId); window.history.replaceState(null, "", `/ask/${r.threadId}`); } // the chat now has a permanent address
    router.refresh();                                                                                       // updates the saved-chats list
    setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    return true;
  }
  function send(question: string) {
    const text = question.trim(); if (!text || pending) return;
    setError(null); setQ(""); setPendingQ(text);
    start(async () => { const r = await askAction(text, scope, threadId); setPendingQ(null); if (!apply(r)) setQ(text); });
  }
  function saveEdit() {
    if (!editing || !threadId || pending) return;
    const { id, text } = editing; if (!text.trim()) return;
    setError(null);
    start(async () => { const r = await editAction(threadId, id, text, scope); if (apply(r)) setEditing(null); });
  }
  function reset() { setMsgs([]); setThreadId(null); setError(null); setEditing(null); setDegraded(false); setQ(""); window.history.replaceState(null, "", "/ask"); }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ask Milo</h1>
        <div className="flex items-center gap-3 text-sm">
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="rounded border border-border bg-surface px-2 py-1" aria-label="Which meetings to search">{SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          {msgs.length > 0 && <button onClick={reset} className="text-xs text-muted underline hover:text-text">New chat</button>}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4">
        {msgs.length === 0 && !pendingQ && (
          <div className="space-y-3 text-sm text-muted">
            <p>Ask a question about your meetings. Answers cite the exact moments they come from, and this chat is saved so you can come back to it.</p>
            <div className="flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x} onClick={() => send(x)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-accent hover:text-text">{x}</button>)}</div>
          </div>
        )}
        {msgs.map((m) => m.role === "user" ? (
          <div key={m.id} className="group ml-auto max-w-[85%]">
            {editing?.id === m.id ? (
              <div className="space-y-2 rounded-lg border border-accent p-2">
                <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} rows={2} maxLength={1000} className="w-full resize-y rounded border border-border bg-bg px-2 py-1.5 text-sm" />
                <p className="text-xs text-muted">Saving replaces this question and everything after it with a new answer.</p>
                <div className="flex gap-2"><button disabled={pending || !editing.text.trim()} onClick={saveEdit} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">{pending ? "Asking…" : "Save and ask again"}</button><button disabled={pending} onClick={() => { setEditing(null); setError(null); }} className="rounded border border-border px-3 py-1 text-xs">Cancel</button></div>
              </div>
            ) : (
              <div className="flex items-start justify-end gap-2">
                <button onClick={() => { setEditing({ id: m.id, text: m.content }); setError(null); }} disabled={pending} title="Edit this question" aria-label="Edit this question" className="invisible mt-1 text-xs text-muted hover:text-text group-hover:visible">✎ Edit</button>
                <div className="rounded-lg bg-accent px-3 py-2 text-sm text-white">{m.content}</div>
              </div>
            )}
          </div>
        ) : (
          <div key={m.id} className="max-w-[92%] space-y-2 text-sm">
            <p className="leading-relaxed"><Answer text={m.content} citations={m.citations} /></p>
            {m.citations.length > 0 && (
              <ol className="space-y-1 border-l-2 border-border pl-3 text-xs text-muted">
                {m.citations.map((c) => (
                  <li key={c.n}><Link href={`/meetings/${c.meetingId}?t=${c.startMs}`} className="hover:text-text"><span className="font-medium text-accent">[{c.n}]</span> {c.title} · <span className="font-mono">{formatMs(c.startMs)}</span> · {c.speaker}: <span className="italic">{c.snippet.replace(/\n/g, " ").slice(0, 110)}</span></Link></li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {pendingQ && <div className="ml-auto max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm text-white">{pendingQ}</div>}
        {pending && <p className="text-sm text-muted">Looking through your meetings…</p>}
        {degraded && !pending && <p className="text-xs text-amber-500">{NOTE}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="mt-3 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={threadId ? "Ask a follow-up" : "Ask anything about your meetings"} className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-sm" />
        <button disabled={pending || !q.trim()} className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Ask</button>
      </form>
    </div>
  );
}
