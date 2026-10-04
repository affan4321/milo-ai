import type {
  StorageProvider, SttProvider, LlmProvider, CalendarProvider, EmailProvider, CalendarEventOut,
} from "./types";

export class FakeStorage implements StorageProvider {
  private m = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array) { this.m.set(key, body); }
  async get(key: string) { return this.m.get(key) ?? null; }
  async signedUrl(key: string) { return `/fake-storage/${encodeURIComponent(key)}`; }
}

export class FakeStt implements SttProvider {
  async transcribe() {
    const lines = [
      ["Speaker 1", "Thanks everyone for joining. Let's start with the roadmap."],
      ["Speaker 2", "I'll own the calendar integration and ship it by Friday."],
      ["Speaker 1", "Great. Pricing is the open question for next week."],
    ];
    return lines.map(([speakerLabel, text], i) => ({
      speakerLabel, text, startMs: i * 8000, endMs: i * 8000 + 7000,
      words: text.split(" ").map((w, j) => ({ w, s: i * 8000 + j * 300, e: i * 8000 + j * 300 + 280 })),
    }));
  }
}

export class FakeLlm implements LlmProvider {
  async insights() {
    return {
      summary: { sections: [
        { heading: "Overview", bullets: [{ text: "Roadmap kickoff; pricing deferred to next week.", ms: 0 }] },
        { heading: "Decisions", bullets: [{ text: "Calendar integration ships Friday.", ms: 8000 }] },
      ] },
      actionItems: [{ text: "Ship calendar integration", assignee: "Speaker 2", sourceMs: 8000 }],
      chapters: [{ title: "Roadmap", startMs: 0 }, { title: "Pricing", startMs: 16000 }],
    };
  }
  async embed(texts: string[]) { return texts.map(() => new Array(768).fill(0)); }
  async answer() { return { text: "This is a fake answer.", citedIds: [] }; }
}

export class FakeCalendar implements CalendarProvider {
  async listUpcoming(): Promise<CalendarEventOut[]> {
    const t = (h: number) => new Date(Date.now() + h * 3_600_000);
    return [
      { externalId: "fake-1", title: "Weekly product sync", startsAt: t(1), endsAt: t(2),
        attendees: [{ name: "Ada", email: "ada@example.com" }], meetingUrl: "https://meet.google.com/abc-defg-hij", platform: "meet" },
      { externalId: "fake-2", title: "Customer discovery call", startsAt: t(26), endsAt: t(27),
        attendees: [{ email: "lee@customer.com" }], meetingUrl: "https://zoom.us/j/123456789", platform: "zoom" },
    ];
  }
}

export class FakeEmail implements EmailProvider {
  sent: { to: string; subject: string }[] = [];
  async send(a: { to: string; subject: string; html: string }) { this.sent.push({ to: a.to, subject: a.subject }); }
}
