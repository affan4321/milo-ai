import { MicrosoftCalendar, MicrosoftAuthError, parseGraphEvents } from "./calendar/microsoft";
let fails = 0; const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

const ev = parseGraphEvents([
  { id: "1", subject: "Sync", start: { dateTime: "2026-10-05T15:00:00.0000000" }, end: { dateTime: "2026-10-05T16:00:00.0000000" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
    attendees: [{ emailAddress: { address: "a@x.com", name: "Ada" }, type: "required" }, { emailAddress: { address: "room@x.com" }, type: "resource" }], organizer: { emailAddress: { address: "boss@x.com" } } },
  { id: "2", subject: "Cancelled", isCancelled: true, start: { dateTime: "2026-10-05T15:00:00" } }, { id: "3", subject: "Holiday", isAllDay: true, start: { dateTime: "2026-10-06T00:00:00" } },
  { id: "4", subject: "Meet call", start: { dateTime: "2026-10-07T10:00:00" }, end: { dateTime: "2026-10-07T10:30:00" }, body: { content: "<p>Join <a href='x'>https://meet.google.com/abc-defg-hij</a></p>" }, attendees: [] },
  { id: "5", start: { dateTime: "2026-10-08T10:00:00Z" }, location: { displayName: "https://us02web.zoom.us/j/123?pwd=1" } },
]);
check(ev.length === 3 && ev[0]!.platform === "teams" && ev[0]!.startsAt.toISOString() === "2026-10-05T15:00:00.000Z", "times with no zone are read as UTC; cancelled and all-day events skipped; Teams link detected");
check(ev[0]!.attendees.length === 1 && ev[0]!.organizerEmail === "boss@x.com", "attendees (without rooms) and organizer captured");
check(ev[1]!.platform === "meet" && ev[2]!.platform === "zoom" && ev[2]!.title === "(no title)", "Meet link found in an HTML body; Zoom link in the location");

// refresh + pagination + errors, with a mocked Graph
const calls: string[] = [];
const graph = (pages: any[][], tokenStatus = 200, tokenBody: any = { access_token: "T" }, apiStatus = 200) => (async (u: string, init: any) => {
  calls.push(String(u));
  if (String(u).includes("/oauth2/v2.0/token")) return new Response(JSON.stringify(tokenBody), { status: tokenStatus });
  if (apiStatus !== 200) return new Response("{}", { status: apiStatus });
  const i = calls.filter((c) => c.includes("graph.microsoft.com")).length - 1;
  return new Response(JSON.stringify({ value: pages[i] ?? [], ...(i + 1 < pages.length ? { "@odata.nextLink": `https://graph.microsoft.com/page${i + 2}` } : {}) }));
}) as unknown as typeof fetch;
const e1 = { id: "a", subject: "A", start: { dateTime: "2026-10-05T10:00:00" }, end: { dateTime: "2026-10-05T11:00:00" } }, e2 = { ...e1, id: "b", subject: "B" };
const creds = { clientId: "c", clientSecret: "s", refreshToken: "r", tenant: "common" };
let r = await new MicrosoftCalendar(creds, 14, graph([[e1], [e2]])).listUpcoming();
check(r.length === 2 && calls.some((c) => c.includes("/common/oauth2/v2.0/token")) && calls.some((c) => c.endsWith("/page2")), "token refreshed, then follows the next-page link");
let e: any = await new MicrosoftCalendar(creds, 14, graph([], 400, { error: "invalid_grant" })).listUpcoming().catch((x) => x);
check(e instanceof MicrosoftAuthError && /Sign in with Microsoft again/.test(e.message), "revoked/expired refresh token -> a reconnect message");
e = await new MicrosoftCalendar(creds, 14, graph([], 200, { access_token: "T" }, 401)).listUpcoming().catch((x) => x);
check(e instanceof MicrosoftAuthError, "Graph 401 -> reconnect");
e = await new MicrosoftCalendar(creds, 14, graph([], 200, { access_token: "T" }, 503)).listUpcoming().catch((x) => x);
check(e instanceof Error && !(e instanceof MicrosoftAuthError), "Graph 5xx is a plain (retryable) error");
let sent: any; await new MicrosoftCalendar(creds, 14, (async (u: string, init: any) => { if (u.includes("token")) { sent = String(init.body); return new Response(JSON.stringify({ access_token: "T" })); } return new Response(JSON.stringify({ value: [] })); }) as any).listUpcoming();
check(sent.includes("grant_type=refresh_token") && sent.includes("offline_access"), "refresh request asks for the right grant and scope");
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
