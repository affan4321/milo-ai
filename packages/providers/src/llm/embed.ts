import { PermanentError, DailyQuotaError } from "@milo/core";
import type { EmbedTask } from "../types";
import { geminiCall, type GeminiClientOptions } from "./client";

export const EMBED_DIMS = 768;
const BATCH = 100; // the API's per-request limit

/** Scale to unit length so cosine similarity is a plain dot product and every vector is comparable. */
export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}

/** Embed texts in batches of 100. Order is preserved. Tries each model in turn when one's daily quota is spent. */
export async function geminiEmbed(o: GeminiClientOptions, models: string[], texts: string[], task: EmbedTask): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    let last: DailyQuotaError | undefined, done = false;
    for (const model of models) {
      try {
        const body = await geminiCall({ ...o, model }, "batchEmbedContents", {
          requests: chunk.map((text) => ({ model: `models/${model}`, content: { parts: [{ text: text.slice(0, 6000) }] }, taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: EMBED_DIMS })),
        });
        const vecs: number[][] | undefined = body?.embeddings?.map((e: any) => e.values);
        if (!vecs || vecs.length !== chunk.length || vecs.some((v) => !Array.isArray(v) || v.length !== EMBED_DIMS)) throw new Error("Gemini returned an unexpected embedding response; retrying.");
        out.push(...vecs.map(normalize)); done = true; break;
      } catch (e) { if (!(e instanceof DailyQuotaError)) throw e; last = e; }
    }
    if (!done) throw last ?? new PermanentError("No embedding model configured.");
  }
  return out;
}
