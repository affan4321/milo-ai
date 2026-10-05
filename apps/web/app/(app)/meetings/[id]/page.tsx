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
import { VisibilityToggle } from "./visibility-toggle";
import { AddToPlaylist } from "./add-to-playlist";
import { listPlaylists } from "@milo/playlists";
import { listClips, listHighlights } from "@milo/sharing";
import { AutoRefresh } from "./auto-refresh";
import { retryStageAction } from "./actions";
import { AlertTriangle, CalendarDays, ChevronLeft, Clock, RefreshCw, Users } from "lucide-react";
import { Notice, Working } from "@/components/ui";
import { whenLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
const STAGE_LABEL: Record<string, string> = { media: "Preparing recording", transcription: "Transcribing" };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const tParam = Number((await searchParams).t);
  const initialSeekMs = Number.isFinite(tParam) && tParam >= 0 ? Math.round(tParam) : undefined; // from a search result or an Ask citation
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
  const media = stage("media"), tr = stage("transcription"), ins = stage("intelligence"), idx = stage("indexing");
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
  const myPlaylists = (await listPlaylists(db, user.id)).map((p) => ({ id: p.id, name: p.name }));
  const clipRows = transcriptReady ? await listClips(db, id) : [];
  const clipViews = clipRows.map((c) => ({
    id: c.id, startMs: c.startMs, endMs: c.endMs, title: c.title, status: c.status, error: c.error,
    token: c.share && !c.share.revokedAt && (!c.share.expiresAt || c.share.expiresAt > new Date()) ? c.share.token : null, views: c.share?.views ?? 0,
  }));
  const clipsBusy = clipRows.some((c) => c.status === "pending");
  const hlViews = hls.map((h) => ({ id: h.id, startMs: h.startMs, endMs: h.endMs, note: h.note, source: h.source, createdBy: h.createdBy }));

  const failedCard = (s: typeof media, title: string) => s && (
    <Notice tone="danger" icon={AlertTriangle} title={`${title} failed`} action={
      <form action={async () => { "use server"; await retryStageAction(id, s.stage); }}><button className="btn btn-secondary btn-sm"><RefreshCw />Retry</button></form>
    }>{s.error ?? "Something went wrong."}</Notice>
  );

  return (
    <div className="space-y-6">
      {(busy || botActive || awaitingHandOver || clipsBusy) && <AutoRefresh ms={botActive || awaitingHandOver ? 3000 : 2000} />}
      <header>
        <Link href="/home" className="-ml-1 mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ChevronLeft className="h-4 w-4" />Home</Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{meeting.title}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-subtle" />{whenLabel(meeting.createdAt)}</span>
              {rec?.durationMs ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-subtle" />{formatMs(rec.durationMs)}</span> : null}
              {spk.length ? <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-subtle" />{spk.length} {spk.length === 1 ? "speaker" : "speakers"}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><VisibilityToggle meetingId={id} visibility={meeting.visibility} />{transcriptReady && <AddToPlaylist meetingId={id} playlists={myPlaylists} />}</div>
        </div>
      </header>

      {bot && !rec && (
        <div className={`rounded-[14px] border p-5 text-sm ${bot.state === "failed" ? "border-danger/30 bg-danger/[0.07]" : "border-accent/40 bg-accent/[0.07]"}`}>
          <div className="flex items-center gap-2.5 text-base font-medium">
            {botActive && <span className={`h-2.5 w-2.5 rounded-full ${bot.state === "recording" ? "animate-pulse bg-danger" : "bg-warn"}`} />}
            {bot.state === "failed" ? BOT_STATE_TEXT.failed : botStatusText(bot, cap)}
          </div>
          {bot.state === "failed" && (
            <>
              <p className="mt-2">{botReasonText(bot.reason)}</p>
              <p className="mt-1 text-muted">Nothing was recorded. You can <Link href="/home" className="link">upload a recording of this meeting</Link> instead.</p>
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
      {media && media.status !== "done" && media.status !== "failed" && <Working title={`${STAGE_LABEL.media}…`}>The player appears as soon as this finishes.</Working>}

      {playable && transcriptReady && (
        <MeetingView meetingId={id} mediaUrl={`/api/media/${rec!.id}`} isVideo={rec!.playableKey!.endsWith(".mp4")}
          speakers={spk.map((s) => ({ id: s.id, name: s.displayName ?? s.label, talkTimeMs: s.talkTimeMs })).sort((a, b) => b.talkTimeMs - a.talkTimeMs)}
          segments={segs.map((s) => ({ ...s, speakerId: s.speakerId ?? "" }))}
          chapters={chs.map((c) => ({ id: c.id, title: c.title, startMs: c.startMs }))}
          actionItems={items.map((a) => ({ id: a.id, text: a.text, assignee: a.assignee, done: a.done, sourceMs: a.sourceMs })).sort((a, b) => (a.sourceMs ?? 0) - (b.sourceMs ?? 0))}
          templates={templateOpts} summaries={Object.fromEntries(sums.map((x) => [x.templateKey, x.content]))}
          initialSeekMs={initialSeekMs} playlists={myPlaylists} highlights={hlViews} clips={clipViews} durationMs={rec!.durationMs ?? 0}
          defaultTemplate={prefs?.defaultTemplate ?? DEFAULT_TEMPLATE} insights={ins ? { status: ins.status, error: ins.error } : null} />
      )}

      {transcriptReady && idx?.status === "failed" && (
        <Notice icon={AlertTriangle} title="Search indexing failed" action={
          <form action={async () => { "use server"; await retryStageAction(id, "indexing"); }}><button className="btn btn-secondary btn-sm"><RefreshCw />Retry</button></form>
        }>This meeting won&apos;t show up in meaning-based search or Ask yet. {idx.error} The transcript, playback and summary still work.</Notice>
      )}

      {playable && !transcriptReady && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {rec!.playableKey!.endsWith(".mp4")
            ? <video src={`/api/media/${rec!.id}`} controls preload="metadata" className="aspect-video w-full rounded-[14px] bg-black shadow-pop" />
            : <audio src={`/api/media/${rec!.id}`} controls className="w-full" />}
          <div>
            {tr?.status === "failed" ? failedCard(tr, STAGE_LABEL.transcription!) : <Working title={`${STAGE_LABEL.transcription}…`}>The transcript will appear here.</Working>}
          </div>
        </div>
      )}
    </div>
  );
}
