// Integration check against a real Postgres (DATABASE_URL). Run: npx tsx packages/modules/calendar/src/sync.test.ts
import http from "node:http";
import { eq } from "drizzle-orm";
import { getDb, users, calendarConnections, calendarEvents } from "@milo/db";
import { connectIcs, syncConnection } from "./index";

const day = (n: number, h = 15) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 11).replace(/-|:/g, "") + String(h).padStart(2, "0") + "0000Z";
let body = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:t1\nDTSTART:${day(1)}\nDTEND:${day(1, 16)}\nSUMMARY:Design review\nLOCATION:https://meet.google.com/aaa-bbbb-ccc\nEND:VEVENT\nEND:VCALENDAR`;
const server = http.createServer((req, res) => {
  if (req.url === "/bad.ics") { res.statusCode = 404; return res.end(); }
  res.end(body);
}).listen(0);
const port = (server.address() as any).port;
const db = getDb();
const assert = (c: unknown, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

const email = `test-${Date.now()}@milo.local`;
const [u] = await db.insert(users).values({ email }).returning();
const r1 = await connectIcs(db, u!.id, `http://localhost:${port}/cal.ics`);
assert(r1.synced === 1, "first sync inserts 1 event");
const again = await connectIcs(db, u!.id, `http://localhost:${port}/cal.ics`);
assert(again.connectionId === r1.connectionId, "same URL reuses connection");
let rows = await db.select().from(calendarEvents).where(eq(calendarEvents.connectionId, r1.connectionId));
assert(rows.length === 1 && rows[0]!.platform === "meet", "idempotent upsert, platform detected");

body = body.replace("Design review", "Design review v2");
await syncConnection(db, r1.connectionId);
rows = await db.select().from(calendarEvents).where(eq(calendarEvents.connectionId, r1.connectionId));
assert(rows.length === 1 && rows[0]!.title === "Design review v2", "update applies in place");

const bad = await connectIcs(db, u!.id, `http://localhost:${port}/bad.ics`);
assert(bad.error?.includes("404"), "bad feed reports error");
const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, bad.connectionId));
assert(c!.lastError, "error stored on connection");
let threw = false; try { await connectIcs(db, u!.id, "not a url"); } catch { threw = true; }
assert(threw, "non-URL rejected");

await db.delete(users).where(eq(users.id, u!.id));
console.log("ok"); server.close(); process.exit(0);
