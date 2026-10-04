import { parseIcs } from "./calendar/ics";
const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a1
DTSTART:20261005T150000Z
DTEND:20261005T160000Z
SUMMARY:Sync
LOCATION:https://meet.google.com/abc-defg-hij
ATTENDEE;CN=Ada:mailto:ada@x.com
END:VEVENT
BEGIN:VEVENT
UID:w1
DTSTART:20261006T090000Z
DTEND:20261006T093000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Standup
DESCRIPTION:Join https://zoom.us/j/999
END:VEVENT
END:VCALENDAR`;
const r = parseIcs(ics, new Date("2026-10-04"), new Date("2026-10-20"));
console.log(r.map((e) => `${e.title} ${e.startsAt.toISOString()} ${e.platform} ${e.attendees.length}`));
if (r.length !== 4 || r[0]!.platform !== "meet" || r[1]!.platform !== "zoom") { console.error("FAIL"); process.exit(1); }
console.log("ok");
