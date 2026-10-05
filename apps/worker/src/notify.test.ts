// Recap emails and keyword alerts against Postgres with an in-memory mailbox. Run: npx tsx --env-file=.env apps/worker/src/notify.test.ts
import { eq, sql } from "drizzle-orm";
import { getDb, users, preferences, meetings, speakers, transcriptSegments, summaries, actionItems, calendarConnections, calendarEvents, ensureWorkspace, alerts, alertHits } from "@milo/db";
import { FakeEmail } from "@milo/providers";
import { recipientsFor, buildRecapEmail, sendRecap, createAlert, deleteAlert, listAlerts, listHits, evaluateAlertsForMeeting, MAX_ALERTS } from "@milo/notify";

let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const db = getDb(), stamp = Date.now(), URL_ = "http://app.test";

// ---------- pure: recipients ----------
const att = [{ email: "Ada@acme.io" }, { email: "bob@client.com" }, { email: "noreply@x.com" }, { email: "garbage" }, { email: "ada@acme.io" }];
check(recipientsFor("attendees", "owner@acme.io", att).join() === "owner@acme.io,ada@acme.io,bob@client.com", "attendees rule: owner + valid unique invitees (no noreply, no garbage, case-folded)");
check(recipientsFor("internal", "owner@acme.io", att).join() === "owner@acme.io,ada@acme.io", "internal rule: only the owner's own domain");
check(recipientsFor("none", "owner@acme.io", att).length === 0 && recipientsFor("whatever", "o@a.io", att).length === 0, "none / unknown rule: nobody");
check(recipientsFor("attendees", "owner@acme.io", []).join() === "owner@acme.io", "no invitee info: just the owner");

// ---------- pure: email content ----------
const evil = buildRecapEmail({ title: `Q3 <script>alert(1)</script> "plan" & more`, when: new Date("2026-10-05T10:00:00Z"), url: `http://x/y"><img src=x onerror=alert(1)>`,
  sections: [{ heading: "Key <b>points</b>", bullets: ["Budget & <i>risk</i>", "x".repeat(10)] }, { heading: "Empty", bullets: [] }], actionItems: [{ text: "Send <memo>", assignee: "Ada <ada>", ms: 65_000 }] });
check(!evil.html.includes("<script>") && !evil.html.includes("<img src=x") && !evil.html.includes("<b>points") && evil.html.includes("&lt;script&gt;"), "meeting titles, summaries and URLs are HTML-escaped");
check(!evil.html.includes("Empty") && evil.text.includes("Send <memo>") && evil.text.includes("(1:05)") && evil.subject === 'Recap: Q3 <script>alert(1)</script> "plan" & more', "empty sections omitted; plain-text version has times; subject is plain text");
check(buildRecapEmail({ title: "T".repeat(500), when: new Date(), url: "u", sections: [], actionItems: [] }).subject.length <= 150, "subject length is capped");

// ---------- recap sending ----------
const mk = async (email: string) => { const [u] = await db.insert(users).values({ email: `${stamp}-${email}` }).returning(); await db.insert(preferences).values({ userId: u!.id, onboarded: true }); return u!; };
const owner = await mk(`owner@acme-${stamp}-test.io`), mate = await mk(`mate@acme-${stamp}-test.io`), other = await mk(`other@zzz-${stamp}-test.io`);
const dom = (u: typeof owner) => u.email.split("@")[1]!;
for (const u of [owner, mate, other]) await ensureWorkspace(db, u.id);
const [conn] = await db.insert(calendarConnections).values({ userId: owner.id, kind: "ics", icsUrl: "http://x" }).returning();
const [ev] = await db.insert(calendarEvents).values({ connectionId: conn!.id, externalId: "e1", title: "Sync", startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), attendees: [{ email: `colleague@${dom(owner)}` }, { email: "client@outside-test.com" }] }).returning();
async function meeting(o: { title: string; withEvent?: boolean; visibility?: string }) {
  const [m] = await db.insert(meetings).values({ ownerId: owner.id, workspaceId: await ensureWorkspace(db, owner.id), title: o.title, status: "ready", captureSource: "upload", visibility: o.visibility ?? "private", calendarEventId: o.withEvent ? ev!.id : null }).returning();
  return m!;
}
const withSummary = async (id: string) => { await db.insert(summaries).values({ meetingId: id, templateKey: "general", content: { sections: [{ heading: "Overview", bullets: [{ text: "We agreed the launch date.", ms: 5000 }] }] } }); await db.insert(actionItems).values({ meetingId: id, text: "Draft the memo", assignee: "Ada", sourceMs: 9000 }); };
const mail = new FakeEmail();

