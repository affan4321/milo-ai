CREATE TABLE IF NOT EXISTS "bot_workers" (
	"id" text PRIMARY KEY NOT NULL,
	"busy" boolean DEFAULT false NOT NULL,
	"session_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
