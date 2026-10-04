import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS, Events, isPermanent } from "@milo/core";
import { getDb, calendarConnections } from "@milo/db";
import { getProviders } from "@milo/providers";
import { planBotJoins, reapStaleBotSessions, syncConnection } from "@milo/calendar";
import { processMedia } from "@milo/media";
import { transcribeRecording } from "@milo/transcription";
import { generateInsights } from "@milo/intelligence";

const boss = new PgBoss(process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo");
boss.on("error", (e) => console.error("[boss]", e));
await boss.start();

const db = getDb();
const providers = getProviders();
type RecordingJob = { recordingId: string };

// Every pipeline queue retries with backoff; handlers are idempotent so a retry is always safe.
async function queue(name: string) {
  await boss.createQueue(name, { name, retryLimit: 3, retryBackoff: true, retryDelay: 10 });
}

// Pipeline: recording.uploaded -> media -> media.ready -> transcription -> transcript.ready (-> intelligence, indexing: later steps).
// Each stage only talks to the next through an event, never by calling another module.
await queue(Events.RecordingUploaded);
await boss.work<RecordingJob>(Events.RecordingUploaded, async (jobs) => {
  for (const j of jobs) {
    try {
      const r = await processMedia(db, providers.storage, j.data.recordingId);
      console.log(`[media] ${j.data.recordingId} ${r.durationMs}ms`);
      await boss.send(Events.MediaReady, j.data);
    } catch (e) {
      if (isPermanent(e)) { console.warn(`[media] ${j.data.recordingId} failed permanently: ${e.message}`); continue; } // stage row already says failed
      throw e;
    }
  }
});

// Transcription of a long recording takes minutes; pg-boss would otherwise expire (and re-run) the job after 15 minutes.
await boss.createQueue(Events.MediaReady, { name: Events.MediaReady, retryLimit: 3, retryBackoff: true, retryDelay: 30, expireInSeconds: 3600 });
await boss.work<RecordingJob>(Events.MediaReady, async (jobs) => {
  for (const j of jobs) {
    try {
      const r = await transcribeRecording(db, providers.storage, providers.stt, j.data.recordingId);
      console.log(`[transcription] ${j.data.recordingId} ${r.segments} segments`);
      await boss.send(Events.TranscriptReady, j.data);
    } catch (e) {
      if (isPermanent(e)) { console.warn(`[transcription] ${j.data.recordingId} failed permanently: ${e.message}`); continue; }
      throw e;
    }
  }
});

// intelligence: LLM calls are serialized (one job at a time, polled every 5s) and retried with a long backoff,
// which keeps free-tier per-minute limits from failing recordings.
await boss.createQueue(Events.TranscriptReady, { name: Events.TranscriptReady, retryLimit: 5, retryBackoff: true, retryDelay: 60 });
await boss.work<RecordingJob>(Events.TranscriptReady, { batchSize: 1, pollingIntervalSeconds: 5 }, async (jobs) => {
  for (const j of jobs) {
    try {
      const r = await generateInsights(db, providers.llm, j.data.recordingId);
      console.log(`[intelligence] ${j.data.recordingId} ${r.actionItems} action items, ${r.chapters} chapters`);
      await boss.send(Events.InsightsReady, j.data);
    } catch (e) {
      if (isPermanent(e)) { console.warn(`[intelligence] ${j.data.recordingId} failed permanently: ${e.message}`); continue; }
      throw e;
    }
  }
});
await queue(Events.InsightsReady);
await boss.work(Events.InsightsReady, async (jobs) => { for (const j of jobs) console.log(`[worker] ${Events.InsightsReady} (no consumer yet)`, j.id); });

// calendar: a tick fans out one job per connection.
await queue("calendar.sync");
await boss.createQueue("calendar.tick");
await boss.schedule("calendar.tick", "*/10 * * * *");
await boss.work("calendar.tick", async () => {
  for (const c of await db.select({ id: calendarConnections.id }).from(calendarConnections)) {
    await boss.send("calendar.sync", { connectionId: c.id }, { singletonKey: c.id, singletonSeconds: 60 });
  }
});
await boss.work<{ connectionId: string }>("calendar.sync", async (jobs) => {
  for (const j of jobs) console.log(`[calendar] ${j.data.connectionId}`, await syncConnection(db, j.data.connectionId));
});
// bot scheduling: every minute, find meetings that need Milo and hand them to the bot; fail sessions whose bot went silent.
await boss.createQueue(BOT_JOIN_QUEUE, { name: BOT_JOIN_QUEUE, ...BOT_QUEUE_OPTIONS } as never);
await boss.createQueue("bot.tick");
await boss.schedule("bot.tick", "* * * * *");
await boss.work("bot.tick", async () => {
  for (const job of await planBotJoins(db)) { await boss.send(BOT_JOIN_QUEUE, job, BOT_QUEUE_OPTIONS); console.log(`[bot] scheduled ${job.url}`); }
  const reaped = await reapStaleBotSessions(db);
  if (reaped) console.warn(`[bot] marked ${reaped} silent session(s) as failed`);
});
console.log("worker up");
