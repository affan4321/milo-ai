// WARNING: spends Groq requests. Raw single-attempt reliability of strict-JSON summaries per model (no retries), paced under 8k tokens/min.
import { eq } from "drizzle-orm";
import { getDb, meetings, recordings } from "@milo/db";
import { transcriptForLlm, BUILT_IN_TEMPLATES } from "@milo/intelligence";
import { OpenAiCompatLlm } from "@milo/providers";
const db = getDb();
const [m] = (await db.select().from(meetings).where(eq(meetings.status, "ready"))).filter((x) => x.title.toLowerCase().includes("pricing launch sync")).slice(-1);
const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, m!.id));
const transcript = await transcriptForLlm(db, m!.id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const [model, n] of [["openai/gpt-oss-120b", 6], ["openai/gpt-oss-20b", 5], ["qwen/qwen3.8-27b", 6]] as const) {
  let ok = 0, invalid = 0, other = 0, secs = 0, actions = 0; const msgs: string[] = [];
  for (let i = 0; i < n; i++) {
    const llm = new OpenAiCompatLlm({ apiKey: process.env.GROQ_API_KEY!, baseUrl: "https://api.groq.com/openai/v1", model });
    const t0 = Date.now();
    try { const r = await llm.insights({ transcript, templatePrompt: BUILT_IN_TEMPLATES[0]!.prompt, durationMs: rec!.durationMs! }); ok++; secs += (Date.now() - t0) / 1000; actions += r.actionItems.length; }
    catch (e) { const t = (e as Error).message; if (/invalid JSON|cut off/.test(t)) invalid++; else other++; msgs.push(t.slice(0, 90)); }
    await sleep(26_000);
  }
  console.log(`${model.padEnd(22)} ${ok}/${n} ok | ${invalid} bad-JSON/cut-off | ${other} other | avg ${(secs / Math.max(1, ok)).toFixed(1)}s | avg ${(actions / Math.max(1, ok)).toFixed(1)} action items${msgs.length ? " | " + [...new Set(msgs)].join(" ; ") : ""}`);
}
process.exit(0);
