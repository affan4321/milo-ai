const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

export const config = {
  webUrl: (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  botToken: process.env.BOT_TOKEN ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo",
  profileDir: process.env.BOT_PROFILE_DIR ?? "/profile",
  dataDir: process.env.BOT_DATA_DIR ?? "/data",
  display: process.env.DISPLAY ?? ":99",
  videoSize: process.env.BOT_VIDEO_SIZE ?? "1280x720",
  pulseSource: process.env.BOT_PULSE_SOURCE ?? "meet_sink.monitor",
  /** Real Chrome on a virtual display (not headless) is refused far less than headless Chromium. */
  chromeChannel: process.env.BOT_CHROME_CHANNEL ?? "chrome",
  debug: process.env.BOT_DEBUG === "1",
  joinTimeoutMs: num("BOT_JOIN_TIMEOUT_MS", 10 * 60_000),
  // After everyone else leaves: wait this long (in case someone just dropped and rejoins) before leaving too.
  aloneGraceMs: num("BOT_ALONE_GRACE_MS", 15_000),
  aloneAtStartMs: num("BOT_ALONE_AT_START_MS", 5 * 60_000),
  maxMeetingMs: num("BOT_MAX_MEETING_MS", 5 * 3_600_000),
  heartbeatMs: num("BOT_HEARTBEAT_MS", 30_000),
};
