import { parseGoogleEvents } from "./calendar/google";
const r = parseGoogleEvents([
  { id: "a", summary: "Sync", start: { dateTime: "2026-10-05T15:00:00Z" }, end: { dateTime: "2026-10-05T16:00:00Z" }, hangoutLink: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "x@y.com", displayName: "X" }, { email: "room@r.com", resource: true }] },
  { id: "b", status: "cancelled", start: { dateTime: "2026-10-05T15:00:00Z" } },
  { id: "c", summary: "Holiday", start: { date: "2026-10-06" } },
  { id: "d", summary: "Call", start: { dateTime: "2026-10-07T10:00:00Z" }, end: { dateTime: "2026-10-07T10:30:00Z" }, location: "https://us02web.zoom.us/j/123?pwd=x" },
]);
const ok = r.length === 2 && r[0]!.platform === "meet" && r[0]!.attendees.length === 1 && r[1]!.platform === "zoom";
console.log(r.map((e) => `${e.title}/${e.platform}`), ok ? "ok" : "FAIL"); process.exit(ok ? 0 : 1);
