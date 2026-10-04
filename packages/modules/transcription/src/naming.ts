import { isBotName, type Sidecar } from "@milo/core";

export interface NamedSeg { speakerLabel: string; startMs: number; endMs: number }

/** Captions appear a moment after speech starts, so a caption timestamp is slightly later than the true start of the turn. */
const CAPTION_LEAD_MS = 1500;
/** Each "X was speaking" observation covers this long after it. Observations arrive every ~1.5 s while someone talks, so continuous speech stays covered. */
const OBSERVATION_TAIL_MS = 5000;
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
  // Each "X was speaking at t" observation covers a window around t, ending early if someone else is observed speaking next.
  const iv = ev.map((e, i) => ({
    name: e.name.trim(), s: Math.max(0, e.atMs - CAPTION_LEAD_MS),
    e: Math.min(e.atMs + OBSERVATION_TAIL_MS, i + 1 < ev.length && ev[i + 1]!.name !== e.name ? ev[i + 1]!.atMs - CAPTION_LEAD_MS : Infinity),
  }));
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

/**
 * Full naming policy for a recording that has a sidecar:
 * 1. Name segments from caption observations (above).
 * 2. A call with exactly one other person (peak count 2 = the bot + one person) can only have that person speaking, because the
 *    bot never speaks. So every segment belongs to them, whatever the transcriber's speaker labels say. This fixes the transcriber
 *    splitting one voice into several "Speaker N" labels.
 */
export function nameFromSidecar<T extends NamedSeg>(segs: T[], sidecar: Pick<Sidecar, "speakerEvents" | "peakParticipants">): T[] {
  const named = nameSegments(segs, sidecar.speakerEvents);
  const speakers = new Set(sidecar.speakerEvents.map((e) => e.name.trim()).filter((n) => n && !isBotName(n) && !IGNORED.test(n)));
  if (sidecar.peakParticipants === 2 && speakers.size === 1) { const only = [...speakers][0]!; return named.map((s) => ({ ...s, speakerLabel: only })); }
  return named;
}
