import * as F from "./fakes";
export * from "./types";
export * from "./fakes";

/** Provider selection by env. Real implementations are added per build step; until then everything resolves to fakes. */
const pick = (k: string) => process.env[k] ?? "fake";
export function getProviders() {
  return {
    storage: new F.FakeStorage(), stt: new F.FakeStt(), llm: new F.FakeLlm(),
    calendar: new F.FakeCalendar(), email: new F.FakeEmail(),
    selected: { storage: pick("STORAGE_PROVIDER"), stt: pick("STT_PROVIDER"), llm: pick("LLM_PROVIDER") },
  };
}
export { IcsCalendar, parseIcs } from "./calendar/ics";
export { GoogleCalendar, GoogleAuthError, parseGoogleEvents } from "./calendar/google";
