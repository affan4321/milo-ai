-- Search: keyword (full-text) and semantic (vector) indexes on transcript segments.
CREATE INDEX IF NOT EXISTS transcript_segments_tsv_idx ON transcript_segments USING gin (tsv);
CREATE INDEX IF NOT EXISTS transcript_segments_embedding_idx ON transcript_segments USING hnsw (embedding vector_cosine_ops);
-- Meetings created before workspaces were attached get their owner's workspace.
UPDATE meetings m SET workspace_id = (SELECT mb.workspace_id FROM memberships mb WHERE mb.user_id = m.owner_id LIMIT 1)
WHERE m.workspace_id IS NULL AND EXISTS (SELECT 1 FROM memberships mb WHERE mb.user_id = m.owner_id);
