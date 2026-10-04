import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex, vector, customType,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ref = (name: string) => uuid(name).notNull();

// ---- identity ----
export const users = pgTable("users", {
  id: id(), email: text("email").notNull().unique(), name: text("name"), image: text("image"), createdAt: createdAt(),
});
export const workspaces = pgTable("workspaces", { id: id(), name: text("name").notNull(), createdAt: createdAt() });
export const memberships = pgTable("memberships", {
  id: id(), userId: ref("user_id").references(() => users.id, { onDelete: "cascade" }),
  workspaceId: ref("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
}, (t) => [uniqueIndex("memberships_uq").on(t.userId, t.workspaceId)]);
export const preferences = pgTable("preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  autoRecordRule: text("auto_record_rule").notNull().default("all"), // all | external | none
  autoShareRule: text("auto_share_rule").notNull().default("attendees"),
  defaultTemplate: text("default_template").notNull().default("general"),
  jobFunction: text("job_function"),
  accountChosen: boolean("account_chosen").notNull().default(false),
  calendarStepDone: boolean("calendar_step_done").notNull().default(false),
  prefsStepDone: boolean("prefs_step_done").notNull().default(false),
  accountType: text("account_type").notNull().default("team"), // personal | team
  consentAcknowledgedAt: timestamp("consent_acknowledged_at", { withTimezone: true }),
  consentMessage: boolean("consent_message").notNull().default(true),
  onboarded: boolean("onboarded").notNull().default(false),
});

// ---- calendar ----
export const calendarConnections = pgTable("calendar_connections", {
  id: id(), userId: ref("user_id").references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // google | ics
  icsUrl: text("ics_url"), refreshToken: text("refresh_token"), lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
});
export const calendarEvents = pgTable("calendar_events", {
  id: id(), connectionId: ref("connection_id").references(() => calendarConnections.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(), title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  attendees: jsonb("attendees").$type<{ name?: string; email: string }[]>().notNull().default([]),
  meetingUrl: text("meeting_url"), platform: text("platform").notNull().default("unknown"),
  record: boolean("record").notNull().default(true),
}, (t) => [uniqueIndex("cal_events_uq").on(t.connectionId, t.externalId)]);

// ---- meetings ----
export const meetings = pgTable("meetings", {
  id: id(), ownerId: ref("owner_id").references(() => users.id),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  calendarEventId: uuid("calendar_event_id").references(() => calendarEvents.id),
  title: text("title").notNull(), startedAt: timestamp("started_at", { withTimezone: true }),
  status: text("status").notNull().default("scheduled"), captureSource: text("capture_source").notNull().default("upload"),
  createdAt: createdAt(),
});
export const botSessions = pgTable("bot_sessions", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("scheduled"), reason: text("reason"),
  startedAt: timestamp("started_at", { withTimezone: true }),
});
export const recordings = pgTable("recordings", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  rawKey: text("raw_key"), playableKey: text("playable_key"), audioKey: text("audio_key"), sidecarKey: text("sidecar_key"),
  durationMs: integer("duration_ms"),
});
export const participants = pgTable("participants", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  name: text("name").notNull(), email: text("email"), joinedMs: integer("joined_ms"), leftMs: integer("left_ms"),
});
export const speakers = pgTable("speakers", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  label: text("label").notNull(), participantId: uuid("participant_id").references(() => participants.id),
  displayName: text("display_name"), talkTimeMs: integer("talk_time_ms").notNull().default(0),
});
export const transcriptSegments = pgTable("transcript_segments", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  speakerId: uuid("speaker_id").references(() => speakers.id),
  startMs: integer("start_ms").notNull(), endMs: integer("end_ms").notNull(), text: text("text").notNull(),
  words: jsonb("words").$type<{ w: string; s: number; e: number }[]>(),
  tsv: tsvector("tsv"), embedding: vector("embedding", { dimensions: 768 }),
}, (t) => [index("seg_meeting_idx").on(t.meetingId, t.startMs)]);

// ---- intelligence ----
export const templates = pgTable("templates", {
  id: id(), key: text("key").notNull().unique(), name: text("name").notNull(),
  prompt: text("prompt").notNull(), builtIn: boolean("built_in").notNull().default(true),
  ownerId: uuid("owner_id").references(() => users.id),
});
export const summaries = pgTable("summaries", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  templateKey: text("template_key").notNull(),
  content: jsonb("content").$type<{ sections: { heading: string; bullets: { text: string; ms?: number }[] }[] }>().notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("summaries_uq").on(t.meetingId, t.templateKey)]);
export const actionItems = pgTable("action_items", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  text: text("text").notNull(), assignee: text("assignee"), due: timestamp("due", { withTimezone: true }),
  done: boolean("done").notNull().default(false), sourceMs: integer("source_ms"),
});
export const chapters = pgTable("chapters", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  title: text("title").notNull(), startMs: integer("start_ms").notNull(),
});

// ---- sharing ----
export const highlights = pgTable("highlights", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(), endMs: integer("end_ms").notNull(), note: text("note"),
  createdBy: text("created_by"), source: text("source").notNull(), // live_button | chat_command | after
});
export const clips = pgTable("clips", {
  id: id(), meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms").notNull(), endMs: integer("end_ms").notNull(), title: text("title"), storageKey: text("storage_key"),
});
export const shares = pgTable("shares", {
  id: id(), token: text("token").notNull().unique(), targetType: text("target_type").notNull(), targetId: ref("target_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  views: integer("views").notNull().default(0),
});
export const playlists = pgTable("playlists", {
  id: id(), workspaceId: ref("workspace_id").references(() => workspaces.id), name: text("name").notNull(),
});
export const playlistItems = pgTable("playlist_items", {
  id: id(), playlistId: ref("playlist_id").references(() => playlists.id, { onDelete: "cascade" }),
  meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
  startMs: integer("start_ms"), endMs: integer("end_ms"), position: integer("position").notNull().default(0),
});
export const alerts = pgTable("alerts", {
  id: id(), workspaceId: ref("workspace_id").references(() => workspaces.id), keyword: text("keyword").notNull(),
});
export const alertHits = pgTable("alert_hits", {
  id: id(), alertId: ref("alert_id").references(() => alerts.id, { onDelete: "cascade" }),
  meetingId: ref("meeting_id").references(() => meetings.id, { onDelete: "cascade" }), segmentId: uuid("segment_id"),
});
export const askThreads = pgTable("ask_threads", {
  id: id(), userId: ref("user_id").references(() => users.id), scope: text("scope").notNull().default("my"), createdAt: createdAt(),
});
export const askMessages = pgTable("ask_messages", {
  id: id(), threadId: ref("thread_id").references(() => askThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(), content: text("content").notNull(), citedSegmentIds: jsonb("cited_segment_ids").$type<string[]>().default([]),
});

// ---- pipeline ----
export const pipelineStage = pgTable("pipeline_stage", {
  id: id(), recordingId: ref("recording_id").references(() => recordings.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("stage_uq").on(t.recordingId, t.stage)]);
