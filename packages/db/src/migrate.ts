import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo";
const sql = postgres(url, { max: 1 });
await sql`CREATE EXTENSION IF NOT EXISTS vector`;
await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
await sql.end();
console.log("migrated");
