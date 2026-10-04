import type { BotFailReason } from "@milo/core";

export type JoinResult = { admitted: true } | { admitted: false; reason: BotFailReason };
export type EndReason = "ended" | "removed" | "alone" | "timeout";

/**
 * One implementation per platform (meet now; zoom and teams later). Recording, sidecar and upload are shared and live elsewhere.
 * Times passed to callbacks are wall-clock epoch ms; the session converts them to the recording clock.
 */
export interface PlatformAdapter {
  join(url: string, displayName: string, hooks: { onWaiting(): void }): Promise<JoinResult>;
  /** Returns false when the platform won't take the message (chat disabled by the host). Never throws. */
  postConsent(message: string): Promise<boolean>;
  watchSpeakers(cb: (name: string, text: string, epochMs: number) => void): Promise<void>;
  watchChat(cb: (from: string, text: string, epochMs: number) => void): Promise<void>;
  watchParticipants(cb: (names: string[], epochMs: number) => void): Promise<void>;
  /** `onCount` receives the platform's participant count (including the bot) every poll. */
  detectEnd(o: { aloneGraceMs: number; aloneAtStartMs: number; maxMs: number; onCount?: (n: number, epochMs: number) => void }): Promise<EndReason>;
  leave(): Promise<void>;
  close(): Promise<void>;
}
