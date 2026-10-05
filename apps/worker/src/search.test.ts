// Indexing, hybrid search, scopes and Ask Milo against Postgres with deterministic fake embeddings.
// Run: npx tsx --env-file=.env apps/worker/src/search.test.ts
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, users, meetings, recordings, speakers, transcriptSegments, ensureWorkspace, askThreads, pipelineStage, reserveDaily } from "@milo/db";
import { FakeLlm } from "@milo/providers";
import { indexRecording, unindexedCount, findUnindexedRecordings } from "@milo/indexing";
import { searchMeetings, askMilo, editMessage, listThreads, deleteThread, loadThread, renumberCitations, hybridHits } from "@milo/search";
import { assertTestDatabase } from "@milo/db"; assertTestDatabase(); // never run these against the hosted database

let fails = 0;
const check = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fails++; };
const db = getDb(), llm = new FakeLlm(), stamp = Date.now();

const mk = async (email: string) => { const [u] = await db.insert(users).values({ email: `${stamp}-${email}` }).returning(); return u!; };
const A = await mk(`alice@acme-${stamp}-test.io`), B = await mk(`bob@acme-${stamp}-test.io`), C = await mk(`carol@other-${stamp}-test.io`);
// work-email users share a workspace per domain; the domain here is unique to this run

for (const u of [A, B, C]) await ensureWorkspace(db, u.id);

const made: { meetingId: string; recId: string }[] = [];
async function meeting(owner: typeof A, title: string, visibility: "private" | "team", lines: [string, string][]) {
  const [m] = await db.insert(meetings).values({ ownerId: owner.id, workspaceId: await ensureWorkspace(db, owner.id), title, status: "ready", captureSource: "upload", visibility }).returning();
  const [rec] = await db.insert(recordings).values({ meetingId: m!.id, rawKey: "x", durationMs: 600_000 }).returning();
  const names = [...new Set(lines.map((l) => l[0]))];
  const sp = await db.insert(speakers).values(names.map((n) => ({ meetingId: m!.id, label: n, displayName: n }))).returning();
  const rows = lines.map(([who, text], i) => ({ meetingId: m!.id, speakerId: sp.find((s) => s.label === who)!.id, startMs: i * 20_000, endMs: i * 20_000 + 15_000, text, tsv: sql`to_tsvector('english', ${text})` as unknown as string }));
  await db.insert(transcriptSegments).values(rows);
  made.push({ meetingId: m!.id, recId: rec!.id });
  return { id: m!.id, recId: rec!.id };
}
const M1 = await meeting(A, "Pricing launch planning", "private", [["Ada", "We will launch the new pricing page on October twentieth."], ["Ben", "Engineering needs to drop the coupon feature to hit that launch date."], ["Ada", "Agreed. Marketing will draft the launch email by Monday."]]);
const M2 = await meeting(A, "Support backlog review", "private", [["Cy", "We have forty open support tickets and the backlog keeps growing."], ["Dee", "We need one more hire for the support team to clear the tickets."]]);
const M3 = await meeting(B, "Roadmap review", "team", [["Bob", "The roadmap includes the calendar integration and the pricing page launch."], ["Eve", "The calendar integration ships before the end of the quarter."]]);
const M4 = await meeting(B, "Confidential people discussion", "private", [["Bob", "TOPSECRET layoffs plan for the pricing team next quarter."]]);
const M5 = await meeting(C, "Competitor intel", "team", [["Carl", "Their pricing page launch is next week and the competitor pricing looks aggressive."]]);

// ---------- indexing ----------
for (const x of made) await indexRecording(db, llm, x.recId, { textsPerMinute: Infinity });
check((await Promise.all(made.map((x) => unindexedCount(db, x.meetingId)))).every((n) => n === 0), "every transcript line gets an embedding");
const [st] = await db.select().from(pipelineStage).where(eq(pipelineStage.recordingId, M1.recId));
check(st?.stage === "indexing" && st.status === "done", "indexing stage recorded as done");
await db.execute(sql`update transcript_segments set embedding = null where meeting_id = ${M1.id} and start_ms = 0`);
check(await unindexedCount(db, M1.id) === 1, "(simulated) one line lost its embedding");
let calls = 0; const counting = Object.assign(new FakeLlm(), { embed: async (t: string[], k?: any) => { calls += t.length; return new FakeLlm().embed(t, k); } });
await indexRecording(db, counting, M1.recId, { textsPerMinute: Infinity });
check(calls === 1 && await unindexedCount(db, M1.id) === 0, `a retry re-embeds only what's missing (${calls} line)`);

