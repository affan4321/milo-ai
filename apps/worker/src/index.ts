import PgBoss from "pg-boss";
import { BOT_JOIN_QUEUE, BOT_QUEUE_OPTIONS, Events, isPermanent } from "@milo/core";
import { getDb, calendarConnections, recordings, runStage } from "@milo/db";
import { eq } from "drizzle-orm";
import { getProviders } from "@milo/providers";
import { planBotJoins, reapStaleBotSessions, syncConnection } from "@milo/calendar";
import { processMedia } from "@milo/media";
import { transcribeRecording } from "@milo/transcription";
import { generateInsights } from "@milo/intelligence";
import { renderClip } from "@milo/sharing";
import { findUnindexedRecordings, indexRecording } from "@milo/indexing";
import { evaluateAlertsForMeeting, sendRecap } from "@milo/notify";

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
      await boss.send("indexing", j.data, { priority: 10 }); // fresh meetings jump ahead of any backlog; runs beside the summary, never waiting on it
      await boss.send("alerts", j.data);   // so do keyword alerts: they need only the transcript
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
// notify: the recap email goes out once the summary exists. A failure here never touches the meeting itself.
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
await queue(Events.InsightsReady);
await boss.work<RecordingJob>(Events.InsightsReady, async (jobs) => {
  for (const j of jobs) {
    try {
      const [rec] = await db.select().from(recordings).where(eq(recordings.id, j.data.recordingId));
      if (!rec) continue;
      const r = await runStage(db, j.data.recordingId, "notify", () => sendRecap(db, providers.email, rec.meetingId, APP_URL));
      console.log(`[notify] recap ${j.data.recordingId}`, r);
    } catch (e) { if (isPermanent(e)) { console.warn(`[notify] recap ${j.data.recordingId} failed permanently: ${e.message}`); continue; } throw e; }
  }
});

// alerts: match users' watched words against the transcript (and email the matches).
await queue("alerts");
await boss.work<RecordingJob>("alerts", async (jobs) => {
  for (const j of jobs) {
    try {
      const [rec] = await db.select().from(recordings).where(eq(recordings.id, j.data.recordingId));
      if (!rec) continue;
      const r = await evaluateAlertsForMeeting(db, providers.email, rec.meetingId, APP_URL);
      if (r.newHits) console.log(`[alerts] ${rec.meetingId}`, r);
    } catch (e) { if (isPermanent(e)) { console.warn(`[alerts] failed permanently: ${e.message}`); continue; } throw e; }
  }
});

// indexing: embed transcript lines for search and Ask. Throttled like the other LLM-backed stage, and independent of the summary.
// createQueue only sets options the FIRST time, so also updateQueue: a changed setting takes effect on the next start.
const indexingQueue = { name: "indexing", retryLimit: 5, retryBackoff: true, retryDelay: 60, expireInSeconds: 3 * 3600 } as never; // a big meeting is paced over many minutes
await boss.createQueue("indexing", indexingQueue); await boss.updateQueue("indexing", indexingQueue);
await boss.work<RecordingJob>("indexing", { batchSize: 1, pollingIntervalSeconds: 5 }, async (jobs) => {
  for (const j of jobs) {
    try { const r = await indexRecording(db, providers.llm, j.data.recordingId); console.log(`[indexing] ${j.data.recordingId} ${r.embedded}/${r.segments} lines embedded`); }
    catch (e) { if (isPermanent(e)) { console.warn(`[indexing] ${j.data.recordingId} failed permanently: ${e.message}`); continue; } throw e; }
  }
});

// Sweep: queue indexing for any meeting with un-embedded lines (older meetings, or earlier failures). At start, then every 30 minutes.
// singletonKey (20 min, shorter than the 30 min sweep) stops a restart from queuing the same recording twice, but never blocks a retry of a failed one.
const sweepIndexing = async () => {
  for (const recordingId of await findUnindexedRecordings(db, providers.llm.embedModel ?? "unknown")) await boss.send("indexing", { recordingId }, { singletonKey: recordingId, singletonSeconds: 1200 });
};
await sweepIndexing().catch((e) => console.warn("[indexing] sweep failed:", e instanceof Error ? e.message : e));
setInterval(() => void sweepIndexing().catch(() => {}), 30 * 60_000);

// clips: cut the requested range out of the playable recording.
await boss.createQueue("clip.create", { name: "clip.create", retryLimit: 2, retryBackoff: true, retryDelay: 10, expireInSeconds: 1800 } as never);
await boss.work<{ clipId: string }>("clip.create", async (jobs) => {
  for (const j of jobs) {
    try { await renderClip(db, providers.storage, j.data.clipId); console.log(`[clip] ${j.data.clipId} ready`); }
    catch (e) { if (isPermanent(e)) { console.warn(`[clip] ${j.data.clipId} failed permanently: ${e.message}`); continue; } throw e; }
  }
});

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
