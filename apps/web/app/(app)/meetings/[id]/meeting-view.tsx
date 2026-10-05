"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowDownToLine, BookOpen, Film, ListChecks, ScrollText, Scissors, Star, Trash2, Users, type LucideIcon } from "lucide-react";
import { formatMs } from "@milo/core";
import { renameSpeakerAction } from "./actions";
import type { HighlightView } from "./live-panel";
import { createClipAction, deleteHighlightAction } from "./actions";
import { ClipsPanel, type ClipView } from "./clips-panel";
import { AddToPlaylist } from "./add-to-playlist";
import { ActionItemsPanel, SummaryPanel, type ActionItemView, type StageView, type SummaryContent, type TemplateOpt } from "./panels";

export interface SpeakerView { id: string; name: string; talkTimeMs: number }
export interface SegmentView { id: string; speakerId: string; startMs: number; endMs: number; text: string }

const color = (i: number) => `hsl(${(i * 47 + 250) % 360} 65% 60%)`;

const Line = memo(function Line({ seg, index, speaker, hue, active, selected, onPick }: {
  seg: SegmentView; index: number; speaker: string; hue: string; active: boolean; selected: boolean; onPick: (index: number, shift: boolean) => void;
}) {
  return (
    <button data-seg={seg.id} onClick={(e) => onPick(index, e.shiftKey)}
      className={`flex w-full gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm leading-relaxed transition-colors ${selected ? "border-warn bg-warn/15" : active ? "border-accent bg-accent/10" : "border-transparent hover:bg-raised"}`}>
      <span className={`w-12 shrink-0 pt-0.5 font-mono text-xs ${active ? "text-accent-ink" : "text-subtle"}`}>{formatMs(seg.startMs)}</span>
      <span>
        <span className="mr-2 text-xs font-semibold" style={{ color: hue }}>{speaker}</span>
        <span>{seg.text}</span>
      </span>
    </button>
  );
});

export interface ChapterView { id: string; title: string; startMs: number }
type Tab = "summary" | "actions" | "transcript";