// pacing: 100 lines at 70 texts/min must wait between chunks (but not after the last), and stay under the per-minute budget
const M6 = await meeting(A, "Pacing meeting", "private", Array.from({ length: 100 }, (_, i) => ["Ada", `Pacing line number ${i} about quarterly budget`] as [string, string]));
const sleeps: number[] = []; const t0 = Date.now(); const metered = Object.assign(new FakeLlm(), { embedMetered: true });
await indexRecording(db, metered, M6.recId, { textsPerMinute: 70, budgetKey: "embed-test", dailyBudget: 1_000_000, sleep: async (ms) => { sleeps.push(ms); } });
check(sleeps.length === 2 && sleeps.every((s) => s > 29_000 && s < 31_000), `100 lines -> 3 chunks, paced: waits ${sleeps.map((s) => Math.round(s / 1000) + "s").join(", ")} between them (35 texts / 70 per min = 30s)`);
check(Date.now() - t0 < 20_000 && await unindexedCount(db, M6.id) === 0, "all lines embedded (the test did not actually sleep)");

// daily budget: indexing stops cleanly when its share of the provider's daily allowance is spent, keeps what it did, and resumes later
const M7 = await meeting(A, "Budget meeting", "private", Array.from({ length: 90 }, (_, i) => ["Ada", `Budget test line ${i} about forecasting`] as [string, string]));
await db.execute(sql`delete from usage_counters where key = 'embed-test'`);
let capped: any = await indexRecording(db, metered, M7.recId, { textsPerMinute: Infinity, dailyBudget: 80, budgetKey: "embed-test" }).catch((e) => e);
check(capped instanceof Error && /paused for today/.test(capped.message) && (capped as any).constructor.name === "DailyQuotaError", "out of daily budget: a clear 'paused for today' error (not retried)");
check(await unindexedCount(db, M7.id) === 20, `70 lines were embedded before the budget ran out (20 of 90 left) - the work done is kept`);
capped = await indexRecording(db, metered, M7.recId, { textsPerMinute: Infinity, dailyBudget: 80, budgetKey: "embed-test" }).catch((e) => e);
check(capped instanceof Error && await unindexedCount(db, M7.id) === 20, "asking again the same day embeds nothing more");
await db.execute(sql`update usage_counters set day = '2000-01-01' where key = 'embed-test'`);   // "tomorrow"
await indexRecording(db, metered, M7.recId, { textsPerMinute: Infinity, dailyBudget: 80, budgetKey: "embed-test" });
check(await unindexedCount(db, M7.id) === 0, "the next day it resumes and finishes the remaining lines");
await db.execute(sql`delete from usage_counters where key = 'embed-test'`);
check(await reserveDaily(db, "k", 5, 10) && await reserveDaily(db, "k", 5, 10) && !(await reserveDaily(db, "k", 1, 10)) && !(await reserveDaily(db, "k", 11, 10)), "reserveDaily: fills exactly to the limit, then refuses (and a single oversized ask is refused)");
await db.execute(sql`delete from usage_counters where key = 'k'`);

// model identity: vectors from another model are never mixed in; switching models re-embeds, and local (unmetered) models skip the daily budget
const M8 = await meeting(A, "Model switch meeting", "private", Array.from({ length: 6 }, (_, i) => ["Ada", `Switching embedding model line ${i} about quarterly forecasting`] as [string, string]));
await indexRecording(db, llm, M8.recId, { textsPerMinute: Infinity });
check(await unindexedCount(db, M8.id, "fake-bow") === 0 && await unindexedCount(db, M8.id, "some-other-model") === 6, "each line remembers which model embedded it");
await db.execute(sql`update transcript_segments set embedding_model = 'gemini-embedding-001' where meeting_id = ${M8.id}`);   // pretend an older model made them
const sw = await searchMeetings(db, llm, A.id, { q: "quarterly forecasting switching", scope: "my" });
check(sw.results.some((x) => x.meetingId === M8.id) && sw.results.find((x) => x.meetingId === M8.id)!.hits.every((h) => h.via === "keyword"), "vectors from a different model are ignored (the meeting is still found by keyword)");
let calls8 = 0; const counting8 = Object.assign(new FakeLlm(), { embed: async (t: string[], k?: any) => { calls8 += t.length; return new FakeLlm().embed(t, k); } });
await indexRecording(db, counting8, M8.recId, { textsPerMinute: Infinity, dailyBudget: 1 });   // budget of 1 would block a metered provider; this one is local
check(calls8 === 6 && await unindexedCount(db, M8.id, "fake-bow") === 0, "switching model re-embeds every line, and an unmetered (local) model ignores the daily budget");
const sw2 = await searchMeetings(db, llm, A.id, { q: "quarterly forecasting switching", scope: "my" });
check(sw2.results.find((x) => x.meetingId === M8.id)!.hits.some((h) => h.via !== "keyword"), "after re-embedding, meaning-based matches work again");
check((await findUnindexedRecordings(db, "fake-bow")).every((id) => id !== M8.recId) && (await findUnindexedRecordings(db, "another-model")).includes(M8.recId), "the sweep queues meetings embedded by a different model");

