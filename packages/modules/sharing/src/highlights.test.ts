// Run: npx tsx --env-file=.env packages/modules/sharing/src/highlights.test.ts
import { eq } from "drizzle-orm";
import { getDb, users, meetings, botSessions } from "@milo/db";
import { addHighlight, addHighlightAt, addLiveHighlight, listHighlights, deleteHighlight } from "./highlights";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
const db = getDb();
const [u] = await db.insert(users).values({ email: `hl-${Date.now()}@milo.local` }).returning();
const [m] = await db.insert(meetings).values({ ownerId: u!.id, title: "hl test", status: "recording", captureSource: "bot" }).returning();
const [s] = await db.insert(botSessions).values({ meetingId: m!.id, meetingUrl: "https://meet.google.com/x", platform: "meet", state: "scheduled" }).returning();

// not recording yet -> clear error, nothing saved
let r: any = await addLiveHighlight(db, m!.id, {});
check(r.error && /isn't recording/.test(r.error) && (await listHighlights(db, m!.id)).length === 0, "button before recording starts -> clear error");

// recording started 100 s ago -> button marks the 30 s before "now" on the recording clock
const t0 = new Date(Date.now() - 100_000);
await db.update(botSessions).set({ state: "recording", recordingStartedAt: t0 }).where(eq(botSessions.id, s!.id));
r = await addLiveHighlight(db, m!.id, { now: new Date(+t0 + 100_000), createdBy: "owner" });
check(r.created && r.highlight.startMs === 70_000 && r.highlight.endMs === 100_000 && r.highlight.source === "live_button", `live button marks the previous 30 s (got ${r.highlight?.startMs}-${r.highlight?.endMs})`);
r = await addLiveHighlight(db, m!.id, { now: new Date(+t0 + 102_000), createdBy: "owner" });
check(r.created === false && (await listHighlights(db, m!.id)).length === 1, "a second press 2 s later is the same moment");
r = await addLiveHighlight(db, m!.id, { now: new Date(+t0 + 140_000), createdBy: "owner", note: "  budget  " });
check(r.created && r.highlight.note === "budget", "a press 40 s later is a new highlight; note trimmed");

// early in the meeting the range is clamped at 0
r = await addHighlightAt(db, m!.id, 12_000, { source: "chat_command", createdBy: "Ada", note: "pricing" });
check(r.highlight.startMs === 0 && r.highlight.endMs === 12_000 && r.highlight.source === "chat_command", "chat command in the first 30 s clamps to the start");
// same chat command from the same person within 5 s is deduped; from someone else it isn't
check((await addHighlightAt(db, m!.id, 13_500, { source: "chat_command", createdBy: "Ada" })).created === false, "same person, same moment: deduped");
check((await addHighlightAt(db, m!.id, 13_500, { source: "chat_command", createdBy: "Bob" })).created === true, "a different person asking is kept");

// sanity on bad input
r = await addHighlight(db, { meetingId: m!.id, startMs: -500, endMs: -100, source: "after" });
check(r.highlight.startMs === 0 && r.highlight.endMs >= 1000, "negative / inverted ranges are made sane");

const all = await listHighlights(db, m!.id);
check(all.every((h, i) => i === 0 || all[i - 1]!.startMs <= h.startMs), "listed in time order");
await deleteHighlight(db, m!.id, all[0]!.id); check((await listHighlights(db, m!.id)).length === all.length - 1, "delete works");
await db.update(botSessions).set({ state: "left" }).where(eq(botSessions.id, s!.id));
check((await addLiveHighlight(db, m!.id, {}) as any).error, "after the bot has left, the button no longer works");

await db.delete(meetings).where(eq(meetings.id, m!.id)); await db.delete(users).where(eq(users.id, u!.id));
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
