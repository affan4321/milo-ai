import assert from "node:assert/strict";
import { DailyQuotaError, PermanentError } from "@milo/core";
import { FallbackLlm } from "./llm/fallback";
import { FallbackStt, looksLikeNoise } from "./stt/whisper";
import { GeminiUnavailableError, geminiJsonFallback } from "./llm/client";

const mk = (f: () => Promise<any>) => ({ insights: f, summarize: f, answer: f, embed: async () => [] }) as any;
const quota = () => new DailyQuotaError("used up", "m");
let used = 0;
const ok = mk(async () => { used++; return "backup"; });

// primary out of quota -> backup answers
assert.equal(await new FallbackLlm(mk(async () => { throw quota(); }), ok).answer({} as any), "backup");
// other errors never touch the backup
used = 0;
await assert.rejects(new FallbackLlm(mk(async () => { throw new Error("boom"); }), ok).answer({} as any), /boom/);
await assert.rejects(new FallbackLlm(mk(async () => { throw new PermanentError("bad"); }), ok).answer({} as any), /bad/);
assert.equal(used, 0);
// backup can't take it (too big) -> original quota error with a note
const tooBig = mk(async () => { throw new PermanentError("too large"); });
await assert.rejects(new FallbackLlm(mk(async () => { throw quota(); }), tooBig).insights({} as any), (e: any) => e instanceof DailyQuotaError && /too large/.test(e.message));
// STT
const stt = (f: () => Promise<any>) => ({ transcribe: f }) as any;
assert.deepEqual(await new FallbackStt(stt(async () => { throw quota(); }), stt(async () => ["w"])).transcribe({} as any, {} as any), ["w"]);
await assert.rejects(new FallbackStt(stt(async () => { throw new Error("x"); }), stt(async () => ["w"])).transcribe({} as any, {} as any), /x/);
assert.ok(looksLikeNoise({ no_speech_prob: 0.9, avg_logprob: -1.5 }));
assert.ok(!looksLikeNoise({ no_speech_prob: 0.1, avg_logprob: -0.2 }));
// An overloaded (5xx) Gemini model hands over to the next model at once, and to the backup provider when every model is overloaded.
const down = () => { throw new GeminiUnavailableError("Gemini is temporarily unavailable (503).", "m"); };
assert.equal(await new FallbackLlm(mk(async () => down()), ok).answer({} as any), "backup", "LLM overload -> backup");
assert.deepEqual(await new FallbackStt(stt(async () => down()), stt(async () => ["whisper"])).transcribe({} as any, {} as any), ["whisper"], "STT overload -> Whisper");
const calls: string[] = [];
const fakeFetch = (async (u: string) => { const m = /models\/([^:]+):/.exec(u)![1]!; calls.push(m); return m === "slow" ? new Response('{"error":{"message":"busy"}}', { status: 503 }) : new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }); }) as unknown as typeof fetch;
const r = await geminiJsonFallback({ apiKey: "k", fetch: fakeFetch }, ["slow", "fast"], { system: "s", parts: [{ text: "x" }], schema: {} });
assert.equal(r.model, "fast"); assert.deepEqual(calls, ["slow", "fast"], "503 on the first model moves to the second without retrying the first");
await assert.rejects(geminiJsonFallback({ apiKey: "k", fetch: fakeFetch }, ["slow", "slow"], { system: "s", parts: [{ text: "x" }], schema: {} }), (e: any) => e instanceof GeminiUnavailableError, "all models overloaded -> transient unavailable error");
console.log("fallback tests passed");
