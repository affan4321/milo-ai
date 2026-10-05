// WARNING: spends real requests on Gemini AND Groq. Head-to-head of summary/action-item/chapter/Ask quality on Milo's own transcripts.
// Run: npx tsx --env-file=.env apps/worker/src/llm-compare.test.ts
import { eq, asc } from "drizzle-orm";
import { getDb, meetings, recordings, transcriptSegments } from "@milo/db";
import { GeminiLlm, OpenAiCompatLlm, type LlmProvider } from "@milo/providers";
import { transcriptForLlm, BUILT_IN_TEMPLATES } from "@milo/intelligence";

const db = getDb();
const KEY = process.env.GROQ_API_KEY ?? "";
const providers: [string, LlmProvider][] = [
  ["gemini-3.1-flash-lite", new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", model: "gemini-3.1-flash-lite" })],
  ["groq gpt-oss-120b", new OpenAiCompatLlm({ apiKey: KEY, baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", label: "Groq gpt-oss-120b" })],
  ["groq gpt-oss-20b", new OpenAiCompatLlm({ apiKey: KEY, baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", label: "Groq gpt-oss-20b" })],
  ["groq qwen3.8-27b", new OpenAiCompatLlm({ apiKey: KEY, baseUrl: "https://api.groq.com/openai/v1", model: "qwen/qwen3.8-27b", label: "Groq qwen3.8-27b" })],
];
// What the script of the 12-minute clip really contains (ground truth).
const TRUTH = [["QA (Daniel confirms the date)", /\bQA\b/i, /confirm/i], ["launch email (Karen, Monday)", /email/i, /launch|draft/i], ["job description (Karen, Thursday)", /job description|hire|hiring/i, /./]] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokens = (s: string) => Math.round(s.length / 3.7);

async function pickMeeting(titlePart: string) {
  const ms = await db.select().from(meetings).where(eq(meetings.status, "ready"));
  const m = ms.filter((x) => x.title.toLowerCase().includes(titlePart)).sort((a, b) => +b.createdAt - +a.createdAt)[0];
  if (!m) throw new Error(`no meeting matching ${titlePart}`);
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, m.id));
  const segs = await db.select({ s: transcriptSegments.startMs }).from(transcriptSegments).where(eq(transcriptSegments.meetingId, m.id)).orderBy(asc(transcriptSegments.startMs));
  return { m, durationMs: rec!.durationMs!, transcript: await transcriptForLlm(db, m.id), lineMs: segs.map((x) => x.s) };
}

for (const [label, title] of [["2-minute meeting", "pricing launch sync"], ["12-minute meeting", "planning-sync-12min"]] as const) {
  const c = await pickMeeting(title);
  console.log(`\n=== ${label}: ${c.lineMs.length} lines, ~${tokens(c.transcript)} transcript tokens`);
  for (const [name, llm] of providers) {
    const t0 = Date.now();
    try {
      const r = await llm.insights({ transcript: c.transcript, templatePrompt: BUILT_IN_TEMPLATES[0]!.prompt, durationMs: c.durationMs });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const bullets = r.summary.sections.flatMap((s) => s.bullets);
      const grounded = bullets.filter((b) => b.ms !== undefined && c.lineMs.some((l) => Math.abs(l - b.ms!) <= 15_000)).length;
      const actText = r.actionItems.map((a) => `${a.assignee ?? ""} ${a.text}`).join(" | ");
      const found = TRUTH.filter(([, a, b]) => r.actionItems.some((x) => a.test(x.text) && b.test(x.text))).length;
      console.log(`${name.padEnd(22)} ${secs.padStart(5)}s | ${r.summary.sections.length} sections, ${bullets.length} bullets (${grounded} cite a real moment) | ${r.actionItems.length} action items (${found}/3 true ones found) | ${r.chapters.length} chapters`);
      if (label.startsWith("12") && name !== "gemini-3.1-flash-lite") console.log(`   actions: ${actText.slice(0, 230)}`);
    } catch (e) { console.log(`${name.padEnd(22)} FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${(e as Error).message.slice(0, 150)}`); }
    await sleep(8000);   // keep clear of Groq's 8k tokens/minute window between runs
  }
}

// Ask: answer from numbered excerpts with citations
const ctx = [
  { id: "1", text: "Samantha: Engineering can finish the checkout work for point nine by the 20th, if we drop the coupon feature.", ms: 5000, meeting: "Pricing launch sync", speaker: "Speaker 2" },
  { id: "2", text: "Daniel: I will message QA this afternoon and send the confirmed date to everyone.", ms: 18000, meeting: "Pricing launch sync", speaker: "Speaker 2" },
  { id: "3", text: "Karen: I will write the job description this week and post it on Thursday.", ms: 39000, meeting: "Pricing launch sync", speaker: "Speaker 3" },
  { id: "4", text: "Samantha: Last topic, the support backlog. We currently have forty open tickets and we need one more hire.", ms: 33000, meeting: "Pricing launch sync", speaker: "Speaker 1" },
];
console.log("\n=== Ask Milo (answers from excerpts)");
for (const q of [["What has to be dropped to finish checkout by the 20th?", /coupon/i], ["When will the job description be posted?", /thursday/i], ["What is the capital of Mongolia?", /couldn.t find|not (find|mention|in)|no information|don.t (see|have)/i]] as const) {
  for (const [name, llm] of providers) {
    const t0 = Date.now();
    try {
      const a = await llm.answer({ question: q[0], context: ctx });
      const ok = q[1].test(a.text), cited = a.citedIds.length;
      console.log(`${name.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s | ${ok ? "correct" : "WRONG  "} | ${cited} citation(s) | ${a.text.slice(0, 90).replace(/\n/g, " ")}`);
    } catch (e) { console.log(`${name.padEnd(22)} FAILED: ${(e as Error).message.slice(0, 120)}`); }
    await sleep(3000);
  }
  console.log("");
}
process.exit(0);
