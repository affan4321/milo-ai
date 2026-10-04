// Live check against the real Gemini API with a short synthetic transcript. Run: npx tsx --env-file=.env apps/worker/src/gemini-live.test.ts
import { GeminiLlm } from "@milo/providers";
import { BUILT_IN_TEMPLATES } from "@milo/intelligence";

const llm = new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL });
const transcript = [
  "[t=0] Priya: Thanks for joining. Today we need to decide on the pricing page launch date.",
  "[t=14] Tom: Engineering can finish the checkout work by October 20th if we drop the coupon feature.",
  "[t=33] Priya: Dropping coupons is fine. Tom, please confirm the date with QA by Friday.",
  "[t=51] Tom: I'll message QA today and send the confirmed date to everyone.",
  "[t=70] Dana: On marketing, I'll draft the launch email and share it Monday for review.",
  "[t=95] Priya: Great. Last topic: the support backlog. We have 40 open tickets and need one more hire.",
  "[t=118] Dana: I'll write the job description this week.",
].join("\n");
const durationMs = 130_000;
const t0 = Date.now();
const r = await llm.insights({ transcript, durationMs, templatePrompt: BUILT_IN_TEMPLATES[0]!.prompt });
console.log(`insights in ${Date.now() - t0}ms`);
console.log("sections:", r.summary.sections.map((s) => `${s.heading}(${s.bullets.length})`).join(", "));
console.log("bullet ms:", r.summary.sections.flatMap((s) => s.bullets.map((b) => b.ms)).join(","));
console.log("actions:", r.actionItems.map((a) => `${a.assignee ?? "?"}@${a.sourceMs}: ${a.text}`).join(" | "));
console.log("chapters:", r.chapters.map((c) => `${c.startMs}:${c.title}`).join(" | "));
const s = await llm.summarize({ transcript, durationMs, templatePrompt: BUILT_IN_TEMPLATES.find((t) => t.key === "standup")!.prompt });
console.log("standup sections:", s.sections.map((x) => x.heading).join(", "));
