ALTER TABLE "clips" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;