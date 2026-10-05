import { PermanentError } from "@milo/core";
import type { EmbedTask } from "../types";
import { LocalEmbeddings } from "./local-embed";

/**
 * Embeddings computed by the worker machine over HTTPS (it serves POST /embed). Used by the web app on serverless hosting, which
 * can't run the local model (its native binaries exceed the function size limit). Same model, so stored vectors stay comparable.
 * If the worker is unreachable, search falls back to keyword-only results.
 */
export class RemoteEmbeddings {
  readonly embedModel = new LocalEmbeddings().embedModel;
  readonly embedMetered = false;
  constructor(private o: { url: string; token: string; fetch?: typeof fetch }) {}

  async embed(texts: string[], task: EmbedTask = "document"): Promise<number[][]> {
    if (!texts.length) return [];
    if (!this.o.url || !this.o.token) throw new PermanentError("EMBED_URL and EMBED_TOKEN must be set to use remote embeddings.");
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(`${this.o.url.replace(/\/$/, "")}/embed`, {
        method: "POST", // ngrok-skip-browser-warning: ngrok's free plan otherwise answers with an HTML warning page; harmless elsewhere.
        headers: { "content-type": "application/json", authorization: `Bearer ${this.o.token}`, "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ texts, task }), signal: AbortSignal.timeout(20_000),
      });
    } catch (e) { throw new Error(`The embedding service is unreachable (${e instanceof Error ? e.message : e}).`); }
    if (res.status === 401 || res.status === 403) throw new PermanentError("The embedding service rejected EMBED_TOKEN.");
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`The embedding service refused the request (HTTP ${res.status}).`);
    if (!res.ok) throw new Error(`The embedding service is unavailable (HTTP ${res.status}).`);
    const j = (await res.json()) as { vectors?: number[][] };
    if (!Array.isArray(j.vectors) || j.vectors.length !== texts.length) throw new Error("The embedding service returned an unexpected answer.");
    return j.vectors;
  }
}
