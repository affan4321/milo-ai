import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMs } from "@milo/core";
import { getDb } from "@milo/db";
import { buildShareView, countView, resolveShare } from "@milo/sharing";
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-lg font-semibold text-accent">Milo</div>
        <h1 className="text-xl font-semibold">Clip unavailable</h1>
        <p className="text-muted">{GONE[look.reason]}</p>
      </main>
    );
  }
  void countView(db, look.share.id).catch(() => {});
  const { clip, meeting } = look;
  const view = await buildShareView(db, clip);
  const title = clip.title || meeting.title;
  const { recap } = view;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-5 py-8">
      <header>
        <div className="text-sm font-semibold text-accent">Milo</div>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">From &ldquo;{meeting.title}&rdquo; · {formatMs(clip.endMs - clip.startMs)} clip</p>
      </header>
      <SharePlayer src={`/api/share/${token}/media`} isVideo={clip.storageKey!.endsWith(".mp4")} lines={view.transcript} />
      {(recap.topic || recap.points.length > 0 || recap.actionItems.length > 0) && (
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Catch-up</h2>
          {recap.topic && <p className="mb-2 text-sm">This part of the meeting was about <strong>{recap.topic}</strong>.</p>}
          {recap.points.length > 0 && <ul className="mb-2 list-disc space-y-1 pl-5 text-sm">{recap.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {recap.actionItems.length > 0 && (
            <div className="text-sm"><div className="font-medium">Follow-ups mentioned</div>
              <ul className="list-disc space-y-1 pl-5">{recap.actionItems.map((a, i) => <li key={i}>{a.assignee ? `${a.assignee}: ` : ""}{a.text}</li>)}</ul></div>
          )}
        </section>
      )}
      <footer className="text-center text-xs text-muted">Shared with Milo, an AI meeting notetaker.</footer>
    </main>
  );
}
