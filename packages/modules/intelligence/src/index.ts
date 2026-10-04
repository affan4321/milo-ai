import { and, asc, eq } from "drizzle-orm";
import { PermanentError } from "@milo/core";
import { actionItems, chapters, meetings, preferences, recordings, speakers, summaries, templates, transcriptSegments, runStage, type Db } from "@milo/db";
import type { LlmProvider, SummaryOut } from "@milo/providers";
import { DEFAULT_TEMPLATE, builtIn } from "./templates";

export * from "./templates";

/** "[t=754] Priya: text" per segment. t is whole seconds; the model cites these and we convert back to ms. */
export async function transcriptForLlm(db: Db, meetingId: string): Promise<string> {
  const rows = await db.select({ t: transcriptSegments.startMs, text: transcriptSegments.text, label: speakers.label, name: speakers.displayName })
    .from(transcriptSegments).leftJoin(speakers, eq(speakers.id, transcriptSegments.speakerId))
    .where(eq(transcriptSegments.meetingId, meetingId)).orderBy(asc(transcriptSegments.startMs));
  return rows.map((r) => `[t=${Math.floor(r.t / 1000)}] ${r.name ?? r.label ?? "Unknown"}: ${r.text}`).join("\n");
}

async function templatePrompt(db: Db, key: string, ownerId: string | null): Promise<string> {
  const b = builtIn(key);
  if (b) return b.prompt;
  const [t] = await db.select().from(templates).where(eq(templates.key, key));
  if (!t || (t.ownerId && t.ownerId !== ownerId)) throw new PermanentError("That summary template no longer exists.");
  return t.prompt;
}

/** intelligence stage: summary (owner's default template) + action items + chapters in a single LLM call. Idempotent. */
export async function generateInsights(db: Db, llm: LlmProvider, recordingId: string) {
  return runStage(db, recordingId, "intelligence", async () => {
    const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId));
    if (!rec?.durationMs) throw new Error("recording is not ready");
    const [m] = await db.select().from(meetings).where(eq(meetings.id, rec.meetingId));
    const [prefs] = m?.ownerId ? await db.select().from(preferences).where(eq(preferences.userId, m.ownerId)) : [];
    const key = prefs?.defaultTemplate ?? DEFAULT_TEMPLATE;

    const transcript = await transcriptForLlm(db, rec.meetingId);
    if (!transcript) throw new PermanentError("There is no transcript to summarize.");
    const out = await llm.insights({ transcript, templatePrompt: await templatePrompt(db, key, m?.ownerId ?? null), durationMs: rec.durationMs });

    const meetingId = rec.meetingId;
    await db.transaction(async (tx) => {
      await tx.insert(summaries).values({ meetingId, templateKey: key, content: shape(out.summary) })
        .onConflictDoUpdate({ target: [summaries.meetingId, summaries.templateKey], set: { content: shape(out.summary), createdAt: new Date() } });
      // Keep ticked-off state across a re-run: match previous items by text.
      const prev = await tx.select().from(actionItems).where(eq(actionItems.meetingId, meetingId));
      const done = new Set(prev.filter((p) => p.done).map((p) => p.text));
      await tx.delete(actionItems).where(eq(actionItems.meetingId, meetingId));
      if (out.actionItems.length) await tx.insert(actionItems).values(out.actionItems.map((a) => ({ meetingId, text: a.text, assignee: a.assignee ?? null, sourceMs: a.sourceMs ?? null, done: done.has(a.text) })));
      await tx.delete(chapters).where(eq(chapters.meetingId, meetingId));
      if (out.chapters.length) await tx.insert(chapters).values(out.chapters.map((c) => ({ meetingId, title: c.title, startMs: c.startMs })));
    });
    return { meetingId, actionItems: out.actionItems.length, chapters: out.chapters.length };
  });
}

const shape = (s: SummaryOut) => ({ sections: s.sections.map((x) => ({ heading: x.heading, bullets: x.bullets.map((b) => ({ text: b.text, ...(b.ms !== undefined ? { ms: b.ms } : {}) })) })) });

/** On-demand summary for another template. Cached per (meeting, template); `force` regenerates. */
export async function getOrCreateSummary(db: Db, llm: LlmProvider, meetingId: string, templateKey: string, ownerId: string, force = false) {
  if (!force) {
    const [cached] = await db.select().from(summaries).where(and(eq(summaries.meetingId, meetingId), eq(summaries.templateKey, templateKey)));
    if (cached) return cached.content;
  }
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, meetingId));
  if (!rec?.durationMs) throw new Error("This recording is not ready yet.");
  const transcript = await transcriptForLlm(db, meetingId);
  if (!transcript) throw new Error("There is no transcript to summarize.");
  const content = shape(await llm.summarize({ transcript, templatePrompt: await templatePrompt(db, templateKey, ownerId), durationMs: rec.durationMs }));
  await db.insert(summaries).values({ meetingId, templateKey, content })
    .onConflictDoUpdate({ target: [summaries.meetingId, summaries.templateKey], set: { content, createdAt: new Date() } });
  return content;
}

export async function createCustomTemplate(db: Db, ownerId: string, name: string, prompt: string) {
  const n = name.trim().slice(0, 60), p = prompt.trim().slice(0, 2000);
  if (!n || p.length < 10) throw new Error("Give the template a name and at least a sentence of instructions.");
  const key = `custom-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(templates).values({ key, name: n, prompt: p, builtIn: false, ownerId });
  return { key, name: n };
}
