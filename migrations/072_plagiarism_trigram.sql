-- migrations/072_plagiarism_trigram.sql
-- ✅ FIX B-3: Add trigram index for fast plagiarism detection.
--
-- Previously, plagiarism detection loaded 80 full chapters into memory and
-- compared them word-by-word. Now we use PostgreSQL's pg_trgm extension
-- with a GIN index, which performs the comparison in the database and
-- searches ALL chapters.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Set similarity threshold (0.3 = 30% similar is enough to be considered
-- a potential match). This can be tuned per-environment.
SET pg_trgm.similarity_threshold = 0.3;

-- GIN index for fast trigram similarity searches on chapter content.
CREATE INDEX IF NOT EXISTS idx_chapters_content_trgm
  ON chapters USING gin (content gin_trgm_ops);

-- Also add a GIN index on novel descriptions for cross-novel similarity.
CREATE INDEX IF NOT EXISTS idx_novels_description_trgm
  ON novels USING gin (description gin_trgm_ops);
