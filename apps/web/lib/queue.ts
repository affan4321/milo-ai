import PgBoss from "pg-boss";

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Send-only pg-boss client for the web process (the worker does the processing). */
export function getBoss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo", supervise: false, schedule: false, max: 2 });
    boss.on("error", (e) => console.error("[boss]", e));
    await boss.start();
    return boss;
  })();
  return g.__boss;
}

export async function enqueue(name: string, data: object, queueOptions: Record<string, unknown> = { retryLimit: 3, retryBackoff: true, retryDelay: 10 }) {
  const boss = await getBoss();
  await boss.createQueue(name, { name, ...queueOptions } as never); // idempotent: only the first creation sets options
  await boss.send(name, data);
}
