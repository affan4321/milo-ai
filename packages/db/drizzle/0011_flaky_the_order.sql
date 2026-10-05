ALTER TABLE "alert_hits" ALTER COLUMN "segment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_hits" ADD COLUMN "start_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_hits" ADD COLUMN "snippet" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_hits" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recap_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "recap_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "alert_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "default_visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "record_platforms" jsonb DEFAULT '["meet","zoom","teams"]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "playlists" ADD CONSTRAINT "playlists_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_hits_uq" ON "alert_hits" USING btree ("alert_id","segment_id");