import type { BotState } from "./events";

/** Why a bot session did not produce a recording. Plain-language text for the UI lives in botReasonText. */
export type BotFailReason =
  | "not_admitted" | "denied" | "guests_blocked" | "captcha" | "sign_in_required" | "bad_link"
  | "removed_early" | "join_error" | "recording_error" | "upload_error" | "bot_unavailable" | "bot_busy" | "too_short";

const REASON_TEXT: Record<BotFailReason, string> = {
  not_admitted: "The host never let Milo in.",
  denied: "The host declined Milo's request to join.",
  guests_blocked: "This meeting doesn't allow guests, so Milo couldn't join.",
  captcha: "The meeting service asked Milo to prove it's not a robot. Milo can't do that, so it stopped.",
  sign_in_required: "This meeting only allows signed-in users from its organisation.",
  bad_link: "That meeting link didn't open a meeting.",
  removed_early: "Milo was removed from the meeting before it could record.",
  join_error: "Milo couldn't get into the meeting (the meeting page didn't behave as expected).",
  recording_error: "Milo joined but the recording failed.",
  upload_error: "Milo recorded the meeting but couldn't hand the recording over. It is kept and will be retried.",
  bot_unavailable: "Milo's meeting bot isn't running right now.",
  too_short: "The meeting ended almost as soon as Milo joined, so there was nothing worth recording.",
  bot_busy: "All of Milo's meeting bots were busy with other meetings, so it couldn't join in time.",
};
export const botReasonText = (r: string | null | undefined) => (r && REASON_TEXT[r as BotFailReason]) || (r ? `Milo couldn't join (${r}).` : "");

/** Plain wording for each bot state, shown wherever the bot's status is visible. */
export const BOT_STATE_TEXT: Record<BotState, string> = {
  scheduled: "Milo will join when the meeting starts",
  joining: "Milo is joining the meeting",
  waiting_room: "Waiting for the host to let Milo in",
  recording: "Milo is in the meeting and recording",
  left: "Milo has left the meeting",
  failed: "Milo couldn't record this meeting",
};
export const BOT_ACTIVE_STATES: BotState[] = ["scheduled", "joining", "waiting_room", "recording"];

/** What the bot uploads next to the recording. Every time is ms from the recording's start, the same clock as everything else. */
export interface Sidecar {
  version: 1;
  platform: string;
  /** Wall-clock epoch ms of recording time 0. */
  recordingStartedAtMs: number;
  participants: { name: string; joinedMs: number; leftMs: number | null }[];
  /**
   * "<name> was speaking at <atMs>" observations, from live captions (Meet) or the active-speaker indicator (Zoom).
   * Emitted repeatedly while someone talks (about every 1.5 s), so each observation is read as covering a few seconds around it.
   */
  speakerEvents: { name: string; atMs: number }[];
  /** Largest participant count seen, INCLUDING the bot. 2 means the bot plus exactly one other person. */
  peakParticipants?: number;
  captions: { name: string; text: string; atMs: number }[];
  chat: { from: string; text: string; atMs: number }[];
  endedBy: "ended" | "removed" | "alone" | "timeout" | "error";
}

export interface BotJob {
  botSessionId: string;
  meetingId: string;
  url: string;
  platform: string;
  displayName: string;
  /** Message to post in the meeting chat on joining; null when the owner turned it off. */
  consentMessage: string | null;
}
/** The bot's Google account is named exactly this; it is also the name used when joining as a signed-out guest. */
export const BOT_NAME = "Milo AI Notetaker";
/** Matches the bot under any spelling (account name, guest name, older "Milo Notetaker") so it never counts as a speaker or participant. */
export const isBotName = (name: string) => /^milo(\s+ai)?\s+notetaker$/i.test(name.trim());
export const CONSENT_MESSAGE = `${BOT_NAME} is recording and transcribing this meeting for the meeting owner. If you'd rather not be recorded, please say so or leave.`;
export const BOT_JOIN_QUEUE = "bot.join.requested";

/** The join job must never be retried (a second bot walking in late is worse than none) and a call can last hours. */
export const BOT_QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 8 * 3600 } as const;

/** A bot that hasn't reported in for this long is considered down. */
export const WORKER_ALIVE_MS = 60_000;
/** A queued meeting waits for a free bot this long before failing as "bot_busy" (joining much later isn't useful). */
export const MAX_QUEUE_WAIT_MS = 10 * 60_000;
