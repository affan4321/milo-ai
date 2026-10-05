import { DailyQuotaError, isPermanent } from "@milo/core";
import { GeminiLlm } from "./llm/gemini";
import { extractJson, normalizeInsights } from "./llm/normalize";

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const ok = (obj: unknown, wrap = (s: string) => s) => reply(200, { candidates: [{ content: { parts: [{ text: wrap(JSON.stringify(obj)) }] } }] });
const input = { transcript: "[t=0] A: hi", templatePrompt: "x", durationMs: 60_000 };
const good = { summary: { sections: [{ heading: "H", bullets: [{ text: "b", t: 10 }] }] }, actionItems: [{ text: "do it", assignee: "A", t: 20 }], chapters: [{ title: "Intro", t: 0 }] };
const err = async (f: typeof fetch) => { try { await new GeminiLlm({ apiKey: "k", fetch: f }).insights(input); return null; } catch (e) { return e; } };

// happy path + fenced JSON
let r = await new GeminiLlm({ apiKey: "k", fetch: ok(good) }).insights(input);
check(r.summary.sections[0]!.bullets[0]!.ms === 10_000 && r.actionItems[0]!.sourceMs === 20_000 && r.chapters[0]!.startMs === 0, "seconds -> ms");
r = await new GeminiLlm({ apiKey: "k", fetch: ok(good, (s) => "```json\n" + s + "\n```") }).insights(input);
check(r.chapters.length === 1, "code-fenced JSON accepted");
check((extractJson('Here you go: {"a":1} thanks') as any).a === 1, "JSON found inside prose");

// timestamps are clamped / dropped, never trusted
const wild = { summary: { sections: [{ heading: "H", bullets: [{ text: "late", t: 99999 }, { text: "neg", t: -5 }, { text: "nan", t: "abc" }, { text: "  ", t: 1 }] }] },
  actionItems: [{ text: "x", t: 1e9 }, { text: "" }], chapters: [{ title: "B", t: 30 }, { title: "A", t: 5 }, { title: "A2", t: 5 }, { title: "bad", t: "x" }] };
const n = normalizeInsights(wild, 60_000);
const b = n.summary.sections[0]!.bullets;
check(b.length === 3 && b[0]!.ms === 60_000 && b[1]!.ms === undefined && b[2]!.ms === undefined, "bullet times clamped, bad ones dropped, blank bullet removed");
check(n.actionItems.length === 1 && n.actionItems[0]!.sourceMs === 60_000, "empty action item removed, time clamped");
check(n.chapters.map((c) => c.title).join() === "A,B", "chapters sorted, deduped by time, invalid dropped");
let threw = false; try { normalizeInsights({ summary: { sections: [] } }, 1000); } catch { threw = true; } check(threw, "empty summary rejected");

// error classification: transient errors retry, permanent ones don't
let e = await err(reply(429, { error: { message: "quota" } })); check(e && !isPermanent(e) && /rate limit/i.test((e as Error).message), "429 is retryable");
e = await err(reply(503, {})); check(e && !isPermanent(e), "503 is retryable");
e = await err(reply(400, { error: { message: "API key not valid" } })); check(isPermanent(e) && /API key/.test((e as Error).message), "bad key is permanent with a clear message");
e = await err(reply(200, { promptFeedback: { blockReason: "SAFETY" } })); check(isPermanent(e), "blocked prompt is permanent");
e = await err(reply(200, { candidates: [{ content: { parts: [{ text: "not json at all" }] } }] })); check(e && !isPermanent(e), "garbage output is retryable");
e = await err(reply(200, { candidates: [{ finishReason: "MAX_TOKENS" }] })); check(e && !isPermanent(e), "empty content is retryable");
e = await new GeminiLlm({ apiKey: "", fetch: ok(good) }).insights(input).catch((x) => x); check(isPermanent(e), "missing key is permanent");

// request shape: key goes in a header, never the URL
let seen: any; await new GeminiLlm({ apiKey: "SECRETKEY", model: "m1", fetch: (async (u: string, init: any) => { seen = { u, init }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] })); }) as any }).insights(input);
check(!seen.u.includes("SECRETKEY") && seen.init.headers["x-goog-api-key"] === "SECRETKEY" && seen.u.includes("/models/m1:"), "key in header, model in URL");
check(JSON.parse(seen.init.body).generationConfig.responseMimeType === "application/json", "JSON mode requested");

// daily quota: shaped like the real free-tier 429 body. Not retryable in seconds, so permanent for this run; per-minute 429s stay transient.
const dailyBody = { error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "18184s" }] } };
const minuteBody = { error: { status: "RESOURCE_EXHAUSTED", message: "slow down", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] } };
e = await err(reply(429, dailyBody)); check(e instanceof DailyQuotaError && isPermanent(e) && /resets in about 5 h/.test((e as Error).message) && (e as DailyQuotaError).retryAfterSec === 18184, "daily quota -> DailyQuotaError with reset time");
e = await err(reply(429, minuteBody)); check(e && !isPermanent(e), "per-minute 429 stays retryable");

// fallback: first model out of daily quota -> second model answers; the request URL shows which model was used
const urls: string[] = [];
const fb = new GeminiLlm({ apiKey: "k", model: "primary", fallbackModels: ["backup"], fetch: (async (u: string) => { urls.push(u); return u.includes("/primary:") ? new Response(JSON.stringify(dailyBody), { status: 429 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] })); }) as any });
r = await fb.insights(input);
check(urls.length === 2 && urls[0]!.includes("/primary:") && urls[1]!.includes("/backup:") && r.chapters.length === 1, "falls back to the next model on daily quota");
const allOut = new GeminiLlm({ apiKey: "k", model: "a", fallbackModels: ["b"], fetch: reply(429, dailyBody) });
e = await allOut.insights(input).catch((x) => x); check(e instanceof DailyQuotaError && /all configured models \(a, b\)/.test((e as Error).message), "all models exhausted -> clear error naming them");
// an overloaded (5xx) primary hands over to the next model at once; if every model is overloaded the error stays transient (retryable)
urls.length = 0;
const nf = new GeminiLlm({ apiKey: "k", model: "primary", fallbackModels: ["backup"], fetch: (async (u: string) => { urls.push(u); return new Response("{}", { status: 503 }); }) as any });
e = await nf.insights(input).catch((x) => x); check(e && urls.length === 2 && !isPermanent(e) && /temporarily unavailable/.test((e as Error).message), "503 tries the next model, and stays retryable if all are overloaded");
// a genuine request error (not quota, not overload) does NOT trigger fallback: it would fail identically on the next model
urls.length = 0;
const bad = new GeminiLlm({ apiKey: "k", model: "primary", fallbackModels: ["backup"], fetch: (async (u: string) => { urls.push(u); return new Response('{"error":{"message":"bad schema"}}', { status: 400 }); }) as any });
e = await bad.insights(input).catch((x) => x); check(e && urls.length === 1 && isPermanent(e), "a 400 is permanent and does not touch the fallback model");

console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
