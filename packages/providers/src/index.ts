import * as F from "./fakes";
import { LocalStorage } from "./storage/local";
import { GeminiLlm } from "./llm/gemini";
export * from "./types";
export * from "./fakes";

/** Provider selection by env. Anything unset or "fake" resolves to the fixture implementation. */
const pick = (k: string) => process.env[k] ?? "fake";
export function getProviders() {
  const llm = pick("LLM_PROVIDER") === "gemini"
    ? new GeminiLlm({ apiKey: process.env.GEMINI_API_KEY ?? "", model: process.env.GEMINI_MODEL })
    : new F.FakeLlm();
  return {
    storage: new LocalStorage(), stt: new F.FakeStt(), llm,
    calendar: new F.FakeCalendar(), email: new F.FakeEmail(),
    selected: { storage: pick("STORAGE_PROVIDER"), stt: pick("STT_PROVIDER"), llm: pick("LLM_PROVIDER") },
  };
}
export { IcsCalendar, parseIcs } from "./calendar/ics";
export { GoogleCalendar, GoogleAuthError, parseGoogleEvents } from "./calendar/google";
export { LocalStorage } from "./storage/local";
export { GeminiLlm } from "./llm/gemini";
export { normalizeInsights, normalizeSummary, extractJson } from "./llm/normalize";
