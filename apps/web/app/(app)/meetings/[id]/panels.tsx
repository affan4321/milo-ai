"use client";
import { useState, useTransition } from "react";
import { formatMs } from "@milo/core";
import { createTemplateAction, getSummaryAction, retryStageAction, toggleActionItemAction } from "./actions";

export interface SummaryContent { sections: { heading: string; bullets: { text: string; ms?: number }[] }[] }
export interface TemplateOpt { key: string; name: string }
export interface ActionItemView { id: string; text: string; assignee: string | null; done: boolean; sourceMs: number | null }
export interface StageView { status: string; error: string | null }

const CUSTOM = "__custom__";

export function TimeChip({ ms, onSeek }: { ms: number; onSeek: (ms: number) => void }) {
  return (
    <button onClick={() => onSeek(ms)} title="Jump to this moment"
      className="ml-1.5 rounded bg-accent/15 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-accent hover:bg-accent/25">{formatMs(ms)}</button>
  );
}

function Failed({ title, error, meetingId, stage }: { title: string; error: string | null; meetingId: string; stage: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
      <div className="font-medium">{title}</div>
      <p className="mt-1 text-muted">{error ?? "Something went wrong."}</p>
      <p className="mt-1 text-xs text-muted">The transcript and playback still work.</p>
      <button disabled={pending} onClick={() => start(() => retryStageAction(meetingId, stage))} className="mt-3 rounded border border-border px-3 py-1.5 disabled:opacity-60">{pending ? "Retrying…" : "Retry"}</button>
    </div>
  );
}

export function SummaryPanel({ meetingId, templates: initialTemplates, initial, initialKey, stage, onSeek }: {
  meetingId: string; templates: TemplateOpt[]; initial: Record<string, SummaryContent>; initialKey: string; stage: StageView | null; onSeek: (ms: number) => void;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [cache, setCache] = useState(initial);
  const [key, setKey] = useState(initialKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; prompt: string } | null>(null);

  async function load(k: string, force = false) {
    setKey(k); setError(null);
    if (cache[k] && !force) return;
    setBusy(true);
    const r = await getSummaryAction(meetingId, k, force);
    setBusy(false);
    if (r.ok) setCache((c) => ({ ...c, [k]: r.content })); else setError(r.error);
  }
  async function saveTemplate() {
    if (!form) return;
    const r = await createTemplateAction(form.name, form.prompt);
    if (!r.ok) { setError(r.error); return; }
    setTemplates((t) => [...t, { key: r.key, name: r.name }]); setForm(null); await load(r.key);
  }

  // First-pass states come from the pipeline stage; once any summary exists the template picker takes over.
  const hasAny = Object.keys(cache).length > 0;
  if (!hasAny && stage?.status === "failed") return <Failed title="Summary failed" error={stage.error} meetingId={meetingId} stage="intelligence" />;
  if (!hasAny && (!stage || stage.status !== "done")) return <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">Writing the summary… it will appear here when it's ready.</div>;

  const content = cache[key];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-muted" htmlFor="tpl">Template</label>
        <select id="tpl" value={key} disabled={busy} onChange={(e) => (e.target.value === CUSTOM ? setForm({ name: "", prompt: "" }) : load(e.target.value))}
          className="rounded border border-border bg-surface px-2 py-1">
          {templates.map((t) => <option key={t.key} value={t.key}>{t.name}{cache[t.key] ? "" : " ·"}</option>)}
          <option value={CUSTOM}>Custom prompt…</option>
        </select>
        {content && <button disabled={busy} onClick={() => load(key, true)} className="text-xs text-muted underline hover:text-text">Regenerate</button>}
      </div>
      {form && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Template name" className="w-full rounded border border-border bg-bg px-2 py-1.5" />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} rows={4} placeholder="Tell Milo what to focus on and which sections you want…" className="w-full rounded border border-border bg-bg px-2 py-1.5" />
          <div className="flex gap-2">
            <button onClick={saveTemplate} className="rounded bg-accent px-3 py-1.5 font-medium text-white">Save and generate</button>
            <button onClick={() => setForm(null)} className="rounded border border-border px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error} <button onClick={() => load(key, true)} className="underline">Try again</button></p>}
      {busy && <p className="text-sm text-muted">Writing this version of the summary…</p>}
      {!busy && content?.sections.map((s) => (
        <section key={s.heading}>
          <h3 className="mb-1 text-sm font-semibold">{s.heading}</h3>
          <ul className="space-y-1.5 text-sm">
            {s.bullets.map((b, i) => (
              <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{b.text}{b.ms !== undefined && <TimeChip ms={b.ms} onSeek={onSeek} />}</span></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ActionItemsPanel({ meetingId, items: initial, stage, onSeek }: { meetingId: string; items: ActionItemView[]; stage: StageView | null; onSeek: (ms: number) => void }) {
  const [items, setItems] = useState(initial);
  const [copied, setCopied] = useState(false);

  if (stage?.status === "failed" && !items.length) return <Failed title="Action items failed" error={stage.error} meetingId={meetingId} stage="intelligence" />;
  if (!items.length) return <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">{stage?.status === "done" ? "No action items were found in this meeting." : "Looking for action items…"}</div>;

  function toggle(id: string, done: boolean) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done } : x)));
    toggleActionItemAction(meetingId, id, done).catch(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, done: !done } : x))));
  }
  const groups = new Map<string, ActionItemView[]>();
  for (const it of items) { const k = it.assignee ?? "Unassigned"; groups.set(k, [...(groups.get(k) ?? []), it]); }
  const ordered = [...groups].sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));

  async function copy() {
    const md = ordered.map(([who, xs]) => `### ${who}\n${xs.map((x) => `- [${x.done ? "x" : " "}] ${x.text}${x.sourceMs !== null ? ` (${formatMs(x.sourceMs)})` : ""}`).join("\n")}`).join("\n\n");
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{items.filter((i) => i.done).length} of {items.length} done</span>
        <button onClick={copy} className="rounded border border-border px-2.5 py-1 text-xs hover:border-accent">{copied ? "Copied" : "Copy as Markdown"}</button>
      </div>
      {ordered.map(([who, xs]) => (
        <section key={who}>
          <h3 className="mb-1 text-sm font-semibold">{who}</h3>
          <ul className="space-y-1.5 text-sm">
            {xs.map((x) => (
              <li key={x.id} className="flex items-start gap-2">
                <input type="checkbox" checked={x.done} onChange={(e) => toggle(x.id, e.target.checked)} className="mt-1" />
                <span className={x.done ? "text-muted line-through" : ""}>{x.text}{x.sourceMs !== null && <TimeChip ms={x.sourceMs} onSeek={onSeek} />}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
