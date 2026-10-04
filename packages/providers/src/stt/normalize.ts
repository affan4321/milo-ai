import type { TranscriptSegmentOut } from "../types";

/** "MM:SS", "H:MM:SS", "MM:SS.mmm" or plain seconds -> ms. Returns undefined when unusable. */
export function parseClock(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 1000) : undefined;
  if (typeof v !== "string") return undefined;
  const parts = v.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return undefined;
  const nums = parts.map(Number);
  const secs = nums.reduce((acc, n) => acc * 60 + n, 0);
  return Math.round(secs * 1000);
}

const WORD_MS = 420; // rough speaking pace, used only to bound a segment's end when there is a long silence after it

/**
 * Raw model utterances for one audio chunk -> segments on the recording's clock.
 * Start times come from the model; ends are derived (next start, bounded by a speaking-pace estimate);
 * word times are interpolated by character length, so they are approximate and marked as such by being evenly spread.
 */
export function normalizeChunk(raw: any, chunkStartMs: number, chunkLenMs: number): TranscriptSegmentOut[] {
  const items = (Array.isArray(raw?.segments) ? raw.segments : []).flatMap((s: any) => {
    const text = typeof s?.text === "string" ? s.text.trim().replace(/\s+/g, " ") : "";
    const start = parseClock(s?.start);
    const speaker = typeof s?.speaker === "string" && s.speaker.trim() ? s.speaker.trim().slice(0, 40) : "Speaker 1";
    return text && start !== undefined ? [{ text, speaker, start: Math.min(start, chunkLenMs) }] : [];
  }).sort((a: any, b: any) => a.start - b.start);

  return items.map((it: any, i: number) => {
    const next = i + 1 < items.length ? items[i + 1].start : chunkLenMs;
    const words = it.text.split(" ");
    const startMs = chunkStartMs + it.start;
    const endMs = chunkStartMs + Math.max(it.start + 500, Math.min(next, it.start + Math.max(1500, words.length * WORD_MS)));
    const total = words.reduce((n: number, w: string) => n + w.length + 1, 0);
    let acc = 0;
    return {
      speakerLabel: it.speaker, startMs, endMs, text: it.text,
      words: words.map((w: string) => {
        const s = startMs + Math.round(((endMs - startMs) * acc) / total);
        acc += w.length + 1;
        return { w, s, e: startMs + Math.round(((endMs - startMs) * acc) / total) };
      }),
    };
  });
}