// ---------- search & scopes ----------
const ids = (r: { results: { meetingId: string }[] }) => r.results.map((x) => x.meetingId);
let r = await searchMeetings(db, llm, A.id, { q: "launch date", scope: "my" });
check(ids(r)[0] === M1.id && !ids(r).includes(M3.id) && !ids(r).includes(M5.id), "my calls: best match first, never a teammate's or outsider's");
check(r.results[0]!.createdAt instanceof Date && r.results[0]!.hits[0]!.createdAt instanceof Date && !Number.isNaN(+r.results[0]!.createdAt), "dates come back as real Date objects (raw SQL returns strings)");
check(r.results[0]!.hits[0]!.snippet.includes("«") && r.results[0]!.hits[0]!.snippet.includes("»"), "keyword hits carry highlighted snippets");
check(r.results[0]!.hits.some((h) => h.startMs === 20_000), "hit points at the exact moment (20s line about the launch date)");
r = await searchMeetings(db, llm, A.id, { q: "calendar integration", scope: "team" });
check(ids(r).join() === M3.id, "team calls: a teammate's TEAM-shared meeting is found");
r = await searchMeetings(db, llm, A.id, { q: "TOPSECRET layoffs", scope: "all" });
check(r.results.length === 0, "a teammate's PRIVATE meeting never appears, even in All calls");
r = await searchMeetings(db, llm, B.id, { q: "TOPSECRET layoffs", scope: "my" });
check(ids(r).join() === M4.id, "…but its owner can find it in My calls");
r = await searchMeetings(db, llm, A.id, { q: "competitor pricing", scope: "all" });
check(!ids(r).includes(M5.id), "another company's team-shared meeting never appears");
r = await searchMeetings(db, llm, A.id, { q: "pricing", scope: "all" });
check(ids(r).includes(M1.id) && ids(r).includes(M3.id) && !ids(r).includes(M4.id) && !ids(r).includes(M5.id), "all calls = mine + team-shared teammates', nothing else");
check(r.results.find((x) => x.meetingId === M3.id)!.mine === false && r.results.find((x) => x.meetingId === M1.id)!.mine === true, "results say whose meeting it is");
r = await searchMeetings(db, llm, A.id, { q: "pricing", scope: "my" });
check(!ids(r).includes(M3.id), "my calls excludes teammates' meetings");

// semantic: different wording than any single line, same meaning-ish words
r = await searchMeetings(db, llm, A.id, { q: "support tickets hire team", scope: "my" });
check(ids(r)[0] === M2.id, "meaning/keyword fusion ranks the support meeting first");
const hy = await hybridHits(db, llm, A.id, "my", "support tickets hire team");
check(hy.hits.some((h) => h.via === "both"), "a line matched by both keyword and meaning is marked 'both'");
// titles & speakers
r = await searchMeetings(db, llm, A.id, { q: "Support backlog", scope: "my" });
check(r.results.find((x) => x.meetingId === M2.id)?.titleMatch === true, "title matches are found");
r = await searchMeetings(db, llm, A.id, { q: "Dee", scope: "my" });
check(ids(r).includes(M2.id), "a speaker's name finds their meeting");

// degradation: embedding provider down -> keyword results still returned, flagged
const broken = Object.assign(new FakeLlm(), { embed: async () => { throw new Error("embedding service down"); } });
r = await searchMeetings(db, broken, A.id, { q: "launch date", scope: "my" });
check(r.degraded === true && ids(r)[0] === M1.id, "embeddings unavailable: keyword results still work and are flagged degraded");

// hostile / odd input
for (const q of ["'; DROP TABLE meetings; --", "100%", "_", "\"unbalanced quote", "a & | ! ( ) :*", "\\", "   ", "x".repeat(5000), "«»"]) {
  try { await searchMeetings(db, llm, A.id, { q, scope: "all" }); } catch (e) { check(false, `query ${JSON.stringify(q.slice(0, 20))} threw: ${(e as Error).message.slice(0, 80)}`); }
}
check((await db.select().from(meetings).where(eq(meetings.id, M1.id))).length === 1, "hostile queries did no harm");
r = await searchMeetings(db, llm, A.id, { q: "%", scope: "my" }); check(r.results.length === 0, "'%' is a literal, not a wildcard that matches everything");
r = await searchMeetings(db, llm, A.id, { q: "zzzzqqqq nonexistent", scope: "all" }); check(r.results.length === 0, "no match -> no results");

