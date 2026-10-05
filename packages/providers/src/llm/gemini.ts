import { PermanentError } from "@milo/core";
import type { AnswerInput, EmbedTask, InsightsOut, LlmInput, LlmProvider, SummaryOut } from "../types";
import { normalizeInsights, normalizeSummary } from "./normalize";
import { geminiJsonFallback } from "./client";
import { geminiJson } from "./client";
import { geminiEmbed } from "./embed";

const BULLET = { type: "OBJECT", properties: { text: { type: "STRING" }, t: { type: "INTEGER" } }, required: ["text", "t"] };
const SUMMARY = {
  type: "OBJECT", required: ["sections"],
  properties: { sections: { type: "ARRAY", items: { type: "OBJECT", required: ["heading", "bullets"], properties: { heading: { type: "STRING" }, bullets: { type: "ARRAY", items: BULLET } } } } },
};
const INSIGHTS = {
  type: "OBJECT", required: ["summary", "actionItems", "chapters"],
  properties: {
    summary: SUMMARY,
    actionItems: { type: "ARRAY", items: { type: "OBJECT", required: ["text", "t"], properties: { text: { type: "STRING" }, assignee: { type: "STRING" }, t: { type: "INTEGER" } } } },
    chapters: { type: "ARRAY", items: { type: "OBJECT", required: ["title", "t"], properties: { title: { type: "STRING" }, t: { type: "INTEGER" } } } },
  },
};

export const ANSWER_SYSTEM = `You are Milo, answering questions about the user's meetings. Use ONLY the numbered excerpts you are given.
- Cite the excerpts you rely on with their numbers in square brackets, like [2] or [1][4], right after the claim they support.
- If the excerpts don't contain the answer, say you couldn't find it in these meetings. Never guess or add outside knowledge.
- Be concise. Name people and say which meeting something came from when it helps.
- "cited" must list the excerpt numbers you used.`;
const ANSWER_SCHEMA = { type: "OBJECT", required: ["answer", "cited"], properties: { answer: { type: "STRING" }, cited: { type: "ARRAY", items: { type: "STRING" } } } };

export const SYSTEM = `You write meeting notes for Milo. Use ONLY the transcript provided; never invent facts, names, numbers or commitments.
Transcript lines look like "[t=754] Speaker: text", where t is the time in seconds.
Every bullet, action item and chapter must carry "t": the t of the transcript line that best supports it.
Action items are concrete commitments or tasks; set "assignee" to the speaker's name only when it is clear who owns it.
Chapters are the major topic changes, in time order, starting near t=0. Write in the language of the transcript.`;

export interface GeminiOptions { apiKey: string; model?: string; fallbackModels?: string[]; embedModels?: string[]; fetch?: typeof fetch }

export class GeminiLlm implements LlmProvider {
  readonly embedModel: string; readonly embedMetered = true;
  private model: string;
  private f: typeof fetch;
  constructor(private o: GeminiOptions) { this.model = o.model ?? "gemini-2.5-flash"; this.embedModel = o.embedModels?.[0] ?? "gemini-embedding-001"; this.f = o.fetch ?? fetch; }

  private async generate(schema: object, userText: string): Promise<unknown> {
    const models = [this.model, ...(this.o.fallbackModels ?? [])];
    const r = await geminiJsonFallback({ apiKey: this.o.apiKey, fetch: this.f }, models, { system: SYSTEM, parts: [{ text: userText }], schema },
      (from, to, why) => console.warn(`[gemini] ${from} ${why === "quota" ? "daily limit reached" : "is overloaded"}; falling back to ${to}`));
    return r.data;
  }

  private prompt(i: LlmInput, what: string) {
    return `${what}\n\nTemplate instructions:\n${i.templatePrompt}\n\nRecording length: ${Math.round(i.durationMs / 1000)} seconds.\n\nTRANSCRIPT:\n${i.transcript}`;
  }
  async insights(i: LlmInput): Promise<InsightsOut> {
    return normalizeInsights(await this.generate(INSIGHTS, this.prompt(i, "Produce the summary, action items and chapters.")), i.durationMs);
  }
  async summarize(i: LlmInput): Promise<SummaryOut> {
    return normalizeSummary((await this.generate(SUMMARY, this.prompt(i, "Produce the summary only."))), i.durationMs);
  }
  embed(texts: string[], task: EmbedTask = "document"): Promise<number[][]> {
    return geminiEmbed({ apiKey: this.o.apiKey, fetch: this.f }, this.o.embedModels?.length ? this.o.embedModels : ["gemini-embedding-001"], texts, task);
  }

  async answer(a: AnswerInput): Promise<{ text: string; citedIds: string[] }> {
    const ids = new Set(a.context.map((c) => c.id));
    const excerpts = a.context.map((c) => `[${c.id}] ${c.meeting}${c.speaker ? ` · ${c.speaker}` : ""} · at ${Math.floor(c.ms / 60000)}:${String(Math.floor(c.ms / 1000) % 60).padStart(2, "0")}\n${c.text}`).join("\n\n");
    const history = (a.history ?? []).slice(-6).map((h) => `${h.role === "user" ? "User" : "Milo"}: ${h.content}`).join("\n");
    const raw: any = await geminiJson({ apiKey: this.o.apiKey, model: this.model, fetch: this.f }, {
      system: ANSWER_SYSTEM, schema: ANSWER_SCHEMA, temperature: 0.1,
      parts: [{ text: `${history ? `Conversation so far:\n${history}\n\n` : ""}Question: ${a.question}\n\nEXCERPTS:\n${excerpts}` }],
    });
    const text = typeof raw?.answer === "string" ? raw.answer.trim() : "";
    if (!text) throw new Error("model returned an empty answer");
    // Only ids we actually supplied count as citations; invented ones are dropped from both the list and the text.
    const cited = [...new Set((Array.isArray(raw?.cited) ? raw.cited : []).map(String).filter((id: string) => ids.has(id)))] as string[];
    const clean = text.replace(/\[(\d+)\]/g, (m: string, n: string) => (ids.has(n) ? m : "")).replace(/\s{2,}/g, " ").trim();
    return { text: clean, citedIds: cited };
  }
}
