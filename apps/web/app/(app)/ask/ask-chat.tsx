"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMs } from "@milo/core";
import { ArrowUp, MessageSquarePlus, Pencil, Sparkles } from "lucide-react";
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
    return c ? <Link key={i} href={`/meetings/${c.meetingId}?t=${c.startMs}`} title={`${c.title} · ${formatMs(c.startMs)}`} className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent/15 px-1 align-text-top text-[11px] font-semibold text-accent-ink transition-colors hover:bg-accent hover:text-white">{c.n}</Link> : <span key={i}>{part}</span>;
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

  const empty = msgs.length === 0 && !pendingQ;
  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[28rem] flex-col lg:h-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Sparkles className="h-5 w-5 text-accent-ink" />Ask Milo</h1>
        <div className="flex items-center gap-2">
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="field field-sm" aria-label="Which meetings to search">{SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          {msgs.length > 0 && <button onClick={reset} className="btn btn-secondary btn-sm"><MessageSquarePlus />New chat</button>}
        </div>
      </div>
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {empty ? (
            <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#06B6D4] text-white shadow-pop"><Sparkles className="h-6 w-6" /></span>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">What do you want to know?</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">Ask a question about your meetings. Answers cite the exact moments they come from, and this chat is saved so you can come back to it.</p>
              <div className="mt-6 grid w-full grid-cols-1 gap-2">
                {EXAMPLES.map((x) => <button key={x} onClick={() => send(x)} className="rounded-xl border border-border bg-bg px-4 py-3 text-left text-sm transition-colors hover:border-accent hover:bg-accent/[0.06]">{x}</button>)}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6">
              {msgs.map((m) => m.role === "user" ? (
                <div key={m.id} className="group ml-auto max-w-[92%] sm:max-w-[85%]">
                  {editing?.id === m.id ? (
                    <div className="space-y-2 rounded-xl border border-accent bg-bg p-3">
                      <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} rows={2} maxLength={1000} className="field w-full resize-y" />
                      <p className="text-xs text-muted">Saving replaces this question and everything after it with a new answer.</p>
                      <div className="flex gap-2"><button disabled={pending || !editing.text.trim()} onClick={saveEdit} className="btn btn-primary btn-sm">{pending ? "Asking…" : "Save and ask again"}</button><button disabled={pending} onClick={() => { setEditing(null); setError(null); }} className="btn btn-secondary btn-sm">Cancel</button></div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditing({ id: m.id, text: m.content }); setError(null); }} disabled={pending} title="Edit this question" aria-label="Edit this question" className="btn btn-ghost btn-sm btn-icon opacity-0 focus-visible:opacity-100 group-hover:opacity-100"><Pencil /></button>
                      <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-white">{m.content}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink"><Sparkles className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1 space-y-3 text-sm">
                    <p className="whitespace-pre-wrap leading-relaxed"><Answer text={m.content} citations={m.citations} /></p>
                    {m.citations.length > 0 && (
                      <div>
                        <div className="eyebrow mb-1.5">Sources</div>
                        <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {m.citations.map((c) => (
                            <li key={c.n}><Link href={`/meetings/${c.meetingId}?t=${c.startMs}`} className="flex h-full gap-2.5 rounded-lg border border-border bg-bg p-2.5 text-xs transition-colors hover:border-accent">
                              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent-ink">{c.n}</span>
                              <span className="min-w-0"><span className="block truncate font-medium text-text">{c.title}</span>
                                <span className="text-subtle"><span className="font-mono">{formatMs(c.startMs)}</span> · {c.speaker}</span>
                                <span className="mt-1 line-clamp-2 text-muted">{c.snippet.replace(/\n/g, " ").slice(0, 110)}</span></span>
                            </Link></li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {pendingQ && <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-white">{pendingQ}</div>}
              {pending && (
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent-ink"><Sparkles className="h-3.5 w-3.5" /></span>
                  Looking through your meetings
                  <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent-ink [animation:typing_1.2s_infinite]" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
                </div>
              )}
              {degraded && !pending && <p className="text-xs text-warn">{NOTE}</p>}
              <div ref={end} />
            </div>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="border-t border-border bg-bg/50 p-3">
          {error && <p className="mx-auto mb-2 max-w-3xl px-1 text-sm text-danger" role="alert">{error}</p>}
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-border-strong bg-surface p-1.5 pl-4 transition-shadow focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder={threadId ? "Ask a follow-up" : "Ask anything about your meetings"} aria-label="Your question" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle" />
            <button disabled={pending || !q.trim()} aria-label="Ask" title="Ask" className="btn btn-primary btn-icon"><ArrowUp /></button>
          </div>
        </form>
      </div>
    </div>
  );
}
