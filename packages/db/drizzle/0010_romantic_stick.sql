ALTER TABLE "ask_threads" DROP CONSTRAINT "ask_threads_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ask_threads" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "ask_threads" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_threads" ADD CONSTRAINT "ask_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
