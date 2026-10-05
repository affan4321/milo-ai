import { DailyQuotaError, isPermanent } from "@milo/core";
import { GeminiLlm } from "./llm/gemini";
import { fakeEmbedding } from "./fakes";

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
const vec = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed + i));
const ok = (body: unknown) => new Response(JSON.stringify(body));
const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
const dailyBody = { error: { details: [{ violations: [{ quotaId: "EmbedRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };

// batching: 250 texts -> 3 requests (100/100/50), order preserved, vectors unit length, query/document task types sent
const calls: any[] = [];
const llm = new GeminiLlm({ apiKey: "k", fetch: (async (u: string, init: any) => {
  const b = JSON.parse(init.body); calls.push({ u, n: b.requests.length, task: b.requests[0].taskType, dims: b.requests[0].outputDimensionality, key: init.headers["x-goog-api-key"] });
  return ok({ embeddings: b.requests.map((r: any) => ({ values: vec(r.content.parts[0].text.length) })) });
}) as any });
const texts = Array.from({ length: 250 }, (_, i) => "x".repeat(i + 1));
const out = await llm.embed(texts, "document");
check(calls.length === 3 && calls.map((c) => c.n).join() === "100,100,50", `250 texts -> 3 batched requests (${calls.map((c) => c.n)})`);
check(out.length === 250 && out.every((v) => v.length === 768 && Math.abs(norm(v) - 1) < 1e-6), "all vectors are 768-d and unit length");
check(out[0]!.every((x, i) => Math.abs(x - vec(1).map((y) => y / norm(vec(1)))[i]!) < 1e-9) && out[249]!.every((x, i) => Math.abs(x - vec(250).map((y) => y / norm(vec(250)))[i]!) < 1e-9), "order preserved");
check(calls[0].task === "RETRIEVAL_DOCUMENT" && calls[0].dims === 768 && calls[0].u.includes("gemini-embedding-001:batchEmbedContents"), "document task, 768 dims, default model");
check(!calls[0].u.includes("k") || calls[0].key === "k", "key is sent as a header");
calls.length = 0; await llm.embed(["when is the launch"], "query"); check(calls[0].task === "RETRIEVAL_QUERY", "queries use the query task type");

// bad responses are transient (retry), quota falls back to the next embedding model, then fails permanently
let e: any = await new GeminiLlm({ apiKey: "k", fetch: (async () => ok({ embeddings: [{ values: [1, 2, 3] }] })) as any }).embed(["a"]).catch((x) => x);
check(e && !isPermanent(e), "wrong-sized vectors -> retryable error");
const models: string[] = [];
const fb = new GeminiLlm({ apiKey: "k", embedModels: ["m1", "m2"], fetch: (async (u: string, init: any) => { const m = /models\/([^:]+):/.exec(u)![1]!; models.push(m); return m === "m1" ? new Response(JSON.stringify(dailyBody), { status: 429 }) : ok({ embeddings: JSON.parse(init.body).requests.map(() => ({ values: vec(1) })) }); }) as any });
const r = await fb.embed(["a", "b"]); check(r.length === 2 && models.join() === "m1,m2", "daily quota on m1 -> m2 answers");
e = await new GeminiLlm({ apiKey: "k", embedModels: ["m1"], fetch: (async () => new Response(JSON.stringify(dailyBody), { status: 429 })) as any }).embed(["a"]).catch((x) => x);
check(e instanceof DailyQuotaError && isPermanent(e), "all embedding models exhausted -> DailyQuotaError");
e = await new GeminiLlm({ apiKey: "", fetch: (async () => ok({})) as any }).embed(["a"]).catch((x) => x); check(isPermanent(e), "missing key is permanent");

// answer(): only supplied excerpt ids count as citations; invented ones are stripped from text and list
const ctx = [{ id: "1", text: "We launch on October 20th.", ms: 65_000, meeting: "Planning", speaker: "Ada" }, { id: "2", text: "Budget is a risk.", ms: 90_000, meeting: "Planning" }];
const ans = (raw: unknown) => new GeminiLlm({ apiKey: "k", fetch: (async () => ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }] })) as any });
let a = await ans({ answer: "Launch is October 20th [1]. Also [9] something [2].", cited: ["1", "9", "2", "1"] }).answer({ question: "when?", context: ctx });
check(a.citedIds.join() === "1,2" && !a.text.includes("[9]") && a.text.includes("[1]") && a.text.includes("[2]"), `invented citation [9] removed (${JSON.stringify(a)})`);
e = await ans({ answer: "  ", cited: [] }).answer({ question: "q", context: ctx }).catch((x) => x); check(e instanceof Error && !isPermanent(e), "empty answer -> retryable");
let sent = ""; const spy = new GeminiLlm({ apiKey: "k", fetch: (async (_u: string, init: any) => { sent = JSON.parse(init.body).contents[0].parts[0].text; return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "ok", cited: [] }) }] } }] }); }) as any });
await spy.answer({ question: "and who owns it?", history: [{ role: "user", content: "when do we launch?" }, { role: "assistant", content: "October 20th [1]" }], context: ctx });
check(sent.includes("Conversation so far") && sent.includes("when do we launch?") && sent.includes("[1] Planning · Ada · at 1:05") && sent.includes("Question: and who owns it?"), "history and numbered excerpts (meeting, speaker, time) reach the model");

// fake embedding: shared words -> similar, unrelated -> not
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const q = fakeEmbedding("when is the pricing launch date"), d1 = fakeEmbedding("we will launch the pricing page on october twentieth"), d2 = fakeEmbedding("the support backlog needs another hire");
check(dot(q, d1) > dot(q, d2) + 0.1 && Math.abs(norm(q) - 1) < 1e-9, "fake embeddings rank related text higher");

console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
