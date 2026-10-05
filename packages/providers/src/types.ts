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
  /** Remove one object. Deleting a key that does not exist is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Remote storage only: a time-limited URL a client can PUT/GET directly, so large files never pass through the web app (required on
   * serverless hosting). A PUT must send Content-Type: contentTypeFor(key). Absent on local disk storage.
   */
  presignPut?(key: string, expiresSec?: number): Promise<string>;
  presignGet?(key: string, expiresSec?: number): Promise<string>;
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
export type EmbedTask = "document" | "query";
export interface AnswerContext { id: string; text: string; ms: number; meeting: string; speaker?: string }
export interface AnswerInput { question: string; history?: { role: "user" | "assistant"; content: string }[]; context: AnswerContext[] }
export interface LlmInput { transcript: string; templatePrompt: string; durationMs: number }
export interface LlmProvider {
  /** Which embedding model this provider uses. Vectors from different models are NOT comparable, so every stored vector remembers its model. */
  readonly embedModel?: string;
  /** False when embedding has no usage allowance to protect (e.g. a model running locally). Default true. */
  readonly embedMetered?: boolean;
  /** Summary + action items + chapters in one call. `transcript` lines look like "[t=754] Name: text" (t = seconds). */
  insights(args: LlmInput): Promise<InsightsOut>;
  /** Summary only, for switching templates after the first pass. */
  summarize(args: LlmInput): Promise<SummaryOut>;
  /** Unit-length vectors, one per text. `query` vs `document` lets the model treat questions and passages differently. */
  embed(texts: string[], task?: EmbedTask): Promise<number[][]>;
  /** Answer from the numbered excerpts only. `citedIds` are the excerpt ids actually used (a subset of the ids given). */
  answer(args: AnswerInput): Promise<{ text: string; citedIds: string[] }>;
}

export interface CalendarEventOut {
  externalId: string; title: string; startsAt: Date; endsAt: Date;
  attendees: { name?: string; email: string }[]; organizerEmail?: string | null; meetingUrl: string | null; platform: Platform;
}
export interface CalendarProvider { listUpcoming(): Promise<CalendarEventOut[]> }

export interface EmailMessage { to: string; subject: string; html: string; text?: string }
/** Throws on failure (so the queue retries); a provider that silently drops mail would lose recaps. */
export interface EmailProvider { send(args: EmailMessage): Promise<void> }
