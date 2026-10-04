ALTER TABLE "bot_sessions" ADD COLUMN "meeting_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "platform" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "organizer_email" text;