// ---------- Ask Milo ----------
check(JSON.stringify(renumberCitations("[7] and [3] again [7] and [9] end", ["7", "3", "5"])) === JSON.stringify({ text: "[1] and [2] again [1] and end", order: ["7", "3", "5"] }), "citations are renumbered in order of appearance; invented markers removed");
// helper: ask, then read the saved result back the way the UI does
const ask = async (u: typeof A, q: string, scope: "my" | "team" | "all" = "my", threadId?: string | null, llmImpl: any = llm) => {
  const r: any = await askMilo(db, llmImpl, u.id, { question: q, scope, threadId });
  if (r.error) return r;
  const t = (await loadThread(db, u.id, r.threadId))!; const last = t.messages[t.messages.length - 1]!;
  return { threadId: r.threadId, degraded: r.degraded, answer: last.content, citations: last.citations, messages: t.messages, thread: t.thread };
};
let a: any = await ask(A, "When is the pricing page launch?");
check(a.answer && a.citations.length > 0 && a.citations.every((c: any, i: number) => c.n === i + 1), `answer comes with numbered citations (${a.citations?.length})`);
check(a.citations.every((c: any) => c.meetingId === M1.id) && a.citations.some((c: any) => c.startMs >= 0), "citations point at the user's own meeting and an exact moment");
check(!JSON.stringify(a).includes("TOPSECRET") && !a.citations.some((c: any) => [M3.id, M4.id, M5.id].includes(c.meetingId)), "Ask in My calls draws only on my meetings");
check(a.citations.every((c: any) => !c.snippet.includes("\n")), "a citation shows the cited line itself, not the widened context window");

// --- persistence: a conversation can be closed and reopened later with its citations and timestamps ---
const thread = a.threadId;
check(a.thread.title === "When is the pricing page launch?" && a.messages.length === 2, "the chat is titled from the first question");
a = await ask(A, "and who drafts the email?", "my", thread);
check(a.threadId === thread && a.messages.length === 4, "a follow-up continues the same saved conversation");
const reopened = await loadThread(db, A.id, thread);
check(reopened!.messages.map((m) => m.role).join() === "user,assistant,user,assistant" && reopened!.messages.every((m, i) => m.seq > (reopened!.messages[i - 1]?.seq ?? 0)), "reopened later: messages come back in order");
check(reopened!.messages[1]!.citations.length > 0 && reopened!.messages[1]!.citations.every((c) => c.startMs >= 0 && c.title) && reopened!.messages[1]!.content === a.messages[1].content, "reopened later: same answer, citations with titles and timestamps intact");
const t2 = await ask(A, "What does the support backlog look like?");
const list = await listThreads(db, A.id);
check(list.length >= 2 && list[0]!.id === t2.threadId && list.map((x) => x.id).includes(thread), "chat list: most recently active first, each chat kept separately");
check(list.find((x) => x.id === thread)!.title === "When is the pricing page launch?", "chat list shows each chat's title");
check((await listThreads(db, B.id)).length === 0, "another user sees none of these chats");
check((await ask(B, "anything", "my", thread) as any).error && await loadThread(db, B.id, thread) === null, "someone else's conversation can't be continued or read");

// --- context: what the model gets on a follow-up ---
const seen: any[] = []; const spy = Object.assign(new FakeLlm(), { answer: async (x: any) => { seen.push(x); return new FakeLlm().answer(x); } });
await ask(A, "And what about the coupon feature?", "my", thread, spy);
check(seen[0].history.length === 4 && seen[0].history[0].content === "When is the pricing page launch?" && seen[0].history[1].role === "assistant", "follow-ups send the earlier turns (questions AND answers) to the model");
const bigThread = (await ask(A, "pricing launch date question 0")).threadId; for (let i = 1; i < 8; i++) await ask(A, `pricing launch date question ${i}`, "my", bigThread);
seen.length = 0; await ask(A, "pricing launch final", "my", bigThread, spy);
check(seen[0].history.length === 10, `long chats send a rolling window of the last 10 messages (got ${seen[0].history.length})`);

