import type { InsightsOut, SummaryOut } from "../types";

/** Models sometimes wrap JSON in code fences or add prose. Pull out the first JSON object. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("model did not return JSON");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Seconds from the model -> integer ms clamped into the recording. Anything unusable becomes undefined, never a bad seek target. */
function ms(t: unknown, durationMs: number): number | undefined {
  const n = typeof t === "number" ? t : typeof t === "string" ? Number(t) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 1000), durationMs) : undefined;
}

export function normalizeSummary(raw: any, durationMs: number): SummaryOut {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 12).flatMap((s: any) => {
    const heading = str(s?.heading, 120);
    const bullets = (Array.isArray(s?.bullets) ? s.bullets : []).slice(0, 25).flatMap((b: any) => {
      const text = str(typeof b === "string" ? b : b?.text, 600);
      return text ? [{ text, ms: ms(b?.t, durationMs) }] : [];
    });
    return heading && bullets.length ? [{ heading, bullets }] : [];
  });
  if (!sections.length) throw new Error("model returned an empty summary");
  return { sections };
}

export function normalizeInsights(raw: any, durationMs: number): InsightsOut {
  const actionItems = (Array.isArray(raw?.actionItems) ? raw.actionItems : []).slice(0, 50).flatMap((a: any) => {
    const text = str(a?.text, 400);
    return text ? [{ text, assignee: str(a?.assignee, 80) || undefined, sourceMs: ms(a?.t, durationMs) }] : [];
  });
  const seen = new Set<number>();
  const chapters = (Array.isArray(raw?.chapters) ? raw.chapters : []).slice(0, 40).flatMap((c: any) => {
    const title = str(c?.title, 120), startMs = ms(c?.t, durationMs);
    return title && startMs !== undefined ? [{ title, startMs }] : [];
  }).sort((a: any, b: any) => a.startMs - b.startMs).filter((c: any) => !seen.has(c.startMs) && !!seen.add(c.startMs));
  return { summary: normalizeSummary(raw?.summary, durationMs), actionItems, chapters };
}