let m1 = await meeting({ title: "Launch planning", withEvent: true }); await withSummary(m1.id);
let r: any = await sendRecap(db, mail, m1.id, URL_);
check(r.sent === 3 && mail.sent.map((x) => x.to).sort().join() === [owner.email, `colleague@${dom(owner)}`, "client@outside-test.com"].map((x) => x.toLowerCase()).sort().join(), "attendees rule: recap goes to owner + both invitees");
check(mail.sent[0]!.html.includes("We agreed the launch date.") && mail.sent[0]!.html.includes("Draft the memo") && mail.sent[0]!.html.includes(`${URL_}/meetings/${m1.id}`) && !!mail.sent[0]!.text, "recap has the summary, action items, a link, and a plain-text part");
mail.sent.length = 0; r = await sendRecap(db, mail, m1.id, URL_);
check(r.skipped === "already_sent" && mail.sent.length === 0, "a second run sends nothing (idempotent)");

await db.update(preferences).set({ autoShareRule: "internal" }).where(eq(preferences.userId, owner.id));
const m2 = await meeting({ title: "Internal only", withEvent: true }); await withSummary(m2.id);
r = await sendRecap(db, mail, m2.id, URL_);
check(r.sent === 2 && !mail.sent.some((x) => x.to.includes("outside-test")), "internal rule: outside invitees get nothing");
await db.update(preferences).set({ autoShareRule: "none" }).where(eq(preferences.userId, owner.id));
const m3 = await meeting({ title: "No sharing" }); await withSummary(m3.id);
check((await sendRecap(db, mail, m3.id, URL_) as any).skipped === "rule_none", "rule none: no email");
await db.update(preferences).set({ autoShareRule: "attendees", recapEmail: false }).where(eq(preferences.userId, owner.id));
const m4 = await meeting({ title: "Opted out" }); await withSummary(m4.id);
check((await sendRecap(db, mail, m4.id, URL_) as any).skipped === "disabled", "recap emails switched off: no email");
await db.update(preferences).set({ recapEmail: true }).where(eq(preferences.userId, owner.id));
const m5 = await meeting({ title: "No summary yet" });
check((await sendRecap(db, mail, m5.id, URL_) as any).skipped === "no_summary", "no summary yet: waits (nothing sent, not marked sent)");
const down = { async send() { throw new Error("smtp down"); } };
const m6 = await meeting({ title: "Mail is down", withEvent: true }); await withSummary(m6.id);
let e: any = await sendRecap(db, down as any, m6.id, URL_).catch((x) => x);
check(e?.message === "smtp down" && (await db.select().from(meetings).where(eq(meetings.id, m6.id)))[0]!.recapSentAt === null, "all deliveries fail: error propagates (queue retries) and the meeting is NOT marked sent");
let n = 0; const flaky = { async send(x: any) { if (++n === 2) throw new Error("bounce"); } };
r = await sendRecap(db, flaky as any, m6.id, URL_);
check(r.sent === 2 && r.failed?.length === 1 && (await db.select().from(meetings).where(eq(meetings.id, m6.id)))[0]!.recapSentAt !== null, "partial failure: marked sent (no duplicate mail on retry) and the failure is reported");

// ---------- alerts ----------
check((await createAlert(db, owner.id, " a ") as any).error, "alert needs at least 2 characters");
const a1 = (await createAlert(db, owner.id, "refund  policy") as any).alert; check(a1.keyword === "refund policy", "alert text is tidied");
check((await createAlert(db, owner.id, "Refund Policy") as any).error, "duplicate alert (any case) rejected");
for (let i = 0; i < MAX_ALERTS - 1; i++) await createAlert(db, owner.id, `topic number ${i} zq`);
check((await createAlert(db, owner.id, "one too many") as any).error, `limit of ${MAX_ALERTS} alerts`);
for (const x of (await listAlerts(db, owner.id)).filter((x) => x.keyword.startsWith("topic number"))) await deleteAlert(db, owner.id, x.id);
const a2 = (await createAlert(db, owner.id, "budget")).alert!; const a3 = (await createAlert(db, owner.id, "'; DROP TABLE alerts; --")).alert!;
const mateAlert = (await createAlert(db, mate.id, "budget")).alert!, otherAlert = (await createAlert(db, other.id, "budget")).alert!;