/** One titled block in the column beside the player. */
function Panel({ icon: I, title, aside, children }: { icon: LucideIcon; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><I className="h-4 w-4 text-subtle" />{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function MeetingView({ meetingId, mediaUrl, isVideo, speakers, segments, chapters, actionItems, templates, summaries, defaultTemplate, insights, highlights, clips, durationMs, initialSeekMs, playlists }: {
  meetingId: string; mediaUrl: string; isVideo: boolean; speakers: SpeakerView[]; segments: SegmentView[];
  chapters: ChapterView[]; actionItems: ActionItemView[]; templates: TemplateOpt[]; summaries: Record<string, SummaryContent>; defaultTemplate: string; insights: StageView | null;
  highlights: HighlightView[]; clips: ClipView[]; durationMs: number; initialSeekMs?: number; playlists: { id: string; name: string }[];
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
  const tabs = [["summary", "Summary", BookOpen], ["actions", `Action items${actionItems.length ? ` (${actionItems.length})` : ""}`, ListChecks], ["transcript", "Transcript", ScrollText]] as const;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-pop">
          {isVideo
            ? <video ref={media} src={mediaUrl} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="aspect-video w-full bg-black" />
            : <div className="bg-gradient-to-br from-accent/15 to-transparent p-5"><audio ref={media} src={mediaUrl} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} className="w-full" /></div>}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-[1_1_8rem] truncate text-muted">{chapterAt >= 0 ? chapters[chapterAt]!.title : "Playback"}</span>
            <div role="radiogroup" aria-label="Playback speed" className="flex shrink-0 rounded-lg bg-raised p-0.5">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                <button key={r} role="radio" aria-checked={rate === r} onClick={() => setRate(r)}
                  className={`rounded-md px-2 py-1 text-xs tabular-nums transition-colors ${rate === r ? "bg-surface font-medium text-text shadow-card" : "text-muted hover:text-text"}`}>{r}×</button>
              ))}
            </div>
          </div>
        </div>
        {toast && <p className={`rounded-lg border px-3 py-2 text-sm ${toast.bad ? "border-danger/30 bg-danger/[0.07] text-danger" : "border-accent/30 bg-accent/[0.07] text-muted"}`} role="status">{toast.text}</p>}
        {durationMs > 0 && highlights.length > 0 && (
          <Panel icon={Star} title="Highlights" aside={<span className="text-xs text-subtle">{highlights.length}</span>}>
            {/* Position markers on the recording's timeline: click one to jump to it. */}
            <div className="relative mb-3 h-2 rounded-full bg-raised">
              {highlights.map((h) => (
                <button key={h.id} onClick={() => seek(h.startMs)} title={h.note ?? "Highlight"} aria-label={`Highlight at ${formatMs(h.startMs)}`}
                  className="absolute top-0 h-2 min-w-1.5 rounded-full bg-warn transition-transform hover:scale-y-150"
                  style={{ left: `${(h.startMs / durationMs) * 100}%`, width: `${Math.max(0.6, ((h.endMs - h.startMs) / durationMs) * 100)}%` }} />
              ))}
            </div>
            <ul className="-mx-1 max-h-44 space-y-0.5 overflow-y-auto text-sm">
              {highlights.map((h) => (
                <li key={h.id} className="group flex flex-wrap items-center justify-end rounded-lg hover:bg-raised">
                  <button onClick={() => seek(h.startMs)} className="flex min-w-0 flex-[1_1_12rem] items-baseline gap-2.5 px-2 py-1.5 text-left">
                    <span className="shrink-0 font-mono text-xs text-accent-ink">{formatMs(h.startMs)}–{formatMs(h.endMs)}</span>
                    <span className="min-w-0 truncate">{h.note ?? "Highlight"}<span className="ml-2 text-xs text-subtle">{h.createdBy ?? ""}</span></span>
                  </button>
                  <AddToPlaylist meetingId={meetingId} playlists={playlists} range={{ startMs: h.startMs, endMs: h.endMs }} label="Playlist" />
                  <button disabled={clipping} onClick={() => makeClip(h.startMs, h.endMs, h.note ?? undefined)} className="btn btn-ghost btn-sm"><Scissors />Clip</button>
                  <button onClick={() => deleteHighlightAction(meetingId, h.id)} title="Remove highlight" aria-label="Remove highlight" className="btn btn-ghost btn-danger btn-sm btn-icon opacity-0 focus-visible:opacity-100 group-hover:opacity-100"><Trash2 /></button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {clips.length > 0 && <Panel icon={Film} title="Clips"><ClipsPanel clips={clips} /></Panel>}
        {chapters.length > 0 && (
          <Panel icon={BookOpen} title="Chapters">
            <ol className="-mx-1 max-h-48 space-y-0.5 overflow-y-auto text-sm">
              {chapters.map((c, i) => (
                <li key={c.id}>
                  <button onClick={() => seek(c.startMs)} className={`flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${i === chapterAt ? "bg-accent/10 font-medium text-accent-ink" : "hover:bg-raised"}`}>
                    <span className={`w-12 shrink-0 font-mono text-xs ${i === chapterAt ? "" : "text-subtle"}`}>{formatMs(c.startMs)}</span><span>{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
        )}
        {speakers.length > 0 && (
          <Panel icon={Users} title="Talk time" aside={<span className="text-xs text-subtle">Click a name to rename</span>}>
            <div className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
              {speakers.map((s, i) => <div key={s.id} title={`${s.name} · ${Math.round((s.talkTimeMs / total) * 100)}%`} style={{ width: `${(s.talkTimeMs / total) * 100}%`, background: color(i) }} />)}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {speakers.map((s, i) => (
                <button key={s.id} onClick={() => rename(s)} title="Rename speaker" className="flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-1 transition-colors hover:border-accent">
                  <span className="h-2 w-2 rounded-full" style={{ background: color(i) }} />{s.name}
                  <span className="tabular-nums text-subtle">{Math.round((s.talkTimeMs / total) * 100)}%</span>
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border text-sm [scrollbar-width:none]" role="tablist">
          {tabs.map(([k, label, I]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 transition-colors ${tab === k ? "font-medium text-text" : "text-muted hover:text-text"}`}>
              <I className="h-4 w-4" />{label}
              {tab === k && <motion.span layoutId="meeting-tab" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            </button>
          ))}
        </div>
        {tab === "summary" && <SummaryPanel key={Object.keys(summaries).sort().join()} meetingId={meetingId} templates={templates} initial={summaries} initialKey={summaries[defaultTemplate] ? defaultTemplate : Object.keys(summaries)[0] ?? defaultTemplate} stage={insights} onSeek={seek} />}
        {tab === "actions" && <ActionItemsPanel key={actionItems.map((a) => a.id).join()} meetingId={meetingId} items={actionItems} stage={insights} onSeek={seek} />}
        <div hidden={tab !== "transcript"}>
          {selRange ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
              <span>Selected <span className="font-mono">{formatMs(selRange.startMs)}–{formatMs(selRange.endMs)}</span></span>
              <span className="flex gap-2">
                <button disabled={clipping} onClick={() => makeClip(selRange.startMs, selRange.endMs)} className="btn btn-primary btn-sm"><Scissors />{clipping ? "Creating…" : "Create clip"}</button>
                <button onClick={() => setSel(null)} className="btn btn-ghost btn-sm">Clear</button>
              </span>
            </div>
          ) : <p className="mb-3 text-xs text-muted">Click a line to jump to it. Shift-click another line to select a stretch and make a clip.</p>}
          <div className="relative">
            {!follow && (
              <button onClick={() => { setFollow(true); onTime(); }} className="btn btn-primary btn-sm absolute right-4 top-3 z-10 rounded-full shadow-pop"><ArrowDownToLine />Jump to current</button>
            )}
            <div ref={list} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}
              className="card relative h-[70vh] overflow-y-auto p-1.5 sm:p-2">
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
