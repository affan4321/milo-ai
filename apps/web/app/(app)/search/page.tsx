import Link from "next/link";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { getProviders } from "@milo/providers";
import { MARK_END, MARK_START, SCOPES, parseScope, searchMeetings } from "@milo/search";
import { getCurrentUser } from "@/lib/session";
import { AlertTriangle, ArrowRight, Search as SearchIcon, SearchX, Sparkles } from "lucide-react";
import { Badge, EmptyState, Notice, PageHeader } from "@/components/ui";
import { dayLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Splits a snippet on the highlight markers so matches render as <mark> without ever injecting HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(new RegExp(`(${MARK_START}[^${MARK_END}]*${MARK_END})`));
  return <>{parts.map((p, i) => p.startsWith(MARK_START) ? <mark key={i} className="rounded bg-warn/25 px-0.5 font-medium text-text">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string }> }) {
  const { q = "", scope: rawScope } = await searchParams;
  const scope = parseScope(rawScope), query = q.trim();
  const user = await getCurrentUser();
  const res = query ? await searchMeetings(getDb(), getProviders().llm, user.id, { q: query, scope }) : null;

  const hits = res?.results.reduce((n, m) => n + m.hits.length, 0) ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" description="Find the exact moment something was said, even when you don't remember the exact words." />
      <form className="card flex flex-wrap items-center gap-2 p-2 shadow-pop" action="/search">
        <label className="flex min-w-0 flex-[1_1_16rem] items-center gap-2.5 pl-3">
          <SearchIcon className="h-[18px] w-[18px] shrink-0 text-subtle" />
          <input name="q" defaultValue={query} autoFocus placeholder="Search what was said, meeting titles, or people" aria-label="Search" className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle" />
        </label>
        <select name="scope" defaultValue={scope} aria-label="Which meetings to search" className="field border-transparent bg-raised">
          {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn btn-primary">Search</button>
      </form>

      <div className="mt-8 space-y-4">
        {!res && (
          <EmptyState icon={SearchIcon} title="Search across every meeting" action={<Link href="/ask" className="btn btn-secondary btn-sm"><Sparkles />Ask Milo a question instead</Link>}>
            Type a word, a name or a rough idea. Results jump straight to that moment in the recording.
          </EmptyState>
        )}
        {res?.degraded && <Notice icon={AlertTriangle}>Showing keyword matches only. Meaning-based matching is unavailable right now.</Notice>}
        {res && res.results.length === 0 && (
          <EmptyState icon={SearchX} title={`Nothing found for “${query}”`}>Searched {SCOPES.find((s) => s.value === scope)!.label.toLowerCase()}.{scope === "my" && " Try All calls."}</EmptyState>
        )}
        {res && res.results.length > 0 && <p className="text-sm text-muted">{hits} {hits === 1 ? "moment" : "moments"} in {res.results.length} {res.results.length === 1 ? "meeting" : "meetings"}</p>}
        <ul className="space-y-4">
          {res?.results.map((m) => (
            <li key={m.meetingId} className="card overflow-hidden">
              <Link href={`/meetings/${m.meetingId}`} className="group flex items-center justify-between gap-3 border-b border-border bg-raised/50 px-4 py-3 transition-colors hover:bg-raised">
                <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{m.title}</span>{m.titleMatch && <Badge tone="accent">Title match</Badge>}{!m.mine && <Badge>Teammate</Badge>}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">{dayLabel(m.createdAt)}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
              <ul className="divide-y divide-border">
                {m.hits.map((h) => (
                  <li key={h.segmentId}>
                    <Link href={`/meetings/${m.meetingId}?t=${h.startMs}`} className="flex gap-3 px-4 py-3 text-sm leading-relaxed transition-colors hover:bg-raised">
                      <span className="mt-0.5 h-fit shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">{formatMs(h.startMs)}</span>
                      <span className="min-w-0"><span className="mr-2 text-xs font-semibold text-accent-ink">{h.speaker}</span><Snippet text={h.snippet} />
                        {h.via !== "keyword" && <span className="ml-2 whitespace-nowrap text-[11px] text-subtle">{h.via === "both" ? "exact + meaning" : "similar meaning"}</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
