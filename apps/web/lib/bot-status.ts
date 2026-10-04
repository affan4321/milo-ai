import { BOT_STATE_TEXT, type BotState } from "@milo/core";

/**
 * Plain wording for a bot session. A session still "scheduled" after a few seconds means no bot has picked it up, and the honest
 * reason depends on whether any bots are running at all.
 */
export function botStatusText(s: { state: string; createdAt: Date }, cap: { alive: number; busy: number }, now = new Date()): string {
  if (s.state === "scheduled" && +now - +s.createdAt > 20_000) {
    if (cap.alive === 0) return "Milo's meeting bot isn't running right now";
    return `Waiting for a free bot (all ${cap.alive} ${cap.alive === 1 ? "is" : "are"} in other meetings)`;
  }
  return BOT_STATE_TEXT[s.state as BotState] ?? s.state;
}
