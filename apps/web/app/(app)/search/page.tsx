import Link from "next/link";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { getProviders } from "@milo/providers";
import { MARK_END, MARK_START, SCOPES, parseScope, searchMeetings } from "@milo/search";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Splits a snippet on the highlight markers so matches render as <mark> without ever injecting HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${MARK_START}[^${MARK_END}]*${MARK_END})`));
  return <>{parts.map((p, i) => p.startsWith(MARK_START) ? <mark key={i} className="rounded bg-amber-400/30 px-0.5 text-text">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string }> }) {
  const { q = "", scope: rawScope } = await searchParams;
  const scope = parseScope(rawScope), query = q.trim();
  const user = await getCurrentUser();
  const res = query ? await searchMeetings(getDb(), getProviders().llm, user.id, { q: query, scope }) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Search</h1>
      <form className="flex flex-wrap gap-2" action="/search">
        <input name="q" defaultValue={query} autoFocus placeholder="Search what was said, meeting titles, or people" className="min-w-0 flex-1 rounded border border-border bg-surface px-3 py-2 text-sm" />
        <select name="scope" defaultValue={scope} className="rounded border border-border bg-surface px-2 py-2 text-sm">
          {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="rounded bg-accent px-4 py-2 text-sm font-medium text-white">Search</button>
      </form>

      {!res && <p className="text-sm text-muted">Search finds the exact moment something was said across your meetings, even when you don&apos;t remember the exact words. Try <Link className="underline" href="/ask">Ask Milo</Link> for questions.</p>}
      {res?.degraded && <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Showing keyword matches only. Meaning-based matching is unavailable right now.</p>}
      {res && res.results.length === 0 && <p className="text-sm text-muted">Nothing found for &ldquo;{query}&rdquo; in {SCOPES.find((s) => s.value === scope)!.label.toLowerCase()}.{scope === "my" && " Try All calls."}</p>}
      <ul className="space-y-4">
        {res?.results.map((m) => (
          <li key={m.meetingId} className="rounded-lg border border-border bg-surface">
            <Link href={`/meetings/${m.meetingId}`} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 hover:bg-bg">
              <span className="font-medium">{m.title}{m.titleMatch && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">title match</span>}</span>
              <span className="shrink-0 text-xs text-muted">{m.createdAt.toLocaleDateString()}{!m.mine && " · teammate"}</span>
            </Link>
            <ul className="divide-y divide-border">
              {m.hits.map((h) => (
                <li key={h.segmentId}>
                  <Link href={`/meetings/${m.meetingId}?t=${h.startMs}`} className="flex gap-3 px-4 py-2.5 text-sm hover:bg-bg">
                    <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted">{formatMs(h.startMs)}</span>
                    <span><span className="mr-2 text-xs font-semibold text-accent">{h.speaker}</span><Snippet text={h.snippet} />
                      {h.via !== "keyword" && <span className="ml-2 text-[11px] text-muted">{h.via === "both" ? "exact + meaning" : "similar meaning"}</span>}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
