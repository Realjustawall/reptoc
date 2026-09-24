-- ✅ AI Settings Management Table
-- `users.id` is TEXT throughout this schema (ids look like `u-<uuid>` and
-- `admin-master-<uuid>`), so a UUID foreign key here can never be implemented:
-- PostgreSQL rejects the table with "foreign key constraint cannot be
-- implemented". The referencing column must match the referenced type.
CREATE TABLE IF NOT EXISTS ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Default AI Settings
INSERT INTO ai_settings (setting_key, setting_value, updated_at)
VALUES (
  'ai_config',
  jsonb_build_object(
    'enabled', true,
    'gemini_api_key', '',
    'openai_api_key', '',
    'groq_api_key', '',
    'detection_enabled', false,
    'detection_provider', 'gemini',
    'detection_model', 'gemini-2.5-flash',
    'detection_base_prompt', 'Assess whether this novel excerpt is substantially AI-generated. Return only JSON with aiScore (0-100), confidence (0-100), and summary.',
    'daily_quota_per_user', 50,
    'system_daily_quota', 10000,
    'button_visible', true,
    'jailbreak_detection_enabled', true,
    'max_context_length', 1000,
    'max_prompt_length', 2000,
    'rate_limit_requests', 5,
    'rate_limit_window_minutes', 15
  ),
  NOW()
)
ON CONFLICT (setting_key) DO NOTHING;

-- Track AI usage per user per day (existing table, just ensure indexes)
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage(date);

-- Create abuse_logs index if not exists
CREATE INDEX IF NOT EXISTS idx_abuse_logs_user_type ON abuse_logs(user_id, abuse_type, created_at);
