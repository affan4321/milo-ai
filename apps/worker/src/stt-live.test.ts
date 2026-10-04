// WARNING: spends real Gemini requests (free tier: ~20/day per model). Run deliberately, never in a loop.
// Live accuracy check of the Gemini STT adapter on a scripted multi-voice clip made with macOS `say` (ground truth in truth.tsv).
// Run: GEMINI_STT_MODEL=<model> npx tsx --env-file=.env apps/worker/src/stt-live.test.ts [dir-with-conversation.m4a+truth.tsv]
import fs from "node:fs";
import path from "node:path";
import { GeminiStt, LocalStorage } from "@milo/providers";

const dir = path.resolve(process.argv[2] ?? ".data/samples/say");
const truth = fs.readFileSync(path.join(dir, "truth.tsv"), "utf8").trim().split("\n").map((l) => { const [i, t, voice, text] = l.split("\t"); return { i: Number(i), startMs: Math.round(Number(t) * 1000), voice: voice!, text: text! }; });
const durationMs = Math.round(Number((await import("node:child_process")).execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, "conversation.m4a")]).toString()) * 1000);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function wer(ref: string[], hyp: string[]) { // word-level edit distance
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]); for (let j = 0; j <= hyp.length; j++) d[0]![j] = j;
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return d[ref.length]![hyp.length]! / ref.length;
}

const model = process.env.GEMINI_STT_MODEL ?? process.env.GEMINI_MODEL;
const stt = new GeminiStt({ chunkSeconds: process.env.CHUNK ? Number(process.env.CHUNK) : undefined, apiKey: process.env.GEMINI_API_KEY ?? "", model, retryDelaysMs: [10_000, 30_000] });
const t0 = Date.now();
const segs = await stt.transcribe({ key: "conversation.m4a", durationMs }, new LocalStorage(dir));
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const refWords = norm(truth.map((t) => t.text).join(" ")), hypWords = norm(segs.map((s) => s.text).join(" "));
// speaker accuracy: match each segment to the script line it best overlaps *by words* (so timestamp drift can't masquerade as a
// speaker error), map each model label to the true voice it most often matches, then count segments whose voice agrees.
const bag = (s: string) => new Set(norm(s));
const truthBags = truth.map((t) => bag(t.text));
const matchVoice = (text: string) => { const h = bag(text); let best = 0, v = ""; truth.forEach((t, k) => { let n = 0; for (const w of h) if (truthBags[k]!.has(w)) n++; const sc = n / Math.max(1, new Set([...h, ...truthBags[k]!]).size); if (sc > best) { best = sc; v = t.voice; } }); return v; };
const votes = new Map<string, Map<string, number>>();
for (const s of segs) { const v = matchVoice(s.text); const m = votes.get(s.speakerLabel) ?? new Map(); m.set(v, (m.get(v) ?? 0) + 1); votes.set(s.speakerLabel, m); }
const map = new Map([...votes].map(([l, m]) => [l, [...m].sort((a, b) => b[1] - a[1])[0]![0]]));
const correct = segs.filter((s) => map.get(s.speakerLabel) === matchVoice(s.text)).length;
// timestamp error: each true utterance start vs the nearest segment start
const errs = truth.map((t) => Math.min(...segs.map((s) => Math.abs(s.startMs - t.startMs)))).sort((a, b) => a - b);

console.log(`model ${model} | ${secs}s for ${(durationMs / 1000).toFixed(0)}s audio | ${segs.length} segments (truth ${truth.length}) | speakers found: ${new Set(segs.map((s) => s.speakerLabel)).size} (truth 3)`);
console.log(`word error rate: ${(wer(refWords, hypWords) * 100).toFixed(1)}%`);
console.log(`speaker attribution: ${correct}/${segs.length} segments | label->voice: ${[...map].map(([l, v]) => `${l}=${v}`).join(", ")}`);
console.log(`start-time error vs truth: median ${errs[Math.floor(errs.length / 2)]}ms, worst ${errs[errs.length - 1]}ms`);
for (const s of segs.slice(0, 3)) console.log(`  [${(s.startMs / 1000).toFixed(1)}s] ${s.speakerLabel}: ${s.text.slice(0, 80)}`);
