import * as F from "./fakes";
import { LocalStorage } from "./storage/local";
import { GeminiLlm } from "./llm/gemini";
import { GeminiStt } from "./stt/gemini";
export * from "./types";
export * from "./fakes";

/** Provider selection by env. Anything unset or "fake" resolves to the fixture implementation. */
const pick = (k: string) => process.env[k] ?? "fake";
const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export function getProviders() {
  const llm = pick("LLM_PROVIDER") === "gemini"
    ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL, fallbackModels: list(process.env.GEMINI_FALLBACK_MODELS), embedModels: list(process.env.GEMINI_EMBED_MODELS) })
    : new F.FakeLlm();
  const stt = pick("STT_PROVIDER") === "gemini"
    ? new GeminiStt({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_STT_MODEL ?? process.env.GEMINI_MODEL, fallbackModels: list(process.env.GEMINI_STT_FALLBACK_MODELS) })
    : new F.FakeStt();
  return {
    storage: new LocalStorage(), stt, llm,
    calendar: new F.FakeCalendar(), email: new F.FakeEmail(),
    selected: { storage: pick("STORAGE_PROVIDER"), stt: pick("STT_PROVIDER"), llm: pick("LLM_PROVIDER") },
  };
}
export { IcsCalendar, parseIcs } from "./calendar/ics";
export { GoogleCalendar, GoogleAuthError, parseGoogleEvents } from "./calendar/google";
export { LocalStorage } from "./storage/local";
export { GeminiLlm } from "./llm/gemini";
export { normalizeInsights, normalizeSummary, extractJson } from "./llm/normalize";
export { GeminiStt } from "./stt/gemini";
export { normalizeChunk, parseClock } from "./stt/normalize";
export { geminiEmbed, normalize, EMBED_DIMS } from "./llm/embed";
export { fakeEmbedding } from "./fakes";
