export * from "./schema";
export * from "./client";
export * from "./stage";
export * from "./workspace";

/**
 * Tests create and delete real rows. Call this first in any test that touches the database: it refuses to run against a hosted database
 * (e.g. the production Neon one that .env now points at). Set ALLOW_TEST_ON_REMOTE_DB=1 only if you really mean it.
 */
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "postgres://milo:milo@localhost:5433/milo";
  let host = ""; try { host = new URL(url).hostname; } catch {}
  if (["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(host) || process.env.ALLOW_TEST_ON_REMOTE_DB === "1") return;
  throw new Error(`Refusing to run: DATABASE_URL points at "${host}", not a local database. This test creates and deletes data. Run it with DATABASE_URL=postgres://milo:milo@localhost:5433/milo (docker compose up -d postgres).`);
}
