import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { buildShareView, countView, resolveShare } from "@milo/sharing";
import { Clock, Link2Off } from "lucide-react";
import { Logo } from "@/components/ui";
import { SharePlayer } from "./player";

export const dynamic = "force-dynamic";
// A shared clip is for the people it was sent to, not for search engines.
export const metadata: Metadata = { title: "Shared clip · Milo", robots: { index: false, follow: false } };

const GONE: Record<string, string> = {
  revoked: "The person who shared this clip has turned off the link.",
  expired: "This link has expired.",
  not_ready: "This clip is still being prepared. Try again in a moment.",
  not_found: "This link doesn't match a clip.",
};

/** Public: no sign-in, no app chrome. Shows the clip, the words spoken in it, and a short recap for someone who wasn't there. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const look = await resolveShare(db, token);
  if (!look.ok && look.reason === "not_found") notFound(); // an unknown token is simply a 404
  if (!look.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <Logo />
        <span className="mt-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-raised text-muted"><Link2Off className="h-6 w-6" /></span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Clip unavailable</h1>
        <p className="mt-2 text-muted">{GONE[look.reason]}</p>
      </main>
    );
  }
  void countView(db, look.share.id).catch(() => {});
  const { clip, meeting } = look;
  const view = await buildShareView(db, clip);
  const title = clip.title || meeting.title;
  const { recap } = view;
  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-surface"><div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5"><Logo size="sm" /><span className="text-xs text-muted">Shared clip</span></div></div>
      <main className="mx-auto max-w-5xl animate-rise space-y-6 px-5 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-muted">From &ldquo;{meeting.title}&rdquo;<span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-subtle" />{formatMs(clip.endMs - clip.startMs)} clip</span></p>
        </header>
        <SharePlayer src={`/api/share/${token}/media`} isVideo={clip.storageKey!.endsWith(".mp4")} lines={view.transcript} />
        {(recap.topic || recap.points.length > 0 || recap.actionItems.length > 0) && (
          <section className="card p-6">
            <h2 className="eyebrow mb-3">Catch-up</h2>
            {recap.topic && <p className="mb-3 leading-relaxed">This part of the meeting was about <strong className="font-semibold">{recap.topic}</strong>.</p>}
            {recap.points.length > 0 && <ul className="mb-4 space-y-2 text-sm leading-relaxed">{recap.points.map((p, i) => <li key={i} className="flex gap-2.5"><span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" />{p}</li>)}</ul>}
            {recap.actionItems.length > 0 && (
              <div className="border-t border-border pt-4 text-sm"><div className="mb-2 font-semibold">Follow-ups mentioned</div>
                <ul className="space-y-2 leading-relaxed">{recap.actionItems.map((a, i) => <li key={i} className="flex gap-2.5"><span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" /><span>{a.assignee && <span className="font-medium">{a.assignee}: </span>}{a.text}</span></li>)}</ul></div>
            )}
          </section>
        )}
        <footer className="pt-4 text-center text-xs text-subtle">Shared with Milo, an AI meeting notetaker.</footer>
      </main>
    </div>
  );
}
