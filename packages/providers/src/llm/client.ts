import { DailyQuotaError, PermanentError } from "@milo/core";
import { extractJson } from "./normalize";

/**
 * Gemini answered 5xx (overloaded / unavailable). Transient, so the queue retries it; but it is ALSO the signal to hand over to the next
 * model (or a different provider) immediately instead of waiting on the same overloaded model.
 */
export class GeminiUnavailableError extends Error {
  constructor(message: string, readonly model?: string) { super(message); this.name = "GeminiUnavailableError"; }
}

export interface GeminiClientOptions { apiKey: string; model?: string; fetch?: typeof fetch; timeoutMs?: number }
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * One Gemini REST call returning the parsed response body. Error classes matter to the queue:
 * transient (429 / 5xx) throw plain Errors and get retried; permanent (bad key, blocked prompt, bad request, daily quota)
 * throw PermanentError / DailyQuotaError and do not.
 */
export async function geminiCall(o: GeminiClientOptions, method: "generateContent" | "batchEmbedContents", body: unknown): Promise<any> {
  if (!o.apiKey) throw new PermanentError("GEMINI_API_KEY is not set on the server.");
  const f = o.fetch ?? fetch;
  const model = o.model ?? "gemini-3.5-flash";
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    const msg = err?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) {
      // Per-day quota (free tier: a small fixed number of requests per model per day) will not clear by retrying in seconds.
      const details: any[] = err?.error?.details ?? [];
      const perDay = details.some((d) => (d?.violations ?? []).some((v: any) => /PerDay/i.test(v?.quotaId ?? "")));
      if (perDay) {
        const delay = Number(String(details.find((d) => d?.retryDelay)?.retryDelay ?? "").replace(/s$/, "")) || undefined;
        throw new DailyQuotaError(`Gemini's daily limit for ${model} is used up${delay ? `; it resets in about ${Math.max(1, Math.round(delay / 3600))} h` : ""}. Retry later, or add a fallback model or billing.`, model, delay);
      }
      throw new Error(`Gemini rate limit reached (free tier). ${msg}`);
    }
    if (res.status >= 500) throw new GeminiUnavailableError(`Gemini is temporarily unavailable (${res.status}).`, model);
    if (res.status === 400 && /API key|API_KEY/i.test(msg)) throw new PermanentError("Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (res.status === 401 || res.status === 403) throw new PermanentError(`Gemini refused the request: ${msg}`);
    throw new PermanentError(`Gemini request failed: ${msg}`);
  }
  return res.json();
}

/** generateContent that returns parsed JSON (structured output). */
export async function geminiJson(o: GeminiClientOptions, req: { system: string; parts: GeminiPart[]; schema: object; temperature?: number }): Promise<unknown> {
  const body: any = await geminiCall(o, "generateContent", {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: req.parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: req.schema, temperature: req.temperature ?? 0.2 },
  });
  const cand = body?.candidates?.[0];
  if (body?.promptFeedback?.blockReason) throw new PermanentError(`Gemini blocked this content (${body.promptFeedback.blockReason}).`);
  const text = cand?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no content (${cand?.finishReason ?? "unknown"}).`);
  if (cand?.finishReason === "MAX_TOKENS") throw new Error("Gemini output was cut off (too long); retrying.");
  return extractJson(text);
}

/**
 * Try models in order. A model whose daily quota is spent, or that is overloaded (5xx), hands over to the next one at once.
 * Anything else propagates untouched. If every model was only overloaded, the overload error is thrown (transient: retried, or handed to
 * another provider); if every model's daily quota is spent, DailyQuotaError is thrown.
 */
export async function geminiJsonFallback(o: GeminiClientOptions, models: string[], req: Parameters<typeof geminiJson>[1], onSwitch?: (from: string, to: string, why: "quota" | "unavailable") => void): Promise<{ data: unknown; model: string }> {
  let quota: DailyQuotaError | undefined, down: GeminiUnavailableError | undefined;
  for (let i = 0; i < models.length; i++) {
    try { return { data: await geminiJson({ ...o, model: models[i] }, req), model: models[i]! }; }
    catch (e) {
      if (e instanceof DailyQuotaError) quota = e;
      else if (e instanceof GeminiUnavailableError) down = e;
      else throw e;
      if (i + 1 < models.length) onSwitch?.(models[i]!, models[i + 1]!, e instanceof DailyQuotaError ? "quota" : "unavailable");
    }
  }
  if (down) throw down;
  throw new DailyQuotaError(models.length > 1 ? `Gemini's daily limit is used up for all configured models (${models.join(", ")}). ${quota!.message.split("; ")[1] ?? "Retry later."}` : quota!.message, models[models.length - 1]!, quota?.retryAfterSec);
}
