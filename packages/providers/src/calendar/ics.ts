import ical from "node-ical";
import { detectMeeting } from "@milo/core";
import type { CalendarEventOut, CalendarProvider } from "../types";

const asText = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as { val: unknown }).val) : "");

function attendeesOf(ev: any): { name?: string; email: string }[] {
  const list = ev.attendee ? (Array.isArray(ev.attendee) ? ev.attendee : [ev.attendee]) : [];
  return list.flatMap((a: any) => {
    const val = typeof a === "string" ? a : String(a?.val ?? "");
    const email = val.replace(/^mailto:/i, "").trim();
    if (!email.includes("@")) return [];
    const name = typeof a === "object" ? a?.params?.CN : undefined;
    return [{ email, ...(name ? { name } : {}) }];
  });
}

function organizerOf(ev: any): string | null {
  const o = ev.organizer; const val = typeof o === "string" ? o : o?.val;
  return typeof val === "string" && val.includes("@") ? val.replace(/^mailto:/i, "").trim() : null;
}

/** Pure parser: ICS text -> events starting inside [from, to], recurring events expanded. */
export function parseIcs(text: string, from: Date, to: Date): CalendarEventOut[] {
  const out: CalendarEventOut[] = [];
  for (const item of Object.values(ical.sync.parseICS(text)) as any[]) {
    if (item.type !== "VEVENT" || !item.start) continue;
    const durMs = item.end ? +item.end - +item.start : 3_600_000;
    const link = detectMeeting([asText(item.url), asText(item.location), asText(item.description), asText(item["GOOGLE-CONFERENCE"])].join(" "));
    const base = {
      title: asText(item.summary) || "(no title)", attendees: attendeesOf(item),
      organizerEmail: organizerOf(item), meetingUrl: link?.url ?? null, platform: link?.platform ?? ("unknown" as const),
    };
    const starts: { at: Date; key: string }[] = [];
    if (item.rrule) {
      const exdates = new Set(Object.values(item.exdate ?? {}).map((d: any) => +d));
      for (const d of item.rrule.between(from, to, true)) if (!exdates.has(+d)) starts.push({ at: d, key: `${item.uid}@${d.toISOString()}` });
    } else if (item.start >= from && item.start <= to) starts.push({ at: item.start, key: String(item.uid) });
    for (const s of starts) out.push({ ...base, externalId: s.key, startsAt: s.at, endsAt: new Date(+s.at + durMs) });
  }
  return out.sort((a, b) => +a.startsAt - +b.startsAt);
}

export class IcsCalendar implements CalendarProvider {
  constructor(private url: string, private windowDays = 14) {}
  async listUpcoming() {
    const res = await fetch(this.url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`ICS fetch failed: HTTP ${res.status}`);
    const now = new Date();
    return parseIcs(await res.text(), now, new Date(+now + this.windowDays * 86_400_000));
  }
}
