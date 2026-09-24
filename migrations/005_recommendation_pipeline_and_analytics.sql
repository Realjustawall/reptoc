ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS author_affinity JSONB DEFAULT '{}';
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS genre_affinity JSONB DEFAULT '{}';
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS churn_risk FLOAT DEFAULT 0.1;

CREATE TABLE IF NOT EXISTS suggestion_recommendation_logs (
  id TEXT PRIMARY KEY DEFAULT ('srl-' || md5(random()::text || clock_timestamp()::text)),
  user_id TEXT NOT NULL,
  session_id TEXT DEFAULT 'anonymous',
  candidate_count INT DEFAULT 0,
  returned_count INT DEFAULT 0,
  ranking_version TEXT DEFAULT 'v1',
  model_version TEXT DEFAULT 'v1',
  items JSONB DEFAULT '[]',
  surface TEXT DEFAULT '0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_suggestion_user_events_user_created ON suggestion_user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_user_events_novel_created ON suggestion_user_events (novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_vectors_genre ON suggestion_novel_vectors (genre);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_vectors_author ON suggestion_novel_vectors (author_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_stats_engagement ON suggestion_novel_stats (engagement_24h DESC, engagement_7d DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_recommendation_logs_user_created ON suggestion_recommendation_logs (user_id, created_at DESC);
