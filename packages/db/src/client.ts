import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo";
    _db = drizzle(postgres(url), { schema });
  }
  return _db;
}
export type Db = ReturnType<typeof getDb>;
