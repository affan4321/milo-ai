import PgBoss from "pg-boss";
import { Events, PipelineStages } from "@milo/core";
import { getDb, calendarConnections } from "@milo/db";
import { syncConnection } from "@milo/calendar";

const boss = new PgBoss(process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo");
boss.on("error", (e) => console.error("[boss]", e));
await boss.start();

// Queues without a handler yet just log; handlers are registered per build step. Modules never call each other.
const stubs = [Events.RecordingUploaded, Events.MediaReady, Events.TranscriptReady, ...PipelineStages];
for (const q of new Set(stubs)) {
  await boss.createQueue(q);
  await boss.work(q, async (jobs) => { for (const j of jobs) console.log(`[worker] ${q} (no handler yet)`, j.id); });
}

// calendar: a tick fans out one job per connection; each job is idempotent and retried with backoff.
await boss.createQueue("calendar.sync", { name: "calendar.sync", retryLimit: 3, retryBackoff: true });
await boss.createQueue("calendar.tick");
await boss.schedule("calendar.tick", "*/10 * * * *");
await boss.work("calendar.tick", async () => {
  for (const c of await getDb().select({ id: calendarConnections.id }).from(calendarConnections)) {
    await boss.send("calendar.sync", { connectionId: c.id }, { singletonKey: c.id, singletonSeconds: 60 });
  }
});
await boss.work<{ connectionId: string }>("calendar.sync", async (jobs) => {
  for (const j of jobs) {
    const r = await syncConnection(getDb(), j.data.connectionId);
    console.log(`[calendar] ${j.data.connectionId}`, r);
  }
});
console.log("worker up");
