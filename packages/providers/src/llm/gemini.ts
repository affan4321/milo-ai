import { PermanentError } from "@milo/core";
import type { InsightsOut, LlmInput, LlmProvider, SummaryOut } from "../types";
import { normalizeInsights, normalizeSummary } from "./normalize";
import { geminiJsonFallback } from "./client";

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

const SYSTEM = `You write meeting notes for Milo. Use ONLY the transcript provided; never invent facts, names, numbers or commitments.
Transcript lines look like "[t=754] Speaker: text", where t is the time in seconds.
Every bullet, action item and chapter must carry "t": the t of the transcript line that best supports it.
Action items are concrete commitments or tasks; set "assignee" to the speaker's name only when it is clear who owns it.
Chapters are the major topic changes, in time order, starting near t=0. Write in the language of the transcript.`;

export interface GeminiOptions { apiKey: string; model?: string; fallbackModels?: string[]; fetch?: typeof fetch }

export class GeminiLlm implements LlmProvider {
  private model: string;
  private f: typeof fetch;
  constructor(private o: GeminiOptions) { this.model = o.model ?? "gemini-2.5-flash"; this.f = o.fetch ?? fetch; }

  private async generate(schema: object, userText: string): Promise<unknown> {
    const models = [this.model, ...(this.o.fallbackModels ?? [])];
    const r = await geminiJsonFallback({ apiKey: this.o.apiKey, fetch: this.f }, models, { system: SYSTEM, parts: [{ text: userText }], schema },
      (from, to) => console.warn(`[gemini] daily limit reached for ${from}; falling back to ${to}`));
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
  async embed(): Promise<number[][]> { throw new PermanentError("Embeddings are not implemented yet."); }
  async answer(): Promise<{ text: string; citedIds: string[] }> { throw new PermanentError("Ask is not implemented yet."); }
}
