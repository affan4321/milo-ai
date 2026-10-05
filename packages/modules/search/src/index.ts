import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { askMessages, askThreads, speakers, transcriptSegments, type Db } from "@milo/db";
import type { LlmProvider } from "@milo/providers";

export type Scope = "my" | "team" | "all";
export const SCOPES: { value: Scope; label: string }[] = [{ value: "my", label: "My calls" }, { value: "team", label: "Team calls" }, { value: "all", label: "All calls" }];
export const parseScope = (v: unknown): Scope => (v === "team" || v === "all" ? v : "my");

/** Highlight markers in snippets (rare characters, so transcript text can't collide with them). */
export const MARK_START = "«", MARK_END = "»";

/**
 * Which meetings the user may see for a scope. This one condition guards both search and Ask, so a teammate's private meeting can
 * never leak into either:  my = my own; team = teammates' meetings explicitly shared with the team, in a workspace I belong to;
 * all = both. Only meetings whose transcript is ready are searchable.
 */
function visible(userId: string, scope: Scope): SQL {
  const mine = sql`m.owner_id = ${userId}`;
  const team = sql`(m.visibility = 'team' AND m.owner_id <> ${userId} AND m.workspace_id IN (SELECT workspace_id FROM memberships WHERE user_id = ${userId}))`;
  const who = scope === "my" ? mine : scope === "team" ? team : sql`(${mine} OR ${team})`;
  return sql`(m.status = 'ready' AND ${who})`;
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;

export interface Hit { segmentId: string; meetingId: string; title: string; createdAt: Date; mine: boolean; startMs: number; speaker: string; text: string; snippet: string; via: "keyword" | "meaning" | "both"; score: number }
interface Row { id: string; meeting_id: string; title: string; created_at: Date; owner_id: string; start_ms: number; text: string; speaker: string | null; snippet?: string; sim?: number }

const SEG_COLS = sql`s.id, s.meeting_id, s.start_ms, s.text, coalesce(sp.display_name, sp.label) AS speaker, m.title, m.created_at, m.owner_id`;
const SEG_FROM = sql`FROM transcript_segments s JOIN meetings m ON m.id = s.meeting_id LEFT JOIN speakers sp ON sp.id = s.speaker_id`;

async function keywordRows(db: Db, userId: string, scope: Scope, q: string, n: number): Promise<Row[]> {
  const r = await db.execute(sql`
    SELECT ${SEG_COLS}, ts_headline('english', s.text, query, ${`StartSel=${MARK_START},StopSel=${MARK_END},MaxWords=28,MinWords=8,ShortWord=2`}) AS snippet
    ${SEG_FROM}, websearch_to_tsquery('english', ${q}) query
    WHERE s.tsv @@ query AND ${visible(userId, scope)}
    ORDER BY ts_rank_cd(s.tsv, query) DESC, s.start_ms LIMIT ${n}`);
  return r as unknown as Row[];
}
async function vectorRows(db: Db, userId: string, scope: Scope, vec: number[], n: number): Promise<Row[]> {
  const lit = vectorLiteral(vec);
  const r = await db.execute(sql`
    SELECT ${SEG_COLS}, 1 - (s.embedding <=> ${lit}::vector) AS sim
    ${SEG_FROM}
    WHERE s.embedding IS NOT NULL AND ${visible(userId, scope)}
    ORDER BY s.embedding <=> ${lit}::vector LIMIT ${n}`);
  return r as unknown as Row[];
}

/** Meaning-matches below the best hit by more than this, or under the floor, are noise. */
const SIM_WINDOW = 0.08, SIM_FLOOR = 0.35, RRF_K = 60, POOL = 40;

/**
 * Keyword + semantic retrieval fused by reciprocal rank. If the question can't be embedded (provider down, quota spent, nothing
 * indexed yet) the keyword half still answers and `degraded` says so, instead of failing the whole search.
 */
export async function hybridHits(db: Db, llm: LlmProvider, userId: string, scope: Scope, q: string, limit = POOL): Promise<{ hits: Hit[]; degraded: boolean }> {
  const query = q.trim().slice(0, 500);
  if (!query) return { hits: [], degraded: false };
  const kw = await keywordRows(db, userId, scope, query, POOL);
  let vec: Row[] = [], degraded = false;
  try { vec = await vectorRows(db, userId, scope, (await llm.embed([query], "query"))[0]!, POOL); }
  catch { degraded = true; }
  const top = vec[0]?.sim ?? 0;
  vec = vec.filter((r) => (r.sim ?? 0) >= SIM_FLOOR && (r.sim ?? 0) >= top - SIM_WINDOW);

  const by = new Map<string, Hit>();
  const add = (r: Row, rank: number, via: "keyword" | "meaning") => {
    const prev = by.get(r.id);
    const base = { segmentId: r.id, meetingId: r.meeting_id, title: r.title, createdAt: new Date(r.created_at), mine: r.owner_id === userId, startMs: r.start_ms, speaker: r.speaker ?? "Speaker", text: r.text };
    const score = 1 / (RRF_K + rank);
    if (prev) { prev.score += score; prev.via = "both"; if (via === "keyword" && r.snippet) prev.snippet = r.snippet; }
    else by.set(r.id, { ...base, snippet: r.snippet ?? (r.text.length > 160 ? `${r.text.slice(0, 160)}…` : r.text), via, score });
  };
  kw.forEach((r, i) => add(r, i + 1, "keyword")); vec.forEach((r, i) => add(r, i + 1, "meaning"));
  return { hits: [...by.values()].sort((a, b) => b.score - a.score).slice(0, limit), degraded };
}

export interface MeetingResult { meetingId: string; title: string; createdAt: Date; mine: boolean; titleMatch: boolean; hits: Hit[]; score: number }

/** Cross-meeting search: segment hits grouped by meeting (best 3 each), plus meetings whose title or a speaker name matches. */
export async function searchMeetings(db: Db, llm: LlmProvider, userId: string, o: { q: string; scope: Scope; limit?: number }): Promise<{ results: MeetingResult[]; degraded: boolean }> {
  const { hits, degraded } = await hybridHits(db, llm, userId, o.scope, o.q);
  const groups = new Map<string, MeetingResult>();
  for (const h of hits) {
    const g = groups.get(h.meetingId) ?? { meetingId: h.meetingId, title: h.title, createdAt: h.createdAt, mine: h.mine, titleMatch: false, hits: [], score: 0 };
    if (g.hits.length < 3) g.hits.push(h);
    g.score = Math.max(g.score, h.score); groups.set(h.meetingId, g);
  }
  const like = `%${escapeLike(o.q.trim().slice(0, 100))}%`;
  if (o.q.trim().length >= 2) {
    const named = await db.execute(sql`
      SELECT DISTINCT m.id, m.title, m.created_at, m.owner_id FROM meetings m LEFT JOIN speakers sp ON sp.meeting_id = m.id
      WHERE ${visible(userId, o.scope)} AND (m.title ILIKE ${like} ESCAPE '\\' OR sp.display_name ILIKE ${like} ESCAPE '\\') LIMIT 20`) as unknown as { id: string; title: string; created_at: Date; owner_id: string }[];
    for (const m of named) {
      const g = groups.get(m.id) ?? { meetingId: m.id, title: m.title, createdAt: new Date(m.created_at), mine: m.owner_id === userId, titleMatch: false, hits: [], score: 0 };
      g.titleMatch = true; g.score += 1 / (RRF_K + 1); groups.set(m.id, g);
    }
  }
  return { results: [...groups.values()].sort((a, b) => b.score - a.score).slice(0, o.limit ?? 20), degraded };
}

// ---------------- Ask Milo ----------------

export interface Citation { n: number; segmentId: string; meetingId: string; title: string; startMs: number; speaker: string; snippet: string }
export interface ThreadMessage { id: string; seq: number; role: "user" | "assistant"; content: string; citations: Citation[] }
export interface ThreadSummary { id: string; title: string; scope: Scope; updatedAt: Date }
export type AskResult = { threadId: string; degraded: boolean } | { error: string };

/** Renumber [id] markers to [1], [2]… in order of first appearance, so citation numbers are stable and small whatever ids the model saw. */
export function renumberCitations(text: string, citedIds: string[]): { text: string; order: string[] } {
  const order: string[] = [];
  const out = text.replace(/\[(\d+)\]/g, (m, id: string) => {
    if (!citedIds.includes(id)) return "";
    let i = order.indexOf(id); if (i < 0) { order.push(id); i = order.length - 1; }
    return `[${i + 1}]`;
  }).replace(/\s{2,}/g, " ").trim();
  for (const id of citedIds) if (!order.includes(id)) order.push(id); // cited but not marked inline: still listed
  return { text: out, order };
}

/** `text` is the widened window the model reads; `own` is just the cited line, which is what a citation should show. */
interface Excerpt { id: string; text: string; own: string; ms: number; meeting: string; speaker: string; segmentId: string; meetingId: string }

/** Top hits, each widened with its neighbouring lines so the model sees enough to answer. Overlapping neighbours in one meeting are merged. */
async function excerptsFor(db: Db, hits: Hit[], max = 8): Promise<Excerpt[]> {
  const out: Excerpt[] = [], usedSegs = new Set<string>();
  for (const h of hits) {
    if (out.length >= max) break;
    if (usedSegs.has(h.segmentId)) continue;
    const near = await db.select({ id: transcriptSegments.id, startMs: transcriptSegments.startMs, text: transcriptSegments.text, label: speakers.label, name: speakers.displayName })
      .from(transcriptSegments).leftJoin(speakers, eq(speakers.id, transcriptSegments.speakerId))
      .where(and(eq(transcriptSegments.meetingId, h.meetingId), sql`${transcriptSegments.startMs} between ${h.startMs - 25_000} and ${h.startMs + 25_000}`)).orderBy(asc(transcriptSegments.startMs));
    const i = near.findIndex((s) => s.id === h.segmentId);
    const win = near.slice(Math.max(0, i - 1), i + 2);
    win.forEach((s) => usedSegs.add(s.id));
    out.push({ id: String(out.length + 1), meetingId: h.meetingId, segmentId: h.segmentId, meeting: h.title, speaker: h.speaker, ms: h.startMs, own: h.text,
      text: win.map((s) => `${s.name ?? s.label ?? "Speaker"}: ${s.text}`).join("\n").slice(0, 900) });
  }
  return out;
}

const HISTORY_MESSAGES = 10;
const titleOf = (q: string) => (q.length > 60 ? `${q.slice(0, 57).trimEnd()}…` : q);

/**
 * Work out an answer WITHOUT saving anything. `history` is the conversation so far (oldest first); the model sees its last
 * HISTORY_MESSAGES messages, and a short follow-up ("and by when?") also folds the previous question into retrieval, since
 * on its own it would search badly. Nothing found -> says so without calling the model.
 */
async function produceAnswer(db: Db, llm: LlmProvider, userId: string, o: { question: string; scope: Scope; history: { role: "user" | "assistant"; content: string }[] }): Promise<{ text: string; citations: Citation[]; degraded: boolean } | { error: string }> {
  const lastUser = [...o.history].reverse().find((m) => m.role === "user")?.content;
  const { hits, degraded } = await hybridHits(db, llm, userId, o.scope, lastUser && o.question.split(/\s+/).length < 6 ? `${lastUser} ${o.question}` : o.question, 12);
  const ex = await excerptsFor(db, hits);
  let answer: string, cited: string[] = [];
  if (!ex.length) answer = "I couldn't find that in your meetings.";
  else {
    try { const r = await llm.answer({ question: o.question, history: o.history.slice(-HISTORY_MESSAGES), context: ex.map(({ id, text, ms, meeting, speaker }) => ({ id, text, ms, meeting, speaker })) }); answer = r.text; cited = r.citedIds; }
    catch (e) { return { error: e instanceof Error ? e.message : "Milo couldn't answer right now." }; }
  }
  const { text, order } = renumberCitations(answer, cited);
  const citations: Citation[] = order.map((id, i) => { const e = ex.find((x) => x.id === id)!; return { n: i + 1, segmentId: e.segmentId, meetingId: e.meetingId, title: e.meeting, startMs: e.ms, speaker: e.speaker, snippet: e.own.length > 200 ? `${e.own.slice(0, 200)}…` : e.own }; });
  return { text, citations, degraded };
}

const cleanQuestion = (q: string) => q.trim().slice(0, 1000);
async function ownedThread(db: Db, userId: string, threadId: string) {
  const [t] = await db.select().from(askThreads).where(and(eq(askThreads.id, threadId), eq(askThreads.userId, userId)));
  return t ?? null;
}

/**
 * Ask a question, in a new conversation or an existing one. The conversation is saved (with citations) only once an answer
 * exists, so a failure leaves no half-written chat behind.
 */
export async function askMilo(db: Db, llm: LlmProvider, userId: string, o: { question: string; scope: Scope; threadId?: string | null }): Promise<AskResult> {
  const question = cleanQuestion(o.question);
  if (question.length < 2) return { error: "Ask a question first." };
  let thread = o.threadId ? await ownedThread(db, userId, o.threadId) : null;
  if (o.threadId && !thread) return { error: "That conversation wasn't found." };
  const prior = thread ? await db.select().from(askMessages).where(eq(askMessages.threadId, thread.id)).orderBy(asc(askMessages.seq)) : [];
  const r = await produceAnswer(db, llm, userId, { question, scope: o.scope, history: prior.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
  if ("error" in r) return r;
  if (!thread) thread = (await db.insert(askThreads).values({ userId, scope: o.scope, title: titleOf(question) }).returning())[0]!;
  await db.insert(askMessages).values({ threadId: thread.id, role: "user", content: question });
  await db.insert(askMessages).values({ threadId: thread.id, role: "assistant", content: r.text, citedSegmentIds: r.citations.map((c) => c.segmentId) });
  await db.update(askThreads).set({ updatedAt: new Date(), scope: o.scope, title: thread.title ?? titleOf(question) }).where(eq(askThreads.id, thread.id));
  return { threadId: thread.id, degraded: r.degraded };
}

/**
 * Edit one of YOUR messages: the conversation continues from that point with the new wording. Everything after it (including
 * the old answer) is replaced. The new answer is worked out first and swapped in atomically, so a failure keeps the original chat.
 */
export async function editMessage(db: Db, llm: LlmProvider, userId: string, o: { threadId: string; messageId: string; question: string; scope: Scope }): Promise<AskResult> {
  const question = cleanQuestion(o.question);
  if (question.length < 2) return { error: "Ask a question first." };
  const thread = await ownedThread(db, userId, o.threadId);
  if (!thread) return { error: "That conversation wasn't found." };
  const all = await db.select().from(askMessages).where(eq(askMessages.threadId, thread.id)).orderBy(asc(askMessages.seq));
  const target = all.find((m) => m.id === o.messageId);
  if (!target || target.role !== "user") return { error: "You can only edit your own questions." };
  const before = all.filter((m) => m.seq < target.seq);
  const r = await produceAnswer(db, llm, userId, { question, scope: o.scope, history: before.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
  if ("error" in r) return r;
  await db.transaction(async (tx) => {
    await tx.delete(askMessages).where(and(eq(askMessages.threadId, thread.id), gte(askMessages.seq, target.seq)));
    await tx.insert(askMessages).values({ threadId: thread.id, role: "user", content: question });
    await tx.insert(askMessages).values({ threadId: thread.id, role: "assistant", content: r.text, citedSegmentIds: r.citations.map((c) => c.segmentId) });
    await tx.update(askThreads).set({ updatedAt: new Date(), scope: o.scope, ...(before.length === 0 ? { title: titleOf(question) } : {}) }).where(eq(askThreads.id, thread.id));
  });
  return { threadId: thread.id, degraded: r.degraded };
}

export async function listThreads(db: Db, userId: string, limit = 50): Promise<ThreadSummary[]> {
  const rows = await db.select().from(askThreads).where(eq(askThreads.userId, userId)).orderBy(desc(askThreads.updatedAt)).limit(limit);
  const out: ThreadSummary[] = [];
  for (const t of rows) {
    const title = t.title ?? (await db.select().from(askMessages).where(and(eq(askMessages.threadId, t.id), eq(askMessages.role, "user"))).orderBy(asc(askMessages.seq)).limit(1))[0]?.content;
    out.push({ id: t.id, title: titleOf(title ?? "New chat"), scope: parseScope(t.scope), updatedAt: t.updatedAt });
  }
  return out;
}

export async function deleteThread(db: Db, userId: string, threadId: string): Promise<boolean> {
  return (await db.delete(askThreads).where(and(eq(askThreads.id, threadId), eq(askThreads.userId, userId))).returning()).length > 0;
}

/**
 * Reopen a saved conversation. Citations are re-resolved from the segments they point at, so the timestamps are always current;
 * a source that has since been deleted or made unavailable simply drops off that message.
 */
export async function loadThread(db: Db, userId: string, threadId: string): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] } | null> {
  const t = await ownedThread(db, userId, threadId);
  if (!t) return null;
  const msgs = await db.select().from(askMessages).where(eq(askMessages.threadId, threadId)).orderBy(asc(askMessages.seq));
  const messages: ThreadMessage[] = [];
  for (const m of msgs) {
    const citations: Citation[] = [];
    for (const [i, segId] of (m.citedSegmentIds ?? []).entries()) {
      const r = await db.execute(sql`SELECT ${SEG_COLS} ${SEG_FROM} WHERE s.id = ${segId} AND ${visible(userId, "all")}`) as unknown as Row[];
      if (r[0]) citations.push({ n: i + 1, segmentId: segId, meetingId: r[0].meeting_id, title: r[0].title, startMs: r[0].start_ms, speaker: r[0].speaker ?? "Speaker", snippet: r[0].text.length > 200 ? `${r[0].text.slice(0, 200)}…` : r[0].text });
    }
    messages.push({ id: m.id, seq: m.seq, role: m.role as "user" | "assistant", content: m.content, citations });
  }
  const title = t.title ?? messages.find((m) => m.role === "user")?.content ?? "New chat";
  return { thread: { id: t.id, title: titleOf(title), scope: parseScope(t.scope), updatedAt: t.updatedAt }, messages };
}
