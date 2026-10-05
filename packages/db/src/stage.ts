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

/**
 * Atomically reserve `n` units of a daily budget. Returns false (and reserves nothing) if it would exceed `limit`.
 * Days are UTC; a provider's own reset time differs, so budgets are set below the real limit.
 */
export async function reserveDaily(db: Db, key: string, n: number, limit: number, now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  if (n > limit) return false;
  const r = await db.execute(sql`
    INSERT INTO usage_counters (key, day, count) VALUES (${key}, ${day}, ${n})
    ON CONFLICT (key, day) DO UPDATE SET count = usage_counters.count + ${n} WHERE usage_counters.count + ${n} <= ${limit}
    RETURNING count`) as unknown as { count: number }[];
  return r.length > 0;
}
