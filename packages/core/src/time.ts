/** All time-based data is milliseconds from recording start. */
export const HIGHLIGHT_LOOKBACK_MS = 30_000;

export function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function highlightRange(nowMs: number): { startMs: number; endMs: number } {
  return { startMs: Math.max(0, nowMs - HIGHLIGHT_LOOKBACK_MS), endMs: nowMs };
}

const PLATFORM_PATTERNS: [RegExp, "meet" | "zoom" | "teams"][] = [
  [/meet\.google\.com\/[a-z-]+/i, "meet"],
  [/zoom\.us\/(j|my)\/\S+/i, "zoom"],
  [/teams\.(microsoft|live)\.com\/\S+/i, "teams"],
];
export function detectMeeting(text: string): { platform: "meet" | "zoom" | "teams"; url: string } | null {
  for (const [re, platform] of PLATFORM_PATTERNS) {
    const m = text.match(new RegExp(`https?://[^\\s"<>]*${re.source}[^\\s"<>]*`, "i"));
    if (m) return { platform, url: m[0] };
  }
  return null;
}

/**
 * `/milo highlight` typed in a meeting's chat by anyone. Anything after the command is kept as a note
 * ("/milo highlight pricing objection"). Returns null when the message isn't the command.
 */
export function parseHighlightCommand(text: string): { note: string | null } | null {
  const m = /(?:^|\s)\/milo\s+highlight\b[:\s-]*(.*)$/is.exec(text.trim());
  if (!m) return null;
  const note = m[1]!.trim().replace(/\s+/g, " ").slice(0, 200);
  return { note: note || null };
}
