CREATE TABLE IF NOT EXISTS "usage_counters" (
	"key" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_counters_uq" ON "usage_counters" USING btree ("key","day");