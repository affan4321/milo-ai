import type { Readable } from "node:stream";
import type { Platform } from "@milo/core";

export interface StorageProvider {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  /** Stream large bodies (recordings) without buffering them in memory. */
  putStream(key: string, body: Readable): Promise<number>;
  /** Copy a local file into storage (worker outputs). */
  putFile(key: string, localPath: string): Promise<void>;
  /** A local path ffmpeg can read. Local storage returns the real path; remote storage would download to a temp file. */
  toLocalFile(key: string): Promise<string>;
  size(key: string): Promise<number | null>;
  /** Inclusive byte range, for HTTP Range playback. */
  read(key: string, range?: { start: number; end: number }): Readable;
}

export interface TranscriptWord { w: string; s: number; e: number }
export interface TranscriptSegmentOut { speakerLabel: string; startMs: number; endMs: number; text: string; words: TranscriptWord[] }
export interface SttInput { key: string; durationMs: number }
export interface SttProvider { transcribe(input: SttInput, storage: StorageProvider): Promise<TranscriptSegmentOut[]> }

export interface SummaryOut { sections: { heading: string; bullets: { text: string; ms?: number }[] }[] }
export interface InsightsOut {
  summary: SummaryOut;
  actionItems: { text: string; assignee?: string; sourceMs?: number }[];
  chapters: { title: string; startMs: number }[];
}
export interface LlmInput { transcript: string; templatePrompt: string; durationMs: number }
export interface LlmProvider {
  /** Summary + action items + chapters in one call. `transcript` lines look like "[t=754] Name: text" (t = seconds). */
  insights(args: LlmInput): Promise<InsightsOut>;
  /** Summary only, for switching templates after the first pass. */
  summarize(args: LlmInput): Promise<SummaryOut>;
  embed(texts: string[]): Promise<number[][]>;
  answer(args: { question: string; context: { id: string; text: string; ms: number }[] }): Promise<{ text: string; citedIds: string[] }>;
}

export interface CalendarEventOut {
  externalId: string; title: string; startsAt: Date; endsAt: Date;
  attendees: { name?: string; email: string }[]; organizerEmail?: string | null; meetingUrl: string | null; platform: Platform;
}
export interface CalendarProvider { listUpcoming(): Promise<CalendarEventOut[]> }

export interface EmailProvider { send(args: { to: string; subject: string; html: string }): Promise<void> }
