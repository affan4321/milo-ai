import { DailyQuotaError, PermanentError } from "@milo/core";
import type { AnswerInput, EmbedTask, InsightsOut, LlmInput, LlmProvider, SummaryOut } from "../types";
import { ANSWER_SYSTEM, SYSTEM } from "./gemini";
import { extractJson, normalizeInsights, normalizeSummary } from "./normalize";

export interface OpenAiCompatOptions { apiKey: string; baseUrl: string; model: string; fetch?: typeof fetch; label?: string; /** Refuse (permanently) anything bigger than this, estimated in tokens, instead of sending a request the provider will reject. */ maxInputTokens?: number }

const BULLET = { type: "object", additionalProperties: false, required: ["text", "t"], properties: { text: { type: "string" }, t: { type: "integer" } } };
const SUMMARY = { type: "object", additionalProperties: false, required: ["sections"], properties: { sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["heading", "bullets"], properties: { heading: { type: "string" }, bullets: { type: "array", items: BULLET } } } } } };
const INSIGHTS = {
  type: "object", additionalProperties: false, required: ["summary", "actionItems", "chapters"],
  properties: {
    summary: SUMMARY,
    actionItems: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "assignee", "t"], properties: { text: { type: "string" }, assignee: { type: "string" }, t: { type: "integer" } } } },
    chapters: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "t"], properties: { title: { type: "string" }, t: { type: "integer" } } } },
  },
};
const ANSWER = { type: "object", additionalProperties: false, required: ["answer", "cited"], properties: { answer: { type: "string" }, cited: { type: "array", items: { type: "string" } } } };

/**
 * An OpenAI-compatible chat provider (Groq, xAI, OpenAI, ...). Used as a FALLBACK when the primary provider's daily allowance is
 * spent. Limits to know about on a free tier: a small tokens-per-minute cap rejects a request bigger than it outright (413), so
 * long transcripts must be split by the caller; this adapter reports that as a permanent, clearly-worded error.
 * Embeddings are not offered here.
 */
export class OpenAiCompatLlm implements LlmProvider {
  constructor(private o: OpenAiCompatOptions) {}
  get label() { return this.o.label ?? this.o.model; }

  private async chat(system: string, user: string, name: string, schema: object, maxTokens = 4096): Promise<unknown> {
    if (!this.o.apiKey) throw new PermanentError(`${this.label}: API key is not set.`);
    const est = Math.ceil((system.length + user.length) / 3.5);
    if (this.o.maxInputTokens && est > this.o.maxInputTokens) throw new PermanentError(`${this.label} can only take about ${this.o.maxInputTokens} tokens at a time on its free limits; this needs about ${est}.`);
    const res = await (this.o.fetch ?? fetch)(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.o.model, temperature: 0.2, max_completion_tokens: maxTokens,
        // Reasoning models spend output tokens thinking, and a thinking model that runs out of budget returns nothing. Keep it minimal.
        reasoning_effort: /qwen/i.test(this.o.model) ? "none" : "low",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const msg: string = body?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 413 || /request too large/i.test(msg)) throw new PermanentError(`${this.label}: this request is larger than the provider's per-minute token limit. ${msg.slice(0, 160)}`);
      if (res.status === 429) {
        if (/per day|\(RPD\)|\(TPD\)/i.test(msg)) throw new DailyQuotaError(`${this.label}'s daily limit is used up.`, this.o.model, Number(res.headers.get("retry-after")) || undefined);
        throw new Error(`${this.label} rate limit reached; retrying. ${msg.slice(0, 120)}`);
      }
      if (res.status >= 500) throw new Error(`${this.label} is temporarily unavailable (${res.status}).`);
      if (res.status === 401 || res.status === 403) throw new PermanentError(`${this.label} rejected the API key.`);
      const fg = typeof body?.error?.failed_generation === "string" ? ` Output was: ${body.error.failed_generation.slice(0, 300)}` : "";
      // The model produced JSON that broke the schema: nondeterministic, so worth a retry rather than a permanent failure.
      if (/does not match the expected schema/i.test(msg)) throw new Error(`${this.label} produced invalid JSON; retrying.${fg}`);
      throw new PermanentError(`${this.label} request failed: ${msg.slice(0, 200)}${fg}`);
    }
    const body: any = await res.json();
    const choice = body?.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) throw new Error(`${this.label} returned no content (${choice?.finish_reason ?? "unknown"}).`);
    if (choice?.finish_reason === "length") throw new Error(`${this.label} output was cut off; retrying.`);
    return extractJson(text);
  }

  private prompt(i: LlmInput, what: string) { return `${what}\n\nTemplate instructions:\n${i.templatePrompt}\n\nRecording length: ${Math.round(i.durationMs / 1000)} seconds.\n\nTRANSCRIPT:\n${i.transcript}`; }

  async insights(i: LlmInput): Promise<InsightsOut> {
    const raw: any = await this.chat(SYSTEM, this.prompt(i, "Produce the summary, action items and chapters. Use an empty string for an assignee that isn't clear."), "insights", INSIGHTS, 2500);
    for (const a of raw?.actionItems ?? []) if (a && a.assignee === "") delete a.assignee;
    return normalizeInsights(raw, i.durationMs);
  }
  async summarize(i: LlmInput): Promise<SummaryOut> { return normalizeSummary(await this.chat(SYSTEM, this.prompt(i, "Produce the summary only."), "summary", SUMMARY, 2000), i.durationMs); }

  async answer(a: AnswerInput): Promise<{ text: string; citedIds: string[] }> {
    const ids = new Set(a.context.map((c) => c.id));
    const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
    const excerpts = a.context.map((c) => `[${c.id}] ${c.meeting}${c.speaker ? ` · ${c.speaker}` : ""} · at ${fmt(c.ms)}\n${c.text}`).join("\n\n");
    const history = (a.history ?? []).slice(-6).map((h) => `${h.role === "user" ? "User" : "Milo"}: ${h.content}`).join("\n");
    const raw: any = await this.chat(ANSWER_SYSTEM, `${history ? `Conversation so far:\n${history}\n\n` : ""}Question: ${a.question}\n\nEXCERPTS:\n${excerpts}`, "answer", ANSWER, 2048);
    const text = typeof raw?.answer === "string" ? raw.answer.trim() : "";
    if (!text) throw new Error("model returned an empty answer");
    const cited = [...new Set((Array.isArray(raw?.cited) ? raw.cited : []).map(String).filter((id: string) => ids.has(id)))] as string[];
    return { text: text.replace(/\[(\d+)\]/g, (m: string, n: string) => (ids.has(n) ? m : "")).replace(/\s{2,}/g, " ").trim(), citedIds: cited };
  }

  async embed(_texts: string[], _task?: EmbedTask): Promise<number[][]> { throw new PermanentError(`${this.label} doesn't provide embeddings.`); }
}
