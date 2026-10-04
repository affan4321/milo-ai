import { and, eq, sql } from "drizzle-orm";
import type { PipelineStage } from "@milo/core";
import { pipelineStage } from "./schema";
import type { Db } from "./client";

export async function ensureStages(db: Db, recordingId: string, stages: PipelineStage[]) {
  for (const stage of stages) {
    await db.insert(pipelineStage).values({ recordingId, stage }).onConflictDoNothing();
  }
}

/** Run one pipeline stage and record its state. Rethrows so the queue retries; the UI reads status/error from the row. */
export async function runStage<T>(db: Db, recordingId: string, stage: PipelineStage, fn: () => Promise<T>): Promise<T> {
  const where = and(eq(pipelineStage.recordingId, recordingId), eq(pipelineStage.stage, stage));
  await db.insert(pipelineStage).values({ recordingId, stage, status: "running", attempts: 1 })
    .onConflictDoUpdate({ target: [pipelineStage.recordingId, pipelineStage.stage], set: { status: "running", error: null, attempts: sql`${pipelineStage.attempts} + 1`, updatedAt: new Date() } });
  try {
    const out = await fn();
    await db.update(pipelineStage).set({ status: "done", error: null, updatedAt: new Date() }).where(where);
    return out;
  } catch (e) {
    await db.update(pipelineStage).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : String(e), updatedAt: new Date() }).where(where);
    throw e;
  }
}
