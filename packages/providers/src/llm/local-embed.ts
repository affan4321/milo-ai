import fs from "node:fs";
import path from "node:path";
import type { EmbedTask, LlmProvider } from "../types";
import { EMBED_DIMS, normalize } from "./embed";

const MODEL = "Xenova/multilingual-e5-small";   // 384-d, 100+ languages, ~120 MB quantized
const BATCH = 16;

function repoRoot(): string {
  let dir = process.cwd();
  for (;;) { if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir; const up = path.dirname(dir); if (up === dir) return process.cwd(); dir = up; }
}

/**
 * Embeddings computed on this machine: no account, no daily quota, and transcripts never leave it. The model (about 120 MB) is
 * downloaded once into MODEL_CACHE_DIR (default .data/models) the first time it is used.
 *
 * The model produces 384 numbers per text. Our vector column holds 768, so each vector is padded with zeros: that leaves every
 * cosine similarity exactly unchanged. E5 models expect "query: " / "passage: " prefixes, which is what `task` selects.
 */
export class LocalEmbeddings {
  readonly embedModel = "local-multilingual-e5-small";
  readonly embedMetered = false;
  private pipe?: Promise<(texts: string[], o: object) => Promise<{ tolist(): number[][] }>>;

  private load() {
    this.pipe ??= (async () => {
      // Imported lazily: the native runtime is heavy and only the processes that actually embed should load it.
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = process.env.MODEL_CACHE_DIR ?? path.join(repoRoot(), ".data", "models");
      return (await pipeline("feature-extraction", MODEL, { dtype: "q8" })) as unknown as (texts: string[], o: object) => Promise<{ tolist(): number[][] }>;
    })().catch((e) => { this.pipe = undefined; throw e; }); // a failed first load (e.g. offline) can be retried
    return this.pipe;
  }

  async embed(texts: string[], task: EmbedTask = "document"): Promise<number[][]> {
    if (!texts.length) return [];
    const run = await this.load();
    const prefix = task === "query" ? "query: " : "passage: ";
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const t = await run(texts.slice(i, i + BATCH).map((x) => prefix + x.slice(0, 2000)), { pooling: "mean", normalize: true });
      for (const v of t.tolist()) out.push(normalize([...v, ...new Array(Math.max(0, EMBED_DIMS - v.length)).fill(0)]));
    }
    return out;
  }
}

/** An LLM provider whose embeddings come from somewhere else (e.g. the local model) instead of from the LLM vendor. */
export class WithEmbedder implements LlmProvider {
  constructor(private llm: LlmProvider, private emb: { embed: LlmProvider["embed"]; embedModel: string; embedMetered: boolean }) {}
  get embedModel() { return this.emb.embedModel; }
  get embedMetered() { return this.emb.embedMetered; }
  insights: LlmProvider["insights"] = (a) => this.llm.insights(a);
  summarize: LlmProvider["summarize"] = (a) => this.llm.summarize(a);
  answer: LlmProvider["answer"] = (a) => this.llm.answer(a);
  embed: LlmProvider["embed"] = (t, k) => this.emb.embed(t, k);
}
