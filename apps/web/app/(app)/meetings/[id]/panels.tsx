"use client";
import { useState, useTransition } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { formatMs } from "@milo/core";
import { Notice, Working } from "@/components/ui";
import { createTemplateAction, getSummaryAction, retryStageAction, toggleActionItemAction } from "./actions";

export interface SummaryContent { sections: { heading: string; bullets: { text: string; ms?: number }[] }[] }
export interface TemplateOpt { key: string; name: string }
export interface ActionItemView { id: string; text: string; assignee: string | null; done: boolean; sourceMs: number | null }
export interface StageView { status: string; error: string | null }

const CUSTOM = "__custom__";

export function TimeChip({ ms, onSeek }: { ms: number; onSeek: (ms: number) => void }) {
  return (
    <button onClick={() => onSeek(ms)} title="Jump to this moment"
      className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-accent-ink transition-colors hover:bg-accent hover:text-white">{formatMs(ms)}</button>
  );
}

function Failed({ title, error, meetingId, stage }: { title: string; error: string | null; meetingId: string; stage: string }) {
  const [pending, start] = useTransition();
  return (
    <Notice tone="danger" title={title} action={<button disabled={pending} onClick={() => start(() => retryStageAction(meetingId, stage))} className="btn btn-secondary btn-sm"><RefreshCw />{pending ? "Retrying…" : "Retry"}</button>}>
      {error ?? "Something went wrong."} The transcript and playback still work.
    </Notice>
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
  if (!hasAny && (!stage || stage.status !== "done")) return <Working title="Writing the summary…">It will appear here when it's ready.</Working>;

  const content = cache[key];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-2 text-muted">Template
          <select id="tpl" value={key} disabled={busy} onChange={(e) => (e.target.value === CUSTOM ? setForm({ name: "", prompt: "" }) : load(e.target.value))} className="field field-sm text-text">
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}{cache[t.key] ? "" : " ·"}</option>)}
            <option value={CUSTOM}>Custom prompt…</option>
          </select></label>
        {content && <button disabled={busy} onClick={() => load(key, true)} className="btn btn-ghost btn-sm"><RefreshCw />Regenerate</button>}
      </div>
      {form && (
        <div className="card space-y-3 p-4 text-sm">
          <div className="font-medium">New summary template</div>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Template name" className="field w-full" />
          <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} rows={4} placeholder="Tell Milo what to focus on and which sections you want…" className="field w-full" />
          <div className="flex gap-2">
            <button onClick={saveTemplate} className="btn btn-primary btn-sm">Save and generate</button>
            <button onClick={() => setForm(null)} className="btn btn-secondary btn-sm">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error} <button onClick={() => load(key, true)} className="underline">Try again</button></p>}
      {busy && <Working title="Writing this version of the summary…" />}
      {!busy && content && (
        <div className="card divide-y divide-border">
          {content.sections.map((s) => (
            <section key={s.heading} className="p-4 sm:p-5">
              <h3 className="mb-2.5 text-sm font-semibold tracking-tight">{s.heading}</h3>
              <ul className="space-y-2 text-sm leading-relaxed">
                {s.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2.5"><span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" /><span>{b.text}{b.ms !== undefined && <TimeChip ms={b.ms} onSeek={onSeek} />}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActionItemsPanel({ meetingId, items: initial, stage, onSeek }: { meetingId: string; items: ActionItemView[]; stage: StageView | null; onSeek: (ms: number) => void }) {
  const [items, setItems] = useState(initial);
  const [copied, setCopied] = useState(false);

  if (stage?.status === "failed" && !items.length) return <Failed title="Action items failed" error={stage.error} meetingId={meetingId} stage="intelligence" />;
  if (!items.length) return stage?.status === "done" ? <div className="card p-6 text-sm text-muted">No action items were found in this meeting.</div> : <Working title="Looking for action items…" />;

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
  const done = items.filter((i) => i.done).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="shrink-0 text-muted"><span className="font-medium text-text">{done}</span> of {items.length} done</span>
        <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${(done / items.length) * 100}%` }} /></div>
        <button onClick={copy} className="btn btn-secondary btn-sm">{copied ? <><Check />Copied</> : <><Copy />Copy as Markdown</>}</button>
      </div>
      <div className="card divide-y divide-border">
        {ordered.map(([who, xs]) => (
          <section key={who} className="p-5">
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold tracking-tight">{who}<span className="rounded-full bg-raised px-1.5 text-xs font-normal text-muted">{xs.length}</span></h3>
            <ul className="space-y-2.5 text-sm leading-relaxed">
              {xs.map((x) => (
                <li key={x.id} className="flex items-start gap-3">
                  <input type="checkbox" checked={x.done} onChange={(e) => toggle(x.id, e.target.checked)} aria-label={x.text} className="check mt-0.5" />
                  <span className={x.done ? "text-subtle line-through" : ""}>{x.text}{x.sourceMs !== null && <TimeChip ms={x.sourceMs} onSeek={onSeek} />}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
