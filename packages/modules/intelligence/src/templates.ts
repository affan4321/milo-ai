export interface BuiltInTemplate { key: string; name: string; prompt: string }

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { key: "general", name: "General",
    prompt: "Sections: Overview (2-3 bullets), Key points, Decisions made, Open questions. Keep bullets short and concrete." },
  { key: "sales-discovery", name: "Sales discovery",
    prompt: "Sections: Prospect background, Pain points, Current solution, Needs and goals, Budget and timeline, Decision process and stakeholders, Objections, Next steps. Skip any section the transcript does not cover." },
  { key: "one-on-one", name: "1:1",
    prompt: "Sections: Updates and wins, Blockers and concerns, Feedback given, Career and growth, Agreed follow-ups." },
  { key: "standup", name: "Standup",
    prompt: "One section per person who spoke, headed by their name, with bullets for: done, doing next, blocked. Add a final section for team-wide blockers." },
  { key: "customer-call", name: "Customer call",
    prompt: "Sections: Customer context, Issues raised, Feature requests, Sentiment and risks, Commitments we made, Follow-ups." },
  { key: "user-interview", name: "User interview",
    prompt: "Sections: Participant background, Behaviours and workflows, Pain points, Needs and desires, Notable quotes (use the speaker's exact words), Insights." },
  { key: "chronological", name: "Chronological",
    prompt: "Sections in time order, one per major topic, each headed by a short topic title. Bullets describe what was discussed and concluded in that stretch." },
];

export const DEFAULT_TEMPLATE = "general";
export const builtIn = (key: string) => BUILT_IN_TEMPLATES.find((t) => t.key === key);

/** Default summary template for a job function chosen in onboarding. */
export function templateForRole(role: string | null | undefined): string {
  switch (role) {
    case "Sales": return "sales-discovery";
    case "Customer Success": return "customer-call";
    case "Product / Design": return "user-interview";
    default: return DEFAULT_TEMPLATE;
  }
}
