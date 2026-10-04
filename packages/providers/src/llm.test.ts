import { isPermanent } from "@milo/core";
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

console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
