import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo";
    // Serverless hosting opens many short-lived instances, so keep each one's pool tiny (DB_POOL_MAX=1) and, behind a transaction
    // pooler such as Neon's/pgbouncer, turn off prepared statements (DB_PREPARE=false). Defaults suit a long-running server.
    const max = Number(process.env.DB_POOL_MAX) || 10;
    _db = drizzle(postgres(url, { max, prepare: process.env.DB_PREPARE !== "false", onnotice: () => {} }), { schema }); // onnotice: silence harmless NOTICEs (e.g. stop-word-only search queries)
  }
  return _db;
}
export type Db = ReturnType<typeof getDb>;
