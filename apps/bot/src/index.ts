import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_NAME, BOT_QUEUE_OPTIONS, type BotJob } from "@milo/core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api } from "./api";
import { config } from "./config";
import { retryPending, runSession } from "./session";
import { loginMode } from "./login";

const mode = process.argv[2] ?? "run";

/** A signed-in Chrome profile has a cookie store. Without one the bot can only join as an anonymous guest. */
function hasSignedInProfile() {
  return ["Default/Cookies", "Default/Network/Cookies"].some((f) => fs.existsSync(path.join(config.profileDir, f)));
}

if (mode === "login") {
  await loginMode();
} else if (mode === "once") {
  // Run one session without the queue: `bot once <session-id> <meeting-id> <url>` (session must already exist and be 'scheduled').
  const [botSessionId, meetingId, url] = process.argv.slice(3);
  if (!botSessionId || !meetingId || !url) { console.error("usage: bot once <session-id> <meeting-id> <url>"); process.exit(2); }
  const outcome = await runSession({ botSessionId, meetingId, url, platform: "meet", displayName: BOT_NAME, consentMessage: process.env.BOT_CONSENT ?? null });
  console.log("outcome:", outcome);
  process.exit(outcome === "failed" ? 1 : 0);
} else {
  if (!config.botToken) { console.error("BOT_TOKEN is not set; the bot cannot talk to the web app."); process.exit(1); }
  const boss = new PgBoss(config.databaseUrl);
  boss.on("error", (e) => console.error("[boss]", e));
  await boss.start();
  await boss.createQueue(BOT_JOIN_QUEUE, { name: BOT_JOIN_QUEUE, ...BOT_QUEUE_OPTIONS } as never);
  console.log(`bot up; waiting for meetings (web: ${config.webUrl})`);
  await retryPending();
  setInterval(() => void retryPending(), 5 * 60_000);
  // One meeting at a time per container: there is one virtual display and one audio sink. Scale by running more containers
  // (docker compose up -d --scale bot=N); the queue hands each job to whichever bot is free.
  const workerId = os.hostname();
  let current: string | undefined;
  const beat = () => void api.workerBeat(workerId, !!current, current);
  beat(); setInterval(beat, 15_000);
  console.log(`worker id ${workerId}${hasSignedInProfile() ? "" : " (WARNING: no signed-in Google profile found; joining as a guest. See docs/bot.md)"}`);
  await boss.work<BotJob>(BOT_JOIN_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const job of jobs) {
      current = job.data.botSessionId; beat();
      try { console.log(`[bot] session ${current.slice(0, 8)} ${await runSession(job.data)}`); }
      finally { current = undefined; beat(); }
    }
  });
}
