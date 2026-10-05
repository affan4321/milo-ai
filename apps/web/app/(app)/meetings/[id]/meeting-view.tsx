"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatMs } from "@milo/core";
import { renameSpeakerAction } from "./actions";
import type { HighlightView } from "./live-panel";
import { createClipAction, deleteHighlightAction } from "./actions";
import { ClipsPanel, type ClipView } from "./clips-panel";
import { ActionItemsPanel, SummaryPanel, type ActionItemView, type StageView, type SummaryContent, type TemplateOpt } from "./panels";

export interface SpeakerView { id: string; name: string; talkTimeMs: number }
export interface SegmentView { id: string; speakerId: string; startMs: number; endMs: number; text: string }

const color = (i: number) => `hsl(${(i * 47 + 250) % 360} 65% 60%)`;

const Line = memo(function Line({ seg, index, speaker, hue, active, selected, onPick }: {
  seg: SegmentView; index: number; speaker: string; hue: string; active: boolean; selected: boolean; onPick: (index: number, shift: boolean) => void;
}) {
  return (
    <button data-seg={seg.id} onClick={(e) => onPick(index, e.shiftKey)}
      className={`flex w-full gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${selected ? "bg-amber-400/20 ring-1 ring-amber-400/50" : active ? "bg-accent/15" : "hover:bg-bg"}`}>
      <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted">{formatMs(seg.startMs)}</span>
      <span>
        <span className="mr-2 text-xs font-semibold" style={{ color: hue }}>{speaker}</span>
        <span>{seg.text}</span>
      </span>
    </button>
  );
});

export interface ChapterView { id: string; title: string; startMs: number }
type Tab = "summary" | "actions" | "transcript";

