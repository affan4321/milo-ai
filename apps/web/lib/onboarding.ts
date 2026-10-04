export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
]);
export const isPersonalEmail = (email: string) => PERSONAL_DOMAINS.has(email.split("@")[1]?.toLowerCase() ?? "");

export const RECORD_RULES = [
  { value: "all", label: "All meetings in my calendar" },
  { value: "external", label: "Only meetings with people outside my company" },
  { value: "owned", label: "Only meetings I organize" },
  { value: "none", label: "Nothing automatically" },
] as const;
export const SHARE_RULES = [
  { value: "attendees", label: "All attendees" },
  { value: "internal", label: "Attendees in my company" },
  { value: "none", label: "No one" },
] as const;
export const JOB_FUNCTIONS = ["Sales", "Customer Success", "Product / Design", "Marketing", "Operations", "Engineering", "Other"] as const;

export type OnboardingStep = "account" | "calendar" | "preferences" | "role";
export const STEP_ORDER: OnboardingStep[] = ["account", "calendar", "preferences", "role"];

export interface PrefsInput { record: string; share: string; consent: boolean }
export function validatePreferences(i: PrefsInput): string | null {
  if (!RECORD_RULES.some((r) => r.value === i.record)) return "Choose which meetings Milo should record.";
  if (!SHARE_RULES.some((r) => r.value === i.share)) return "Choose who recaps are shared with.";
  // Auto-recording without acknowledging consent responsibility is not allowed.
  if (i.record !== "none" && !i.consent) return "Please confirm you will collect attendee consent before continuing.";
  return null;
}

/** First step the user still has to do, given their saved state. Steps that don't apply are skipped. */
export function nextStep(s: { email: string; accountChosen: boolean; calendarDone: boolean; prefsDone: boolean; jobFunction: string | null }): OnboardingStep | "done" {
  if (isPersonalEmail(s.email) && !s.accountChosen) return "account";
  if (!s.calendarDone) return "calendar";
  if (!s.prefsDone) return "preferences";
  if (!s.jobFunction) return "role";
  return "done";
}
