import type { Platform } from "@milo/core";

export interface StorageProvider {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  signedUrl(key: string, expiresInSec?: number): Promise<string>;
}

export interface TranscriptWord { w: string; s: number; e: number }
export interface TranscriptSegmentOut { speakerLabel: string; startMs: number; endMs: number; text: string; words: TranscriptWord[] }
export interface SttProvider { transcribe(audio: Uint8Array | { key: string }): Promise<TranscriptSegmentOut[]> }

export interface SummaryOut { sections: { heading: string; bullets: { text: string; ms?: number }[] }[] }
export interface InsightsOut {
  summary: SummaryOut;
  actionItems: { text: string; assignee?: string; sourceMs?: number }[];
  chapters: { title: string; startMs: number }[];
}
export interface LlmProvider {
  insights(args: { transcript: string; templatePrompt: string }): Promise<InsightsOut>;
  embed(texts: string[]): Promise<number[][]>;
  answer(args: { question: string; context: { id: string; text: string; ms: number }[] }): Promise<{ text: string; citedIds: string[] }>;
}

export interface CalendarEventOut {
  externalId: string; title: string; startsAt: Date; endsAt: Date;
  attendees: { name?: string; email: string }[]; meetingUrl: string | null; platform: Platform;
}
export interface CalendarProvider { listUpcoming(): Promise<CalendarEventOut[]> }

export interface EmailProvider { send(args: { to: string; subject: string; html: string }): Promise<void> }
