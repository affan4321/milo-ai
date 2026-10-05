"use client";
import { useCallback, useRef, useState } from "react";
import { formatMs } from "@milo/core";

export interface ShareLine { startMs: number; speaker: string; text: string }

export function SharePlayer({ src, isVideo, lines }: { src: string; isVideo: boolean; lines: ShareLine[] }) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [active, setActive] = useState(-1);
  const onTime = useCallback(() => {
    const t = (media.current?.currentTime ?? 0) * 1000;
    let a = -1; lines.forEach((l, i) => { if (l.startMs <= t) a = i; }); setActive(a);
  }, [lines]);
  const seek = (ms: number) => { const el = media.current; if (!el) return; el.currentTime = ms / 1000; void el.play().catch(() => {}); };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      {isVideo
        ? <video ref={media} src={src} controls preload="metadata" playsInline onTimeUpdate={onTime} className="w-full rounded-lg bg-black" />
        : <audio ref={media} src={src} controls onTimeUpdate={onTime} className="w-full" />}
      <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-2">
        {lines.length === 0 && <p className="p-3 text-sm text-muted">No transcript for this stretch.</p>}
        {lines.map((l, i) => (
          <button key={i} onClick={() => seek(l.startMs)} className={`flex w-full gap-3 rounded-md px-3 py-2 text-left text-sm ${i === active ? "bg-accent/15" : "hover:bg-bg"}`}>
            <span className="w-10 shrink-0 pt-0.5 font-mono text-xs text-muted">{formatMs(l.startMs)}</span>
            <span><span className="mr-2 text-xs font-semibold text-accent">{l.speaker}</span>{l.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
