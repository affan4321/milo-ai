import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, or } from "drizzle-orm";
import { BOT_ACTIVE_STATES, BOT_STATE_TEXT, botReasonText, formatMs, type BotState } from "@milo/core";
import { botCapacity } from "@milo/calendar";
import { botStatusText } from "@/lib/bot-status";
import { getDb, botSessions, meetings, recordings, speakers, transcriptSegments, pipelineStage, summaries, actionItems, chapters, templates, preferences } from "@milo/db";
import { BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE } from "@milo/intelligence";
import { getCurrentUser } from "@/lib/session";
import { MeetingView } from "./meeting-view";
import { LivePanel } from "./live-panel";
import { listClips, listHighlights } from "@milo/sharing";
import { AutoRefresh } from "./auto-refresh";
import { retryStageAction } from "./actions";

export const dynamic = "force-dynamic";
const STAGE_LABEL: Record<string, string> = { media: "Preparing recording", transcription: "Transcribing" };

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = getDb();
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, id), eq(meetings.ownerId, user.id)));
  if (!meeting) notFound();
  const [rec] = await db.select().from(recordings).where(eq(recordings.meetingId, id));
  const [bot] = await db.select().from(botSessions).where(eq(botSessions.meetingId, id));
  const cap = bot && bot.state === "scheduled" ? await botCapacity(db) : { alive: 0, busy: 0 };
  const botActive = !!bot && (BOT_ACTIVE_STATES as string[]).includes(bot.state);
  // The bot has left but its recording hasn't arrived yet: nothing is "busy" in the pipeline, so keep refreshing until it lands.
  const awaitingHandOver = !!bot && !rec && bot.state === "left";
  const stages = rec ? await db.select().from(pipelineStage).where(eq(pipelineStage.recordingId, rec.id)) : [];
  const stage = (s: string) => stages.find((x) => x.stage === s);
  const media = stage("media"), tr = stage("transcription"), ins = stage("intelligence");
  const busy = stages.some((s) => s.status === "pending" || s.status === "running");

  const playable = media?.status === "done" && rec?.playableKey;
  const transcriptReady = tr?.status === "done";
  const [spk, segs] = transcriptReady
    ? await Promise.all([
        db.select().from(speakers).where(eq(speakers.meetingId, id)),
        db.select({ id: transcriptSegments.id, speakerId: transcriptSegments.speakerId, startMs: transcriptSegments.startMs, endMs: transcriptSegments.endMs, text: transcriptSegments.text })
          .from(transcriptSegments).where(eq(transcriptSegments.meetingId, id)).orderBy(asc(transcriptSegments.startMs)),
      ])
    : [[], []];

  const [prefs] = await db.select().from(preferences).where(eq(preferences.userId, user.id));
  const [sums, items, chs, custom] = transcriptReady
    ? await Promise.all([
        db.select().from(summaries).where(eq(summaries.meetingId, id)),
        db.select().from(actionItems).where(eq(actionItems.meetingId, id)),
        db.select().from(chapters).where(eq(chapters.meetingId, id)).orderBy(asc(chapters.startMs)),
        db.select().from(templates).where(and(eq(templates.builtIn, false), or(eq(templates.ownerId, user.id)))),
      ])
    : [[], [], [], []];
  const templateOpts = [...BUILT_IN_TEMPLATES.map((t) => ({ key: t.key, name: t.name })), ...custom.map((t) => ({ key: t.key, name: t.name }))];

  const hls = await listHighlights(db, id);
  const clipRows = transcriptReady ? await listClips(db, id) : [];
  const clipViews = clipRows.map((c) => ({
    id: c.id, startMs: c.startMs, endMs: c.endMs, title: c.title, status: c.status, error: c.error,
    token: c.share && !c.share.revokedAt && (!c.share.expiresAt || c.share.expiresAt > new Date()) ? c.share.token : null, views: c.share?.views ?? 0,
  }));
  const clipsBusy = clipRows.some((c) => c.status === "pending");
  const hlViews = hls.map((h) => ({ id: h.id, startMs: h.startMs, endMs: h.endMs, note: h.note, source: h.source, createdBy: h.createdBy }));

  const failedCard = (s: typeof media, title: string) => s && (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
      <div className="font-medium">{title} failed</div>
      <p className="mt-1 text-muted">{s.error ?? "Something went wrong."}</p>
      <form action={async () => { "use server"; await retryStageAction(id, s.stage); }}>
        <button className="mt-3 rounded border border-border px-3 py-1.5">Retry</button>
      </form>
    </div>
  );

  return (
    <div className="space-y-6">
      {(busy || botActive || awaitingHandOver || clipsBusy) && <AutoRefresh ms={botActive || awaitingHandOver ? 3000 : 2000} />}
      <div>
        <Link href="/home" className="text-sm text-muted hover:text-text">← Home</Link>
        <h1 className="mt-1 text-2xl font-semibold">{meeting.title}</h1>
        <p className="text-sm text-muted">
          {meeting.createdAt.toLocaleString()}{rec?.durationMs ? ` · ${formatMs(rec.durationMs)}` : ""}{spk.length ? ` · ${spk.length} speakers` : ""}
        </p>
      </div>

      {bot && !rec && (
        <div className={`rounded-lg border p-5 text-sm ${bot.state === "failed" ? "border-red-500/40 bg-red-500/10" : "border-accent/40 bg-accent/10"}`}>
          <div className="flex items-center gap-2 font-medium">
            {botActive && <span className={`h-2.5 w-2.5 rounded-full ${bot.state === "recording" ? "animate-pulse bg-red-500" : "bg-amber-500"}`} />}
            {bot.state === "failed" ? BOT_STATE_TEXT.failed : botStatusText(bot, cap)}
          </div>
          {bot.state === "failed" && (
            <>
              <p className="mt-2">{botReasonText(bot.reason)}</p>
              <p className="mt-1 text-muted">Nothing was recorded. You can <Link href="/home" className="underline">upload a recording of this meeting</Link> instead.</p>
            </>
          )}
          {bot.state === "left" && <p className="mt-2 text-muted">Processing the recording… this page updates when it's ready.</p>}
          {bot.state === "waiting_room" && <p className="mt-2 text-muted">Ask the host to admit &ldquo;Milo AI Notetaker&rdquo; from the waiting room.</p>}
        </div>
      )}

      {bot && !rec && bot.state === "recording" && (
        <LivePanel meetingId={id} startedAtMs={bot.recordingStartedAt ? +bot.recordingStartedAt : null} participants={bot.participantCount} highlights={hlViews} />
      )}

      {media?.status === "failed" && failedCard(media, STAGE_LABEL.media!)}
      {media && media.status !== "done" && media.status !== "failed" && (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">{STAGE_LABEL.media}… the player appears as soon as this finishes.</div>
      )}

      {playable && transcriptReady && (
        <MeetingView meetingId={id} mediaUrl={`/api/media/${rec!.id}`} isVideo={rec!.playableKey!.endsWith(".mp4")}
          speakers={spk.map((s) => ({ id: s.id, name: s.displayName ?? s.label, talkTimeMs: s.talkTimeMs })).sort((a, b) => b.talkTimeMs - a.talkTimeMs)}
          segments={segs.map((s) => ({ ...s, speakerId: s.speakerId ?? "" }))}
          chapters={chs.map((c) => ({ id: c.id, title: c.title, startMs: c.startMs }))}
          actionItems={items.map((a) => ({ id: a.id, text: a.text, assignee: a.assignee, done: a.done, sourceMs: a.sourceMs })).sort((a, b) => (a.sourceMs ?? 0) - (b.sourceMs ?? 0))}
          templates={templateOpts} summaries={Object.fromEntries(sums.map((x) => [x.templateKey, x.content]))}
          highlights={hlViews} clips={clipViews} durationMs={rec!.durationMs ?? 0}
          defaultTemplate={prefs?.defaultTemplate ?? DEFAULT_TEMPLATE} insights={ins ? { status: ins.status, error: ins.error } : null} />
      )}

      {playable && !transcriptReady && (
        <div className="grid gap-6 lg:grid-cols-2">
          {rec!.playableKey!.endsWith(".mp4")
            ? <video src={`/api/media/${rec!.id}`} controls preload="metadata" className="w-full rounded-lg bg-black" />
            : <audio src={`/api/media/${rec!.id}`} controls className="w-full" />}
          <div>
            {tr?.status === "failed" ? failedCard(tr, STAGE_LABEL.transcription!) : (
              <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">{STAGE_LABEL.transcription}… the transcript will appear here.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
