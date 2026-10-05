import Link from "next/link";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { BOT_ACTIVE_STATES } from "@milo/core";
import { botCapacity, SUPPORTED_PLATFORMS } from "@milo/calendar";
import { botStatusText } from "@/lib/bot-status";
import { getDb, calendarConnections, calendarEvents, meetings, botSessions } from "@milo/db";
import { listTeamMeetings } from "@milo/search";
import { RECORD_RULES, SHARE_RULES } from "@/lib/onboarding";
import { getPrefs } from "@/lib/onboarding-state";
import { HomeTabs } from "../home-tabs";
import { AutoRefresh } from "../meetings/[id]/auto-refresh";
import { SendMilo } from "./send-milo";
import { RecordToggle } from "./record-toggle";
import { UploadButton } from "./upload-button";
import { RecentCalls } from "./recent-calls";
import { getCurrentUser } from "@/lib/session";
import { ConnectIcsForm } from "./connect-form";
import { resyncAction } from "./actions";
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CalendarDays, Check, ChevronDown, Mail, RefreshCw, Upload, Users, Video, X } from "lucide-react";
import { Badge, EmptyState, IconTile, Notice, PageHeader, Section } from "@/components/ui";
import { groupByDay, timeLabel, whenLabel } from "@/lib/format";


export const dynamic = "force-dynamic";
const label = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", unknown: "No meeting link" } as const;
const SHOWN_UPCOMING = 6; // the rest sit behind "Show more" so recent calls stay within reach

