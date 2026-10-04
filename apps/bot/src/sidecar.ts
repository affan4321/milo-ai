import { isBotName, type Sidecar } from "@milo/core";

/** Collects what the platform page reports and converts wall-clock times to the recording's clock. */
export class SidecarCollector {
  private t0 = 0;
  private roster = new Map<string, { joinedMs: number; leftMs: number | null }>();
  private lastSpeaker = "";
  readonly data: Pick<Sidecar, "speakerEvents" | "captions" | "chat"> = { speakerEvents: [], captions: [], chat: [] };
  constructor(private platform: string) {}

  /** Call once, when the recorder starts producing frames. Anything before it is clamped to 0. */
  start(recordingStartedAtMs: number) { this.t0 = recordingStartedAtMs; }
  private ms(epoch: number) { return Math.max(0, Math.round(epoch - this.t0)); }

  speaker(name: string, epoch: number) {
    if (!name || name === this.lastSpeaker) return;
    this.lastSpeaker = name; this.data.speakerEvents.push({ name, atMs: this.ms(epoch) });
  }
  caption(name: string, text: string, epoch: number) {
    if (!text.trim()) return;
    this.speaker(name, epoch);
    const last = this.data.captions[this.data.captions.length - 1];
    // Live captions grow in place ("hello" -> "hello there"): replace the previous entry for the same speaker when it extends it.
    if (last && last.name === name && text.startsWith(last.text.slice(0, Math.max(8, last.text.length - 12)))) { last.text = text; return; }
    this.data.captions.push({ name, text, atMs: this.ms(epoch) });
  }
  chat(from: string, text: string, epoch: number) {
    const atMs = this.ms(epoch);
    if (!this.data.chat.some((c) => c.from === from && c.text === text && Math.abs(c.atMs - atMs) < 5000)) this.data.chat.push({ from, text, atMs });
  }
  participants(names: string[], epoch: number) {
    const now = new Set(names), at = this.ms(epoch);
    for (const n of now) if (!this.roster.has(n)) this.roster.set(n, { joinedMs: at, leftMs: null }); else if (this.roster.get(n)!.leftMs !== null) this.roster.get(n)!.leftMs = null;
    for (const [n, r] of this.roster) if (!now.has(n) && r.leftMs === null) r.leftMs = at;
  }
  build(endedBy: Sidecar["endedBy"], recordingStartedAtMs: number): Sidecar {
    // Scraping the participant list is the part of a page most likely to break. Anyone seen speaking is certainly a participant,
    // so the roster never comes out empty just because the list selector stopped matching.
    const roster = new Map(this.roster);
    for (const e of this.data.speakerEvents) if (!roster.has(e.name) && !isBotName(e.name) && !/^you$/i.test(e.name)) roster.set(e.name, { joinedMs: e.atMs, leftMs: null });
    return { version: 1, platform: this.platform, recordingStartedAtMs, endedBy, ...this.data,
      participants: [...roster].map(([name, r]) => ({ name, ...r })) };
  }
}