// --- editing a message ---
let th = (await loadThread(db, A.id, thread))!;
const second = th.messages[2]!;   // my 2nd question
const edited: any = await editMessage(db, llm, A.id, { threadId: thread, messageId: second.id, question: "What is the support backlog like?", scope: "my" });
th = (await loadThread(db, A.id, thread))!;
check(!edited.error && th.messages.length === 4 && th.messages[2]!.content === "What is the support backlog like?" && th.messages[3]!.role === "assistant", "editing a question replaces it and its answer");
check(th.messages[0]!.content === "When is the pricing page launch?" && th.messages[1]!.citations.length > 0, "messages before the edit are untouched");
check(th.messages[3]!.citations.some((c) => c.meetingId === M2.id), "the new answer follows the new wording (now cites the support meeting)");
const first = th.messages[0]!;
await ask(A, "and one more thing?", "my", thread);
const before = (await loadThread(db, A.id, thread))!.messages.length;
seen.length = 0; await editMessage(db, spy, A.id, { threadId: thread, messageId: first.id, question: "When does the pricing launch happen?", scope: "my" });
th = (await loadThread(db, A.id, thread))!;
check(before === 6 && th.messages.length === 2 && th.messages[0]!.content === "When does the pricing launch happen?", "editing the FIRST question drops everything after it (a fresh start from that point)");
check(seen[0].history.length === 0, "an edit's answer is worked out from the conversation BEFORE the edited message only");
check(th.thread.title === "When does the pricing launch happen?", "editing the first question retitles the chat");
check((await editMessage(db, llm, A.id, { threadId: thread, messageId: th.messages[1]!.id, question: "hack", scope: "my" }) as any).error, "an assistant answer can't be edited");
check((await editMessage(db, llm, B.id, { threadId: thread, messageId: first.id, question: "hack", scope: "my" }) as any).error, "someone else can't edit your chat");
check((await editMessage(db, llm, A.id, { threadId: thread, messageId: th.messages[0]!.id, question: " ", scope: "my" }) as any).error, "an empty edit is rejected");
const failing = Object.assign(new FakeLlm(), { answer: async () => { throw new Error("model overloaded"); } });
const keep = (await loadThread(db, A.id, thread))!.messages.map((m) => m.content);
check((await editMessage(db, failing, A.id, { threadId: thread, messageId: th.messages[0]!.id, question: "something new about pricing launch", scope: "my" }) as any).error === "model overloaded"
  && JSON.stringify((await loadThread(db, A.id, thread))!.messages.map((m) => m.content)) === JSON.stringify(keep), "if the model fails during an edit, the ORIGINAL chat is kept");

// --- new chat, delete, failure, scopes ---
check((await ask(A, "When is the pricing page launch?")).threadId !== thread, "a new chat starts a separate conversation with no memory of the others");
const delId = t2.threadId; check(await deleteThread(db, A.id, delId) && await loadThread(db, A.id, delId) === null && !(await listThreads(db, A.id)).some((x) => x.id === delId), "a chat can be deleted");
check(!(await deleteThread(db, B.id, thread)) && await loadThread(db, A.id, thread) !== null, "someone else can't delete your chat");
const countBefore = (await listThreads(db, A.id, 500)).length;
check((await ask(A, "When is the launch?", "my", null, failing) as any).error === "model overloaded" && (await listThreads(db, A.id, 500)).length === countBefore, "a failed first question leaves no empty chat behind");
a = await ask(A, "What does the calendar integration involve?", "team");
check(a.citations?.length > 0 && a.citations.every((c: any) => c.meetingId === M3.id), "Ask in Team calls cites only the teammate's shared meeting");
let answered = 0; const spy2 = Object.assign(new FakeLlm(), { answer: async (x: any) => { answered++; return new FakeLlm().answer(x); } });
a = await ask(A, "zzzzqqqq flibbertigibbet", "all", null, spy2);
check(answered === 0 && /couldn't find/i.test(a.answer) && a.citations.length === 0, "nothing relevant -> says so without calling the model");
check((await ask(A, " ") as any).error, "empty question rejected");
a = await ask(A, "support tickets hire", "my", null, Object.assign(new FakeLlm(), { embed: async () => { throw new Error("down"); } }));
check(a.degraded === true && a.citations?.length > 0, "Ask still works on keyword matches when embeddings are down");

// cleanup
for (const x of made) await db.delete(meetings).where(eq(meetings.id, x.meetingId));
for (const u of [A, B, C]) { await db.delete(askThreads).where(eq(askThreads.userId, u.id)); }
await db.execute(sql`delete from workspaces where name like ${"%-" + stamp + "-test.io"}`);
await db.delete(users).where(inArray(users.id, [A.id, B.id, C.id]));

console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
