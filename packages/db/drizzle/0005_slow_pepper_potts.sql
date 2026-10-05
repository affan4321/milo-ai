ALTER TABLE "bot_sessions" ADD COLUMN "recording_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "participant_count" integer;