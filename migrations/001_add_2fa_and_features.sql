-- Migration: Add 2FA, Support Fields, AI Quota, and Security Improvements
-- Date: 2026-07-05
-- Run against the PostgreSQL database

-- ============================================================================
-- 1. Add 2FA columns to users table
-- ============================================================================
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS twofa_secret TEXT,
ADD COLUMN IF NOT EXISTS twofa_backup_codes JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS twofa_setup_token TEXT,
ADD COLUMN IF NOT EXISTS twofa_setup_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verified_author BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS verified_role BOOLEAN DEFAULT false;

-- ============================================================================
-- 2. Add OTP Sessions table (for temporary OTP validation during login)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.otp_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_otp_sessions_user_id ON public.otp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_token ON public.otp_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires ON public.otp_sessions(expires_at);

-- ============================================================================
-- 3. Update Support Tickets table
-- ============================================================================
ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS reporter_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS reporter_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS reporter_phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS assigned_to TEXT,
ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;

-- ============================================================================
-- 4. AI Usage Tracking table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  request_count INTEGER DEFAULT 1,
  total_tokens INTEGER DEFAULT 0,
  total_cost DECIMAL(10, 4) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON public.ai_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON public.ai_usage(date);

-- ============================================================================
-- 5. Jailbreak/Abuse Patterns table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.abuse_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  abuse_type TEXT NOT NULL, -- 'jailbreak_attempt', 'rate_limit_abuse', 'malware_upload'
  description TEXT,
  severity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  action_taken TEXT, -- 'logged', 'warned', 'suspended', 'banned'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_logs_user ON public.abuse_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_abuse_logs_type ON public.abuse_logs(abuse_type);

-- ============================================================================
-- 6. Upload Audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.upload_audits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_hash TEXT UNIQUE,
  mime_type TEXT,
  scan_status TEXT DEFAULT 'pending', -- 'pending', 'clean', 'infected', 'error'
  scan_result TEXT,
  quarantined BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_audits_user ON public.upload_audits(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_audits_hash ON public.upload_audits(file_hash);

-- ============================================================================
-- 7. Contest Submissions with atomic safety
-- ============================================================================
ALTER TABLE public.contest_submissions
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS contest_status_at_submit TEXT;

-- ============================================================================
-- 8. Forum Categories cache table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.forum_categories (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 9. Session Management improvements
-- ============================================================================
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS remember_me BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
ADD COLUMN IF NOT EXISTS user_agent TEXT,
ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Create index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);

-- ============================================================================
-- 10. Security Logs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.security_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL, -- 'login_success', 'login_failure', 'privilege_change', etc.
  description TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'critical'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user ON public.security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_event ON public.security_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_created ON public.security_logs(created_at);

-- ============================================================================
-- Cleanup: Delete expired OTP sessions (run periodically)
-- ============================================================================
DELETE FROM public.otp_sessions WHERE expires_at < NOW();
DELETE FROM public.sessions WHERE expires_at < NOW();
