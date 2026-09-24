import { runOptionalSchemaQueries } from "./dbSchema";

let analyticsTablesReady: Promise<void> | null = null;

export async function ensureAnalyticsTables() {
  if (!analyticsTablesReady) {
    analyticsTablesReady = runOptionalSchemaQueries([`
      CREATE TABLE IF NOT EXISTS analytics_logs (
        id TEXT PRIMARY KEY,
        novel_id TEXT,
        chapter_id TEXT,
        viewer_id TEXT,
        action_type TEXT NOT NULL,
        read_seconds INTEGER DEFAULT 0,
        scroll_percentage NUMERIC DEFAULT 0,
        source TEXT,
        ip_hash TEXT,
        country_code TEXT,
        country_name TEXT,
        region_name TEXT,
        city_name TEXT,
        is_vpn BOOLEAN DEFAULT false,
        device_type TEXT,
        device_os TEXT,
        device_browser TEXT,
        user_agent_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
      )
    `,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS chapter_id TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS viewer_id TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS read_seconds INTEGER DEFAULT 0`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS scroll_percentage NUMERIC DEFAULT 0`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS ip_hash TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS country_code TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS country_name TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS region_name TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS city_name TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS device_type TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS device_os TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS device_browser TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS user_agent_hash TEXT`,
    `ALTER TABLE analytics_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL`,
    `
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        novel_id TEXT,
        chapter_id TEXT,
        read_seconds INTEGER DEFAULT 0,
        scroll_percentage NUMERIC DEFAULT 0,
        source TEXT,
        foreground_active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
      )
    `,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS foreground_active BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS country_code TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS country_name TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS region_name TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS city_name TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS device_type TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS device_os TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS device_browser TEXT`,
    `ALTER TABLE reading_sessions ADD COLUMN IF NOT EXISTS user_agent_hash TEXT`,
    `CREATE TABLE IF NOT EXISTS novel_unique_views (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      viewer_key TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
      PRIMARY KEY (novel_id, viewer_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_novel_unique_views_user ON novel_unique_views(user_id, novel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_unique_view_lookup ON analytics_logs(novel_id, viewer_id, action_type, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_anon_view_lookup ON analytics_logs(novel_id, ip_hash, user_agent_hash, action_type, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_chapter_view_lookup ON analytics_logs(novel_id, chapter_id, viewer_id, action_type, created_at DESC)`])
      .catch((error) => {
        analyticsTablesReady = null;
        throw error;
      });
  }
  return analyticsTablesReady;
}
