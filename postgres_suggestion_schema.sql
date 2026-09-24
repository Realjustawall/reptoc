-- PostgreSQL schema for the recommendation engine.
-- Enable UUID extension if not exists
-- Table for tracking all user events
CREATE TABLE IF NOT EXISTS suggestion_user_events (
  id TEXT PRIMARY KEY DEFAULT ('sue-' || md5(random()::text || clock_timestamp()::text)),
  user_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'impression', 'click', 'chapter_complete', etc.
  read_time INT DEFAULT 0,
  chapter INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Table for storing user vectors (Long-term, Mid-term, Negative)
CREATE TABLE IF NOT EXISTS suggestion_user_profiles (
  user_id TEXT PRIMARY KEY,
  long_term_vector JSONB DEFAULT '{}',
  mid_term_vector JSONB DEFAULT '{}',
  negative_vector JSONB DEFAULT '{}',
  author_affinity JSONB DEFAULT '{}',
  genre_affinity JSONB DEFAULT '{}',
  churn_risk FLOAT DEFAULT 0.1,
  profile_version INT DEFAULT 0,
  preferred_length INT DEFAULT 1500,
  explore_willingness FLOAT DEFAULT 1.0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

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

-- Table for Novel Features and Vectors
CREATE TABLE IF NOT EXISTS suggestion_novel_vectors (
  novel_id TEXT PRIMARY KEY,
  vector JSONB DEFAULT '{}', -- contains Genre, Theme, Emotion, etc.
  genre TEXT NOT NULL,
  author_id TEXT,
  avg_chapter_length INT DEFAULT 1500,
  quality_ai_writing FLOAT DEFAULT 0.5,
  quality_ai_hook FLOAT DEFAULT 0.5,
  quality_ai_character FLOAT DEFAULT 0.5,
  quality_ai_world FLOAT DEFAULT 0.5,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Table for Novel Stats (Counts and Engagement)
CREATE TABLE IF NOT EXISTS suggestion_novel_stats (
  novel_id TEXT PRIMARY KEY,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  description_reads INT DEFAULT 0,
  ch1_complete INT DEFAULT 0,
  ch5_complete INT DEFAULT 0,
  ch10_complete INT DEFAULT 0,
  follows INT DEFAULT 0,
  comments INT DEFAULT 0,
  shares INT DEFAULT 0,
  views INT DEFAULT 0,
  bookmarks INT DEFAULT 0,
  library_adds INT DEFAULT 0,
  returns_tomorrow INT DEFAULT 0,
  fast_exits INT DEFAULT 0,
  drops_ch1 INT DEFAULT 0,
  hides INT DEFAULT 0,
  unfollows INT DEFAULT 0,
  reports INT DEFAULT 0,
  engagement_24h INT DEFAULT 0,
  engagement_7d INT DEFAULT 0,
  ctr_global FLOAT DEFAULT 0.05,
  r5_global FLOAT DEFAULT 0.2,
  r10_global FLOAT DEFAULT 0.1,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE suggestion_user_events ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE suggestion_user_events ALTER COLUMN novel_id TYPE TEXT USING novel_id::text;
ALTER TABLE suggestion_user_profiles ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS profile_version INT DEFAULT 0;
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS author_affinity JSONB DEFAULT '{}';
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS genre_affinity JSONB DEFAULT '{}';
ALTER TABLE suggestion_user_profiles ADD COLUMN IF NOT EXISTS churn_risk FLOAT DEFAULT 0.1;
ALTER TABLE suggestion_novel_vectors ALTER COLUMN novel_id TYPE TEXT USING novel_id::text;
ALTER TABLE suggestion_novel_vectors ALTER COLUMN author_id TYPE TEXT USING author_id::text;
ALTER TABLE suggestion_novel_stats ALTER COLUMN novel_id TYPE TEXT USING novel_id::text;

CREATE INDEX IF NOT EXISTS idx_suggestion_user_events_user_created ON suggestion_user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_user_events_novel_created ON suggestion_user_events (novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_vectors_genre ON suggestion_novel_vectors (genre);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_vectors_author ON suggestion_novel_vectors (author_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_novel_stats_engagement ON suggestion_novel_stats (engagement_24h DESC, engagement_7d DESC);
CREATE INDEX IF NOT EXISTS idx_suggestion_recommendation_logs_user_created ON suggestion_recommendation_logs (user_id, created_at DESC);
