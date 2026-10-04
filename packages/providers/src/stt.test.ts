import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPermanent } from "@milo/core";
import { GeminiStt } from "./stt/gemini";
import { normalizeChunk, parseClock } from "./stt/normalize";
import { LocalStorage } from "./storage/local";

let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };

// clock parsing
check(parseClock("01:05") === 65_000 && parseClock("1:02:03") === 3_723_000 && parseClock("00:07.5") === 7_500 && parseClock(12) === 12_000, "clock formats");
check(parseClock("abc") === undefined && parseClock("1:2:3:4") === undefined && parseClock(-3) === undefined && parseClock(null) === undefined, "bad clocks rejected");

// normalization: offsets, ordering, derived ends, word times inside the segment
const segs = normalizeChunk({ segments: [
  { speaker: "Speaker 2", start: "00:10", text: "second thing I said" },
  { speaker: "Speaker 1", start: "00:02", text: "  hello   there  " },
  { speaker: "Speaker 1", start: "bad", text: "dropped" }, { speaker: "Speaker 1", start: "00:20", text: "   " },
  { speaker: "Speaker 3", start: "99:00", text: "after the end" },
] }, 600_000, 60_000);
check(segs.length === 3 && segs[0]!.text === "hello there" && segs[0]!.startMs === 602_000, "sorted, trimmed, offset onto recording clock");
check(segs[0]!.endMs <= segs[1]!.startMs && segs[1]!.endMs <= segs[2]!.startMs, "segments never overlap");
check(segs[2]!.startMs === 660_000, "start after chunk end is clamped to chunk end");
check(segs.every((s) => s.words.every((w) => w.s >= s.startMs && w.e <= s.endMs + 1) && s.words.length === s.text.split(" ").length), "word times stay inside their segment");
check(normalizeChunk({ segments: [] }, 0, 1000).length === 0 && normalizeChunk(null, 0, 1000).length === 0, "empty / junk -> no segments");

// adapter: 3 chunks of a 25 min file at 10 min chunks, with a transient 429 on chunk 2 that must not redo chunk 1
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stt-test-"));
fs.writeFileSync(path.join(dir, "a.m4a"), "x");
const storage = new LocalStorage(dir);
const calls: { text: string; hadAudio: boolean }[] = [];
let n = 0, failedOnce = false;
const fetchMock = (async (_u: string, init: any) => {
  const parts = JSON.parse(init.body).contents[0].parts;
  const text = parts[0].text as string; calls.push({ text, hadAudio: !!parts[1]?.inlineData });
  n++;
  if (text.includes("1500 seconds") === false && text.includes("600 seconds") && calls.length === 2 && !failedOnce) { failedOnce = true; return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }); }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [{ speaker: "Speaker 1", start: "00:03", text: `line from call ${n}` }, { speaker: "Speaker 2", start: "00:30", text: "reply" }] }) }] } }] }));
}) as unknown as typeof fetch;
const cuts: number[] = [];
const stt = new GeminiStt({ apiKey: "k", chunkSeconds: 600, fetch: fetchMock, retryDelaysMs: [1, 1], cut: async (_f, s, _l, out) => { cuts.push(s); fs.writeFileSync(out, "audio"); } });
const out = await stt.transcribe({ key: "a.m4a", durationMs: 25 * 60_000 }, storage);
check(cuts.join() === "0,600,1200", "audio cut at 0, 10 and 20 minutes");
check(calls.length === 4 && failedOnce, "429 retried once, only for the failing chunk (4 calls for 3 chunks)");
check(calls[0]!.text.includes("start of the recording") && calls[2]!.text.includes("Speakers so far: Speaker 1, Speaker 2") && calls[2]!.text.includes("line from call"), "later chunks receive speaker context");
check(calls.every((c) => c.hadAudio), "every request carries audio");
check(out.length === 6 && out[2]!.startMs === 603_000 && out[4]!.startMs === 1_203_000, "segments land on the recording clock");

// permanent errors are not retried; transient errors give up after the delays are used
let attempts = 0;
const bad = new GeminiStt({ apiKey: "k", retryDelaysMs: [1, 1], cut: async (_f, _s, _l, o) => fs.writeFileSync(o, "a"), fetch: (async () => { attempts++; return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }); }) as any });
const e1 = await bad.transcribe({ key: "a.m4a", durationMs: 5000 }, storage).catch((x) => x);
check(isPermanent(e1) && attempts === 1, "bad key fails once, no retries");
attempts = 0;
const flaky = new GeminiStt({ apiKey: "k", retryDelaysMs: [1, 1], cut: async (_f, _s, _l, o) => fs.writeFileSync(o, "a"), fetch: (async () => { attempts++; return new Response("{}", { status: 503 }); }) as any });
const e2 = await flaky.transcribe({ key: "a.m4a", durationMs: 5000 }, storage).catch((x) => x);
check(e2 instanceof Error && !isPermanent(e2) && attempts === 3, "persistent 503: 1 try + 2 retries then a retryable error");

// quota runs out mid-recording: chunk 1 on the primary, chunk 2 falls back, chunk 3 stays on the fallback (no flip-flopping)
const seenModels: string[] = [];
const daily = { error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } };
let primaryCalls = 0;
const qfetch = (async (u: string) => {
  const model = /models\/([^:]+):/.exec(u)![1]!; seenModels.push(model);
  if (model === "primary" && ++primaryCalls > 1) return new Response(JSON.stringify(daily), { status: 429 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [{ speaker: "Speaker 1", start: "00:01", text: "hello" }] }) }] } }] }));
}) as unknown as typeof fetch;
const qs = new GeminiStt({ apiKey: "k", model: "primary", fallbackModels: ["backup"], chunkSeconds: 600, fetch: qfetch, retryDelaysMs: [1], cut: async (_f, _s, _l, o) => fs.writeFileSync(o, "a") });
const qout = await qs.transcribe({ key: "a.m4a", durationMs: 25 * 60_000 }, storage);
check(seenModels.join() === "primary,primary,backup,backup" && qout.length === 3, "mid-recording quota: switches once and stays on the fallback");
const none = new GeminiStt({ apiKey: "k", model: "primary", chunkSeconds: 600, fetch: (async () => new Response(JSON.stringify(daily), { status: 429 })) as any, retryDelaysMs: [1, 1], cut: async (_f, _s, _l, o) => fs.writeFileSync(o, "a") });
const qe = await none.transcribe({ key: "a.m4a", durationMs: 5000 }, storage).catch((x) => x);
check(isPermanent(qe), "quota with no fallback fails permanently instead of retrying for hours");

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
