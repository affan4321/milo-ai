import { isBotName, type Sidecar } from "@milo/core";

export interface NamedSeg { speakerLabel: string; startMs: number; endMs: number }

/** Captions appear a moment after speech starts, so a caption timestamp is slightly later than the true start of the turn. */
const CAPTION_LEAD_MS = 1500;
/** The bot itself and generic placeholders are never real speakers. */
const IGNORED = /^(you|unknown|presentation)$/i;

/**
 * Re-label diarized segments with real names from the bot's live-caption speaker events.
 * Done per SEGMENT (by time overlap), not per diarization label, so it also repairs a diarizer that split one person into two
 * labels (they collapse to one name) or merged two people into one (they separate). Segments with no confident caption
 * evidence keep their diarized label.
 */
export function nameSegments<T extends NamedSeg>(segs: T[], events: Sidecar["speakerEvents"]): T[] {
  const ev = events.filter((e) => e.name && !IGNORED.test(e.name.trim()) && !isBotName(e.name)).sort((a, b) => a.atMs - b.atMs);
  if (!ev.length) return segs;
  // Turn "X starts speaking at t" events into intervals that last until the next event (or a speaker-turn cap).
  const iv = ev.map((e, i) => ({ name: e.name.trim(), s: Math.max(0, e.atMs - CAPTION_LEAD_MS), e: (ev[i + 1]?.atMs ?? e.atMs + 30_000) - (i + 1 < ev.length ? CAPTION_LEAD_MS : 0) }));
  return segs.map((seg) => {
    const dur = Math.max(1, seg.endMs - seg.startMs);
    const by = new Map<string, number>();
    for (const x of iv) {
      const o = Math.min(seg.endMs, x.e) - Math.max(seg.startMs, x.s);
      if (o > 0) by.set(x.name, (by.get(x.name) ?? 0) + o);
    }
    const best = [...by].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] / dur >= 0.4 ? { ...seg, speakerLabel: best[0] } : seg;
  });
}
