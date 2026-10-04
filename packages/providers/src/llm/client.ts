import { DailyQuotaError, PermanentError } from "@milo/core";
import { extractJson } from "./normalize";

export interface GeminiClientOptions { apiKey: string; model?: string; fetch?: typeof fetch; timeoutMs?: number }
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * One Gemini generateContent call returning parsed JSON. Error classes matter to the queue:
 * transient (429 / 5xx / empty or unparsable output) throw plain Errors and get retried;
 * permanent (bad key, blocked prompt, bad request) throw PermanentError and do not.
 */
export async function geminiJson(o: GeminiClientOptions, req: { system: string; parts: GeminiPart[]; schema: object; temperature?: number }): Promise<unknown> {
  if (!o.apiKey) throw new PermanentError("GEMINI_API_KEY is not set on the server.");
  const f = o.fetch ?? fetch;
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${o.model ?? "gemini-3.5-flash"}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: req.parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: req.schema, temperature: req.temperature ?? 0.2 },
    }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 180_000),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) {
      // Per-day quota (free tier: a small fixed number of requests per model per day) will not clear by retrying in seconds.
      const details: any[] = body?.error?.details ?? [];
      const perDay = details.some((d) => (d?.violations ?? []).some((v: any) => /PerDay/i.test(v?.quotaId ?? "")));
      if (perDay) {
        const delay = Number(String(details.find((d) => d?.retryDelay)?.retryDelay ?? "").replace(/s$/, "")) || undefined;
        const model = o.model ?? "gemini-3.5-flash";
        throw new DailyQuotaError(`Gemini's daily limit for ${model} is used up${delay ? `; it resets in about ${Math.max(1, Math.round(delay / 3600))} h` : ""}. Retry later, or add a fallback model or billing.`, model, delay);
      }
      throw new Error(`Gemini rate limit reached (free tier). ${msg}`);
    }
    if (res.status >= 500) throw new Error(`Gemini is temporarily unavailable (${res.status}).`);
    if (res.status === 400 && /API key|API_KEY/i.test(msg)) throw new PermanentError("Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (res.status === 401 || res.status === 403) throw new PermanentError(`Gemini refused the request: ${msg}`);
    throw new PermanentError(`Gemini request failed: ${msg}`);
  }
  const body: any = await res.json();
  const cand = body?.candidates?.[0];
  if (body?.promptFeedback?.blockReason) throw new PermanentError(`Gemini blocked this content (${body.promptFeedback.blockReason}).`);
  const text = cand?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no content (${cand?.finishReason ?? "unknown"}).`);
  if (cand?.finishReason === "MAX_TOKENS") throw new Error("Gemini output was cut off (too long); retrying.");
  return extractJson(text);
}

/** Try models in order; a model whose daily quota is spent hands over to the next. Anything else propagates untouched. */
export async function geminiJsonFallback(o: GeminiClientOptions, models: string[], req: Parameters<typeof geminiJson>[1], onSwitch?: (from: string, to: string) => void): Promise<{ data: unknown; model: string }> {
  let last: DailyQuotaError | undefined;
  for (let i = 0; i < models.length; i++) {
    try { return { data: await geminiJson({ ...o, model: models[i] }, req), model: models[i]! }; }
    catch (e) {
      if (!(e instanceof DailyQuotaError)) throw e;
      last = e;
      if (i + 1 < models.length) onSwitch?.(models[i]!, models[i + 1]!);
    }
  }
  throw new DailyQuotaError(models.length > 1 ? `Gemini's daily limit is used up for all configured models (${models.join(", ")}). ${last!.message.split("; ")[1] ?? "Retry later."}` : last!.message, models[models.length - 1]!, last?.retryAfterSec);
}