function greeting(now = new Date()) { const h = now.getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  const db = getDb();
  const first = user.name?.split(" ")[0];
  const actions = <><UploadButton /><SendMilo /></>;
  if ((await searchParams).tab === "team") {
    const team = await listTeamMeetings(db, user.id);
    return (
      <div>
        <PageHeader title="Team calls" description="Meetings your teammates chose to share with the workspace. They also show up in Search and Ask Milo." actions={actions} />
        <HomeTabs active="team" />
        {team.length === 0 ? (
          <EmptyState icon={Users} title="No team calls yet">When a teammate shares a meeting with the team, it appears here, and in search and Ask Milo (Team calls).</EmptyState>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {team.map((m) => (
              <li key={m.id}><Link href={`/meetings/${m.id}`} className="group flex items-center gap-3 p-3 transition-colors hover:bg-raised sm:gap-4 sm:p-4">
                <IconTile icon={Users} />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{m.title}</div><div className="mt-0.5 truncate text-sm text-muted">{m.owner} · {whenLabel(m.createdAt)}</div></div>
                <Badge>Team</Badge>
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-subtle transition-transform sm:block group-hover:translate-x-0.5 group-hover:text-text" />
              </Link></li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const prefs = await getPrefs(user.id);
  const recordLabel = RECORD_RULES.find((r) => r.value === prefs.autoRecordRule)?.label ?? "";
  const shareLabel = SHARE_RULES.find((r) => r.value === prefs.autoShareRule)?.label ?? "";
  const conns = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, user.id));
  const events = conns.length
    ? await db.select().from(calendarEvents)
        .where(and(inArray(calendarEvents.connectionId, conns.map((c) => c.id)), gte(calendarEvents.endsAt, new Date())))
        .orderBy(asc(calendarEvents.startsAt)).limit(50)
    : [];
  const recent = await db.select().from(meetings).where(eq(meetings.ownerId, user.id)).orderBy(desc(meetings.createdAt)).limit(20);
  const live = await db.select({ s: botSessions, title: meetings.title }).from(botSessions)
    .innerJoin(meetings, eq(meetings.id, botSessions.meetingId))
    .where(and(eq(meetings.ownerId, user.id), inArray(botSessions.state, [...BOT_ACTIVE_STATES]))).orderBy(desc(botSessions.createdAt));
  const cap = live.length ? await botCapacity(db) : { alive: 0, busy: 0 };
  const failing = conns.find((c) => c.lastError);
  const lastSync = conns.map((c) => c.lastSyncedAt).filter(Boolean).sort().pop();

  // Only events Milo could actually attend belong in "Upcoming meetings". Reminders, birthdays and other entries with no meeting link
  // are still synced, but they sit in a quiet note below instead of being listed as meetings.
  const isMeeting = (e: (typeof events)[number]) => !!e.meetingUrl && e.platform !== "unknown";
  const upcoming = events.filter(isMeeting);
  const otherEvents = events.filter((e) => !isMeeting(e));
  const canJoin = (platform: string) => (SUPPORTED_PLATFORMS as readonly string[]).includes(platform);

  const eventRow = (e: (typeof events)[number]) => (
    <li key={e.id} className="flex items-center gap-4 px-4 py-3">
      <span className="w-[4.5rem] shrink-0 text-sm font-medium tabular-nums">{timeLabel(e.startsAt)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.title}</div>
        <div className="mt-0.5 text-xs text-muted">{label[e.platform as keyof typeof label] ?? label.unknown}</div>
      </div>
      {canJoin(e.platform) ? <RecordToggle eventId={e.id} record={e.record} /> : <Badge title="Milo can't join this kind of call yet">Not supported yet</Badge>}
    </li>
  );
  const dayGroups = (list: typeof events) => groupByDay(list, (e) => e.startsAt).map((g) => (
    <li key={g.day}>
      <div className="eyebrow border-b border-border bg-raised/60 px-4 py-2">{g.day}</div>
      <ul className="divide-y divide-border">{g.items.map(eventRow)}</ul>
    </li>
  ));

  return (
    <div>
      <PageHeader title={first ? `${greeting()}, ${first}` : greeting()}
        description={upcoming.length ? `${upcoming.length === 50 ? "50+" : upcoming.length} upcoming ${upcoming.length === 1 ? "meeting" : "meetings"} on your calendar. Milo's notes land here when each one ends.` : "Your meetings, recaps and recordings in one place."}
        actions={actions} />
      <HomeTabs active="calls" />
      {live.length > 0 && <AutoRefresh ms={3000} />}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {live.length > 0 && (
            <Section title="Happening now">
              <div className="space-y-2">
                {live.map(({ s, title }) => (
                  <Link key={s.id} href={`/meetings/${s.meetingId}`} className="group flex items-center gap-4 rounded-[14px] border border-accent/40 bg-accent/[0.07] p-4 transition-colors hover:bg-accent/[0.12]">
                    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent text-white">
                      <Bot className="h-[18px] w-[18px]" />
                      <span className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface ${s.state === "recording" ? "animate-pulse bg-danger" : "bg-warn"}`} />
                    </span>
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{title}</div><div className="mt-0.5 text-sm text-muted">{botStatusText(s, cap)}</div></div>
                    <span className="hidden text-sm font-medium text-accent-ink sm:inline">Open</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-accent-ink transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Section>
          )}
          {failing && (
            <Notice icon={AlertTriangle} title="Calendar sync problem">
              {failing.lastError} Showing the last synced events.
              {failing.kind === "google" && <a href="/sign-in" className="link ml-2">Reconnect Google</a>}
            </Notice>
          )}

          <Section title="Upcoming meetings" aside={conns.length > 0 && (
            <form action={resyncAction} className="flex items-center gap-3">
              {lastSync && <span>Synced {timeLabel(lastSync)}</span>}
              <button className="btn btn-secondary btn-sm"><RefreshCw />Sync now</button>
            </form>
          )}>
            {events.length === 0 ? (
              <EmptyState icon={CalendarDays} title={conns.length ? "Nothing coming up" : "No calendar connected"}>
                {conns.length ? "No upcoming meetings in the next two weeks." : "Connect a calendar to see your upcoming meetings and have Milo join them."}
              </EmptyState>
            ) : (
              <div className="card overflow-hidden">
                {upcoming.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted">No meetings with a link coming up. Your calendar is synced.</p>
                ) : (
                  <>
                    <ul>{dayGroups(upcoming.slice(0, SHOWN_UPCOMING))}</ul>
                    {upcoming.length > SHOWN_UPCOMING && (
                      <details className="group border-t border-border">
                        <summary className="flex list-none items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-accent-ink hover:bg-raised [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">Show {upcoming.length - SHOWN_UPCOMING} more</span><span className="hidden group-open:inline">Show fewer</span>
                          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                        </summary>
                        <ul className="border-t border-border">{dayGroups(upcoming.slice(SHOWN_UPCOMING))}</ul>
                      </details>
                    )}
                  </>
                )}
                {otherEvents.length > 0 && (
                  <details className="group border-t border-border">
                    <summary className="flex list-none items-center gap-2 px-4 py-2.5 text-xs text-muted hover:text-text [&::-webkit-details-marker]:hidden">
                      <Check className="h-3.5 w-3.5 text-success" />
                      <span className="min-w-0 flex-1 truncate">{otherEvents.length} other calendar {otherEvents.length === 1 ? "event" : "events"} synced · no meeting link, so Milo skips {otherEvents.length === 1 ? "it" : "them"}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="divide-y divide-border border-t border-border">
                      {otherEvents.map((e) => (
                        <li key={e.id} className="flex items-center gap-4 px-4 py-2 text-sm text-muted">
                          <span className="w-32 shrink-0 tabular-nums">{whenLabel(e.startsAt)}</span><span className="truncate">{e.title}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </Section>

          <Section title="Recent calls" aside={recent.length > 0 && <span>{recent.length === 20 ? "Latest 20" : `${recent.length} ${recent.length === 1 ? "call" : "calls"}`}</span>}>
            {recent.length === 0 ? (
              <EmptyState icon={Video} title="No calls yet">Send Milo to a meeting or upload a recording, and the transcript, summary and action items will show up here.</EmptyState>
            ) : (
              <RecentCalls items={recent.map((m) => ({
                id: m.id, title: m.title, upload: m.captureSource === "upload",
                sub: `${whenLabel(m.createdAt)} · ${m.captureSource === "upload" ? "Uploaded" : m.captureSource === "bot" ? "Recorded by Milo" : m.captureSource}`,
                status: m.status === "ready" ? "ready" as const : m.status === "failed" ? "failed" as const : "processing" as const,
              }))} />
            )}
          </Section>
        </div>

        <aside className="grid grid-cols-1 content-start items-start gap-4 md:grid-cols-2 xl:grid-cols-1 xl:pt-9">
          <div className="card p-5">
            <div className="eyebrow mb-3">Meeting preferences</div>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-3">
                <IconTile icon={CalendarClock} size="sm" tone={prefs.autoRecordRule === "none" ? "neutral" : "accent"} />
                <div><div className="font-medium">{prefs.autoRecordRule === "none" ? "Not joining automatically" : "Joins automatically"}</div>
                  <div className="text-muted">{prefs.autoRecordRule === "none" ? "Milo only joins when you send it." : recordLabel}</div></div>
              </li>
              <li className="flex gap-3">
                <IconTile icon={Mail} size="sm" tone={prefs.autoShareRule === "none" ? "neutral" : "accent"} />
                <div><div className="font-medium">{prefs.autoShareRule === "none" ? "Recaps aren't emailed" : "Recaps are emailed"}</div>
                  <div className="text-muted">{prefs.autoShareRule === "none" ? "No one receives them." : `To ${shareLabel.toLowerCase()}`}</div></div>
              </li>
            </ul>
            <Link href="/customize" className="link mt-4 inline-flex items-center gap-1 text-sm">Edit recording rules<ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          {conns.length > 0 && (
            <div className="card flex items-center gap-3 p-4 text-sm">
              <IconTile icon={failing ? X : Check} size="sm" tone={failing ? "warn" : "success"} />
              <div className="min-w-0 flex-1"><div className="font-medium">{conns.length} {conns.length === 1 ? "calendar" : "calendars"} connected</div>
                <Link href="/settings" className="text-xs text-muted hover:text-text">Manage in Settings</Link></div>
            </div>
          )}
          <ConnectIcsForm />
        </aside>
      </div>
    </div>
  );
}
