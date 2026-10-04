import type {
  SttProvider, LlmProvider, CalendarProvider, EmailProvider, CalendarEventOut,
} from "./types";

const NAMES = ["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4", "Speaker 5", "Speaker 6", "Speaker 7", "Speaker 8"];
const SENTENCES = [
  "Thanks everyone for joining, let's start with the roadmap.",
  "I'll own the calendar integration and ship it by Friday.",
  "Pricing is still the open question for next week.",
  "Can we get the customer feedback in before we decide?",
  "The onboarding numbers look better than last quarter.",
  "I think we should cut scope on the reporting work.",
  "Let's circle back on hiring once the budget is confirmed.",
  "Agreed, I'll write that up and share it after the call.",
];

/** Deterministic fake transcript spanning the whole recording: up to 8 speakers taking turns every ~6s. */
export class FakeStt implements SttProvider {
  async transcribe(input: { durationMs: number }) {
    const out = [];
    const turn = 6000;
    for (let i = 0, t = 0; t + 1000 < input.durationMs; i++, t += turn) {
      const text = `${SENTENCES[i % SENTENCES.length]} (${i + 1})`;
      const end = Math.min(t + turn - 500, input.durationMs);
      const step = Math.max(1, Math.floor((end - t) / text.split(" ").length));
      out.push({
        speakerLabel: NAMES[(i * 3 + (i >> 2)) % NAMES.length]!, startMs: t, endMs: end, text,
        words: text.split(" ").map((w, j) => ({ w, s: t + j * step, e: t + (j + 1) * step - 20 })),
      });
    }
    return out;
  }
}

/** Deterministic fake: derives bullets, chapters and action items from the transcript itself, so it behaves sensibly at any length. */
export class FakeLlm implements LlmProvider {
  private lines(transcript: string) {
    return transcript.split("\n").flatMap((l) => {
      const m = /^\[t=(\d+)\] ([^:]+): (.*)$/.exec(l);
      return m ? [{ t: Number(m[1]), who: m[2]!, text: m[3]! }] : [];
    });
  }
  async summarize(i: { transcript: string; durationMs: number }) {
    const lines = this.lines(i.transcript);
    const pick = (n: number) => Array.from({ length: Math.min(n, lines.length) }, (_, k) => lines[Math.floor((k * lines.length) / Math.min(n, lines.length))]!);
    return {
      sections: [
        { heading: "Overview", bullets: pick(3).map((l) => ({ text: `${l.who}: ${l.text}`, ms: l.t * 1000 })) },
        { heading: "Key moments", bullets: pick(6).slice(1).map((l) => ({ text: l.text, ms: l.t * 1000 })) },
      ],
    };
  }
  async insights(i: { transcript: string; templatePrompt: string; durationMs: number }) {
    const lines = this.lines(i.transcript);
    const n = Math.max(1, Math.min(8, Math.ceil(i.durationMs / 300_000)));
    const chapters = Array.from({ length: n }, (_, k) => ({ title: `Topic ${k + 1}`, startMs: Math.floor((k * i.durationMs) / n) }));
    const actionItems = lines.filter((l) => /\bI'll\b|\bwill\b/i.test(l.text)).slice(0, 8).map((l) => ({ text: l.text, assignee: l.who, sourceMs: l.t * 1000 }));
    return { summary: await this.summarize(i), actionItems, chapters };
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