export function MeetingView({ meetingId, mediaUrl, isVideo, speakers, segments, chapters, actionItems, templates, summaries, defaultTemplate, insights, highlights, clips, durationMs, initialSeekMs }: {
  meetingId: string; mediaUrl: string; isVideo: boolean; speakers: SpeakerView[]; segments: SegmentView[];
  chapters: ChapterView[]; actionItems: ActionItemView[]; templates: TemplateOpt[]; summaries: Record<string, SummaryContent>; defaultTemplate: string; insights: StageView | null;
  highlights: HighlightView[]; clips: ClipView[]; durationMs: number; initialSeekMs?: number;
}) {
  const [tab, setTab] = useState<Tab>(initialSeekMs !== undefined ? "transcript" : "summary"); // arriving from a search result or citation: show the words
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [rate, setRate] = useState(1);
  // Shift-click a second transcript line to select the stretch between two lines, then make a clip of it.
  const anchor = useRef(-1);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [clipping, startClip] = useTransition();
  const bySpeaker = useMemo(() => new Map(speakers.map((s, i) => [s.id, { ...s, hue: color(i) }])), [speakers]);
  const starts = useMemo(() => segments.map((s) => s.startMs), [segments]);

  // Binary search: the last segment that has started at time t.
  const indexAt = useCallback((t: number) => {
    let lo = 0, hi = starts.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid]! <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }, [starts]);

  const [nowMs, setNowMs] = useState(0);
  const onTime = useCallback(() => { const el = media.current; if (el) { setActive(indexAt(el.currentTime * 1000)); setNowMs(el.currentTime * 1000); } }, [indexAt]);
  const chapterAt = chapters.reduce((a, c, i) => (c.startMs <= nowMs ? i : a), -1);
  const seek = useCallback((ms: number) => {
    const el = media.current; if (!el) return;
    el.currentTime = ms / 1000; setFollow(true); void el.play().catch(() => {});
  }, []);

  // Keep the active line visible inside the transcript pane only (never scrolls the page).
  useEffect(() => {
    if (tab !== "transcript" || !follow || active < 0 || !list.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-seg="${segments[active]!.id}"]`);
    if (!row) return;
    const box = list.current, top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 40 || top + row.offsetHeight > box.scrollTop + box.clientHeight - 40) {
      box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
    }
  }, [active, follow, segments, tab]);

  useEffect(() => { if (media.current) media.current.playbackRate = rate; }, [rate]);

  // Jump to the moment named in the link (?t=ms) once the player knows its length. Seek only; the browser won't autoplay anyway.
  useEffect(() => {
    const el = media.current; if (!el || initialSeekMs === undefined) return;
    const go = () => { el.currentTime = initialSeekMs / 1000; setNowMs(initialSeekMs); setActive(indexAt(initialSeekMs)); };
    if (el.readyState >= 1) go(); else el.addEventListener("loadedmetadata", go, { once: true });
    return () => el.removeEventListener("loadedmetadata", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeekMs]);

  const pick = useCallback((i: number, shift: boolean) => {
    if (shift && anchor.current >= 0) { setSel({ a: Math.min(anchor.current, i), b: Math.max(anchor.current, i) }); return; }
    anchor.current = i; setSel(null); seek(segments[i]!.startMs);
  }, [segments, seek]);
  function makeClip(startMs: number, endMs: number, title?: string) {
    setToast(null);
    startClip(async () => {
      const r = await createClipAction(meetingId, startMs, endMs, title);
      setToast(r.ok ? { text: "Preparing your clip. It will appear under Clips in a moment." } : { text: r.error, bad: true });
      if (r.ok) setSel(null);
    });
  }
  const selRange = sel ? { startMs: segments[sel.a]!.startMs, endMs: segments[sel.b]!.endMs } : null;

  async function rename(s: SpeakerView) {
    const name = window.prompt(`Rename "${s.name}" everywhere in this meeting`, s.name);
    if (name !== null && name.trim() !== s.name) await renameSpeakerAction(meetingId, s.id, name);
  }

  const total = speakers.reduce((a, s) => a + s.talkTimeMs, 0) || 1;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        {isVideo
          ? <video ref={media} src={mediaUrl} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="w-full rounded-lg bg-black" />
          : <audio ref={media} src={mediaUrl} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="w-full" />}
        {durationMs > 0 && highlights.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Highlights</h3>
            {/* Position markers on the recording's timeline: click one to jump to it. */}
            <div className="relative mb-2 h-3 rounded bg-border/60">
              {highlights.map((h) => (
                <button key={h.id} onClick={() => seek(h.startMs)} title={h.note ?? "Highlight"} aria-label={`Highlight at ${formatMs(h.startMs)}`}
                  className="absolute top-0 h-3 min-w-1 rounded-sm bg-amber-400 hover:bg-amber-300"
                  style={{ left: `${(h.startMs / durationMs) * 100}%`, width: `${Math.max(0.6, ((h.endMs - h.startMs) / durationMs) * 100)}%` }} />
              ))}
            </div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
              {highlights.map((h) => (
                <li key={h.id} className="group flex items-center">
                  <button onClick={() => seek(h.startMs)} className="flex flex-1 gap-2 rounded px-2 py-1 text-left hover:bg-bg">
                    <span className="w-24 shrink-0 font-mono text-xs text-muted">{formatMs(h.startMs)}–{formatMs(h.endMs)}</span>
                    <span>{h.note ?? "Highlight"}<span className="ml-2 text-xs text-muted">{h.createdBy ?? ""}</span></span>
                  </button>
                  <button disabled={clipping} onClick={() => makeClip(h.startMs, h.endMs, h.note ?? undefined)} className="px-2 text-xs text-accent hover:underline disabled:opacity-60">Clip</button>
                  <button onClick={() => deleteHighlightAction(meetingId, h.id)} className="invisible px-2 text-xs text-muted hover:text-text group-hover:visible">Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ClipsPanel clips={clips} />
        {toast && <p className={`text-xs ${toast.bad ? "text-red-500" : "text-muted"}`}>{toast.text}</p>}
        {chapters.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Chapters</h3>
            <ol className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
              {chapters.map((c, i) => (
                <li key={c.id}>
                  <button onClick={() => seek(c.startMs)} className={`flex w-full gap-2 rounded px-2 py-1 text-left hover:bg-bg ${i === chapterAt ? "bg-accent/15" : ""}`}>
                    <span className="w-12 shrink-0 font-mono text-xs text-muted">{formatMs(c.startMs)}</span><span>{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex items-center gap-3 text-sm">
          <label className="text-muted">Speed</label>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded border border-border bg-surface px-2 py-1">
            {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </div>
        <div>
          <div className="mb-2 flex h-2 overflow-hidden rounded">
            {speakers.map((s, i) => <div key={s.id} title={`${s.name} · ${Math.round((s.talkTimeMs / total) * 100)}%`} style={{ width: `${(s.talkTimeMs / total) * 100}%`, background: color(i) }} />)}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {speakers.map((s, i) => (
              <button key={s.id} onClick={() => rename(s)} title="Rename speaker" className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 hover:border-accent">
                <span className="h-2 w-2 rounded-full" style={{ background: color(i) }} />{s.name}
                <span className="text-muted">{Math.round((s.talkTimeMs / total) * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-3 flex gap-1 border-b border-border text-sm">
          {([["summary", "Summary"], ["actions", `Action items${actionItems.length ? ` (${actionItems.length})` : ""}`], ["transcript", "Transcript"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>{label}</button>
          ))}
        </div>
        {tab === "summary" && <SummaryPanel key={Object.keys(summaries).sort().join()} meetingId={meetingId} templates={templates} initial={summaries} initialKey={summaries[defaultTemplate] ? defaultTemplate : Object.keys(summaries)[0] ?? defaultTemplate} stage={insights} onSeek={seek} />}
        {tab === "actions" && <ActionItemsPanel key={actionItems.map((a) => a.id).join()} meetingId={meetingId} items={actionItems} stage={insights} onSeek={seek} />}
        <div hidden={tab !== "transcript"}>
          <p className="mb-1 text-xs text-muted">Click a line to jump to it. Shift-click another line to select a stretch and make a clip.</p>
          {selRange && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-sm">
              <span>Selected {formatMs(selRange.startMs)}–{formatMs(selRange.endMs)}</span>
              <span className="flex gap-2">
                <button disabled={clipping} onClick={() => makeClip(selRange.startMs, selRange.endMs)} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-60">{clipping ? "Creating…" : "Create clip"}</button>
                <button onClick={() => setSel(null)} className="text-xs text-muted underline">Clear</button>
              </span>
            </div>
          )}
      <div className="relative">
        {!follow && (
          <button onClick={() => { setFollow(true); onTime(); }} className="absolute right-3 top-2 z-10 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white shadow">Jump to current</button>
        )}
        <div ref={list} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
          className="relative h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface p-2">
          {segments.map((seg, i) => {
            const sp = bySpeaker.get(seg.speakerId);
            return <Line key={seg.id} seg={seg} index={i} speaker={sp?.name ?? "Unknown"} hue={sp?.hue ?? "gray"} active={i === active} selected={!!sel && i >= sel.a && i <= sel.b} onPick={pick} />;
          })}
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
