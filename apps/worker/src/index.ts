import PgBoss from "pg-boss";
import { Events, isPermanent } from "@milo/core";
import { getDb, calendarConnections } from "@milo/db";
import { getProviders } from "@milo/providers";
import { syncConnection } from "@milo/calendar";
import { processMedia } from "@milo/media";
import { transcribeRecording } from "@milo/transcription";

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

await queue(Events.MediaReady);
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

await queue(Events.TranscriptReady);
await boss.work(Events.TranscriptReady, async (jobs) => {
  for (const j of jobs) console.log(`[worker] ${Events.TranscriptReady} (no consumer yet)`, j.id);
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
console.log("worker up");
