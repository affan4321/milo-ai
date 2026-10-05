ALTER TABLE "transcript_segments" ADD COLUMN "embedding_model" text;
--> statement-breakpoint
-- Every vector stored before this column existed came from Gemini.
UPDATE "transcript_segments" SET "embedding_model" = 'gemini-embedding-001' WHERE "embedding" IS NOT NULL AND "embedding_model" IS NULL;
