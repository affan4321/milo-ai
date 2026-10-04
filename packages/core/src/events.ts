/** Pipeline events, in order. Modules communicate only through these and the DB. */
export const Events = {
  BotJoinRequested: "bot.join.requested",
  RecordingUploaded: "recording.uploaded",
  MediaReady: "media.ready",
  TranscriptReady: "transcript.ready",
  InsightsReady: "insights.ready",
  IndexReady: "index.ready",
  RecapSent: "recap.sent",
} as const;
export type EventName = (typeof Events)[keyof typeof Events];

export const PipelineStages = ["media", "transcription", "intelligence", "indexing", "notify"] as const;
export type PipelineStage = (typeof PipelineStages)[number];
export type StageStatus = "pending" | "running" | "done" | "failed";

export type Platform = "meet" | "zoom" | "teams" | "unknown";
export type CaptureSource = "bot" | "browser" | "upload";
export type BotState = "scheduled" | "joining" | "waiting_room" | "recording" | "left" | "failed";

export interface RecordingUploadedPayload { meetingId: string; recordingId: string }
export interface MeetingPayload { meetingId: string }

/** A failure that retrying cannot fix (bad input). The stage is marked failed; the queue must not retry it. */
export class PermanentError extends Error {
  readonly permanent = true;
}
export const isPermanent = (e: unknown): e is PermanentError => !!e && typeof e === "object" && (e as PermanentError).permanent === true;

/** The provider's daily quota for a model is used up. Retrying now cannot help, so it is permanent for this run; `retryAfterSec` says when it resets. */
export class DailyQuotaError extends PermanentError {
  constructor(message: string, readonly model: string, readonly retryAfterSec?: number) { super(message); }
}
