import { PermanentError } from "@milo/core";
import type { InsightsOut, LlmInput, LlmProvider, SummaryOut } from "../types";
import { extractJson, normalizeInsights, normalizeSummary } from "./normalize";

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

export interface GeminiOptions { apiKey: string; model?: string; fetch?: typeof fetch }

export class GeminiLlm implements LlmProvider {
  private model: string;
  private f: typeof fetch;
  constructor(private o: GeminiOptions) { this.model = o.model ?? "gemini-2.5-flash"; this.f = o.fetch ?? fetch; }

  private async generate(schema: object, userText: string): Promise<unknown> {
    if (!this.o.apiKey) throw new PermanentError("GEMINI_API_KEY is not set on the server.");
    const res = await this.f(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.o.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      // 429 / 5xx are transient: throw a plain Error so the queue retries with backoff.
      if (res.status === 429) throw new Error(`Gemini rate limit reached (free tier). ${msg}`);
      if (res.status >= 500) throw new Error(`Gemini is temporarily unavailable (${res.status}).`);
      if (res.status === 400 && /API key|API_KEY/i.test(msg)) throw new PermanentError("Gemini rejected the API key. Check GEMINI_API_KEY.");
      if (res.status === 401 || res.status === 403) throw new PermanentError(`Gemini refused the request: ${msg}`);
      throw new PermanentError(`Gemini request failed: ${msg}`);
    }
    const body: any = await res.json();
    const cand = body?.candidates?.[0];
    if (body?.promptFeedback?.blockReason) throw new PermanentError(`Gemini blocked this transcript (${body.promptFeedback.blockReason}).`);
    const text = cand?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error(`Gemini returned no content (${cand?.finishReason ?? "unknown"}).`);
    return extractJson(text);
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
