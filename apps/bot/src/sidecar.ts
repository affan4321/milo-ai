import { CONSENT_MESSAGE, isBotName, type Sidecar } from "@milo/core";

/** Icon-font ligature text ("visual_effects", "keyboard_arrow_down") leaks into page text; it is never a person's name. */
export const isJunkName = (n: string) => /^[a-z]+(_[a-z]+)+$/.test(n.trim());

/** Collects what the platform page reports and converts wall-clock times to the recording's clock. */
export class SidecarCollector {
  private t0 = 0;
  private roster = new Map<string, { joinedMs: number; leftMs: number | null }>();
  private lastSpeaker = "";
  private lastSpokeAt = new Map<string, number>();
  private peak = 0;
  private lastCount: number | undefined;
  readonly data: Pick<Sidecar, "speakerEvents" | "captions" | "chat"> = { speakerEvents: [], captions: [], chat: [] };
  constructor(private platform: string) {}

  /** Call once, when the recorder starts producing frames. Anything before it is clamped to 0. */
  start(recordingStartedAtMs: number) { this.t0 = recordingStartedAtMs; }
  private ms(epoch: number) { return Math.max(0, Math.round(epoch - this.t0)); }

  /** One observation of "name is speaking". Repeats are thinned to one per 1.5 s so a long monologue stays covered without flooding the sidecar. */
  speaker(name: string, epoch: number) {
    if (!name) return;
    const at = this.ms(epoch), last = this.lastSpokeAt.get(name);
    if (name === this.lastSpeaker && last !== undefined && at - last < 1500) return;
    this.lastSpeaker = name; this.lastSpokeAt.set(name, at); this.data.speakerEvents.push({ name, atMs: at });
  }
  /** Participant count from the platform (including the bot). Logged on change: it is what decides when the bot leaves. */
  count(n: number, epoch: number) {
    if (n !== this.lastCount) { console.log(`[sidecar] participants ${this.lastCount ?? "-"} -> ${n} at ${(this.ms(epoch) / 1000).toFixed(1)}s`); this.lastCount = n; }
    this.peak = Math.max(this.peak, n);
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
    // Our own consent message shows up in the chat list too; it is not something a participant said.
    const probe = CONSENT_MESSAGE.slice(0, 40);
    if (from.includes(probe) || text.includes(probe) || isBotName(from)) return;
    const atMs = this.ms(epoch);
    if (!this.data.chat.some((c) => c.from === from && c.text === text && Math.abs(c.atMs - atMs) < 5000)) this.data.chat.push({ from, text, atMs });
  }
  participants(names: string[], epoch: number) {
    const now = new Set(names.filter((n) => n && !isJunkName(n))), at = this.ms(epoch);
    for (const n of now) if (!this.roster.has(n)) this.roster.set(n, { joinedMs: at, leftMs: null }); else if (this.roster.get(n)!.leftMs !== null) this.roster.get(n)!.leftMs = null;
    for (const [n, r] of this.roster) if (!now.has(n) && r.leftMs === null) r.leftMs = at;
  }
  build(endedBy: Sidecar["endedBy"], recordingStartedAtMs: number): Sidecar {
    // Scraping the participant list is the part of a page most likely to break. Anyone seen speaking is certainly a participant,
    // so the roster never comes out empty just because the list selector stopped matching.
    const roster = new Map(this.roster);
    for (const e of this.data.speakerEvents) if (!roster.has(e.name) && !isBotName(e.name) && !/^you$/i.test(e.name)) roster.set(e.name, { joinedMs: e.atMs, leftMs: null });
    return { version: 1, platform: this.platform, recordingStartedAtMs, endedBy, ...this.data, ...(this.peak ? { peakParticipants: this.peak } : {}),
      participants: [...roster].map(([name, r]) => ({ name, ...r })) };
  }
}