async function transcript(title: string, lines: string[], visibility = "private") {
  const m = await meeting({ title, visibility }); const [sp] = await db.insert(speakers).values({ meetingId: m.id, label: "Ada", displayName: "Ada" }).returning();
  await db.insert(transcriptSegments).values(lines.map((text, i) => ({ meetingId: m.id, speakerId: sp!.id, startMs: i * 15_000, endMs: i * 15_000 + 10_000, text, tsv: sql`to_tsvector('english', ${text})` as unknown as string })));
  return m;
}
const t1 = await transcript("Policy review", ["Welcome everyone.", "We need to update the refund policy before launch.", "The budget is the main risk for this quarter."]);
mail.sent.length = 0;
let ev1 = await evaluateAlertsForMeeting(db, mail, t1.id, URL_);
check(ev1.newHits === 2 && ev1.emails === 1, `own alerts match the transcript (${ev1.newHits} hits, ${ev1.emails} email)`);
check(mail.sent.length === 1 && mail.sent[0]!.to === owner.email && mail.sent[0]!.html.includes("refund policy") && mail.sent[0]!.html.includes(`${URL_}/meetings/${t1.id}?t=15000`) && !mail.sent[0]!.html.includes("«"), "one email, to the owner, with a link to the exact moment and no highlight markers");
check((await evaluateAlertsForMeeting(db, mail, t1.id, URL_)).newHits === 0 && mail.sent.length === 1, "re-evaluating finds nothing new and sends nothing");
check((await db.select().from(alertHits).where(eq(alertHits.alertId, a3.id))).length === 0, "an alert containing SQL-looking text is just text");
check((await db.select().from(alertHits).where(eq(alertHits.alertId, mateAlert.id))).length === 0, "a teammate's alert does NOT see a private meeting");
await db.update(meetings).set({ visibility: "team" }).where(eq(meetings.id, t1.id));
mail.sent.length = 0; const ev2 = await evaluateAlertsForMeeting(db, mail, t1.id, URL_);
check(ev2.newHits === 1 && mail.sent.length === 1 && mail.sent[0]!.to === mate.email, "once shared with the team, the teammate's alert matches (and only theirs)");
check((await db.select().from(alertHits).where(eq(alertHits.alertId, otherAlert.id))).length === 0, "someone in another workspace never matches");
// email failure -> hits removed so a retry re-sends
const t2 = await transcript("Budget again", ["The budget was approved."]);
e = await evaluateAlertsForMeeting(db, down as any, t2.id, URL_).catch((x) => x);
check(e?.message === "smtp down" && (await db.select().from(alertHits).where(eq(alertHits.meetingId, t2.id))).length === 0, "email failure rolls the hits back so the retry can re-detect and re-send");
mail.sent.length = 0; check((await evaluateAlertsForMeeting(db, mail, t2.id, URL_)).emails === 1 && mail.sent.length === 1, "...and the retry sends it");
// notification preferences
await db.update(preferences).set({ alertEmails: false }).where(eq(preferences.userId, owner.id));
const t3 = await transcript("Quiet", ["Another budget line."]); mail.sent.length = 0;
const ev3 = await evaluateAlertsForMeeting(db, mail, t3.id, URL_);
check(ev3.newHits === 1 && mail.sent.length === 0, "alert emails off: hits are still recorded, no email");
await db.update(alerts).set({ notifyEmail: false }).where(eq(alerts.id, a2.id)); await db.update(preferences).set({ alertEmails: true }).where(eq(preferences.userId, owner.id));
const t4 = await transcript("Silent alert", ["More budget talk."]); mail.sent.length = 0;
check((await evaluateAlertsForMeeting(db, mail, t4.id, URL_)).newHits === 1 && mail.sent.length === 0, "per-alert email switch off: hit recorded, no email");

// viewing
const list = await listAlerts(db, owner.id); const L2 = list.find((x) => x.id === a2.id)!;
check(L2.total >= 3 && L2.unseen === L2.total, `alert list shows hit counts, all unseen at first (${L2.total}/${L2.unseen})`);
const view = await listHits(db, owner.id, a2.id);
check(view && view.hits.length === L2.total && view.hits[0]!.title && view.hits.every((h) => h.startMs >= 0), "opening an alert lists its hits with meeting and moment");
check((await listAlerts(db, owner.id)).find((x) => x.id === a2.id)!.unseen === 0, "opening it marks the hits as seen");
check(await listHits(db, mate.id, a2.id) === null && !(await deleteAlert(db, mate.id, a2.id)), "someone else can't read or delete your alert");
check(await deleteAlert(db, owner.id, a2.id) && (await db.select().from(alertHits).where(eq(alertHits.alertId, a2.id))).length === 0, "deleting an alert removes its hits");

// cleanup (users first: deleting them cascades their alerts, which would otherwise block deleting the workspaces)
for (const u of [owner, mate, other]) await db.delete(meetings).where(eq(meetings.ownerId, u.id));
for (const u of [owner, mate, other]) await db.delete(users).where(eq(users.id, u.id));
await db.execute(sql`delete from workspaces where name like ${"%-" + stamp + "-test.io"}`);
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
