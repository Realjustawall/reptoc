import { db } from "../postgres";
import { sanitizePlainText } from "./content";
import { reportSchemaGapOnce, runOptionalSchemaQueries } from "./dbSchema";

let opsTablesReady: Promise<void> | null = null;

export async function ensureOperationalTables() {
  if (!opsTablesReady) {
    opsTablesReady = (async () => {
      await runOptionalSchemaQueries([`
        CREATE TABLE IF NOT EXISTS content_moderation_scans (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          novel_id TEXT,
          chapter_id TEXT,
          scanner_id TEXT,
          risk_score INTEGER DEFAULT 0,
          nsfw_score INTEGER DEFAULT 0,
          violence_score INTEGER DEFAULT 0,
          ai_score INTEGER DEFAULT 0,
          plagiarism_score INTEGER DEFAULT 0,
          profanity_score INTEGER DEFAULT 0,
          warning_mismatch_score INTEGER DEFAULT 0,
          quality_score INTEGER DEFAULT 100,
          flags JSONB DEFAULT '[]'::jsonb,
          summary TEXT,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE content_moderation_scans ADD COLUMN IF NOT EXISTS profanity_score INTEGER DEFAULT 0`,
      `ALTER TABLE content_moderation_scans ADD COLUMN IF NOT EXISTS warning_mismatch_score INTEGER DEFAULT 0`,
      `ALTER TABLE content_moderation_scans ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 100`,
      `
        CREATE TABLE IF NOT EXISTS editor_assignments (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
          chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
          editor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          status TEXT DEFAULT 'assigned',
          due_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          UNIQUE (target_type, target_id, editor_id)
        )
      `, `
        CREATE TABLE IF NOT EXISTS editor_inline_comments (
          id TEXT PRIMARY KEY,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          anchor_text TEXT,
          start_offset INTEGER DEFAULT 0,
          end_offset INTEGER DEFAULT 0,
          comment TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          thread_id TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS chapter_versions (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          novel_id TEXT REFERENCES novels(id) ON DELETE CASCADE,
          changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          reason TEXT,
          title TEXT,
          content TEXT,
          author_notes_top TEXT,
          author_notes_bottom TEXT,
          status TEXT,
          scheduled_at TIMESTAMPTZ,
          chapter_number INTEGER DEFAULT 1,
          word_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS editor_review_checklists (
          id TEXT PRIMARY KEY,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          checklist JSONB DEFAULT '{}'::jsonb,
          status TEXT DEFAULT 'in_review',
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          UNIQUE (chapter_id, reviewer_id)
        )
      `, `
        CREATE TABLE IF NOT EXISTS editor_threads (
          id TEXT PRIMARY KEY,
          novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
          chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
          subject TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS editor_thread_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES editor_threads(id) ON DELETE CASCADE,
          sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS ticket_internal_notes (
          id TEXT PRIMARY KEY,
          ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          note TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS backup_schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          frequency TEXT DEFAULT 'daily',
          enabled BOOLEAN DEFAULT true,
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible'`,
      `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS moderator_note TEXT`,
      `ALTER TABLE chapter_comments ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible'`,
      `ALTER TABLE chapter_comments ADD COLUMN IF NOT EXISTS moderator_note TEXT`,
      `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible'`,
      `ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS moderator_note TEXT`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'visible'`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS editor_checklist JSONB DEFAULT '{}'::jsonb`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS editorial_status TEXT DEFAULT 'draft'`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS assigned_editor_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
      `ALTER TABLE chapters ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())`,
      `ALTER TABLE editor_messages ADD COLUMN IF NOT EXISTS thread_id TEXT`,
      `
        CREATE TABLE IF NOT EXISTS security_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          event_type TEXT NOT NULL,
          description TEXT,
          ip_address TEXT,
          ip TEXT,
          user_agent TEXT,
          severity TEXT DEFAULT 'info',
          details JSONB DEFAULT '{}'::jsonb,
          timestamp TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS ip TEXT`,
      `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS ip_address TEXT`,
      `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb`,
      `ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ`,
      `
        CREATE TABLE IF NOT EXISTS premium_orders (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          months INTEGER DEFAULT 1,
          amount NUMERIC DEFAULT 0,
          currency TEXT DEFAULT 'usd',
          status TEXT DEFAULT 'pending',
          provider_session_id TEXT,
          provider_payload TEXT,
          paid_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS star_transactions (
          id TEXT PRIMARY KEY,
          from_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          novel_id TEXT REFERENCES novels(id) ON DELETE SET NULL,
          amount INTEGER DEFAULT 0,
          message TEXT,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          target_snapshot JSONB,
          reason TEXT NOT NULL,
          details TEXT,
          status TEXT DEFAULT 'OPEN',
          priority TEXT DEFAULT 'normal',
          moderator_note TEXT,
          assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
          action_taken TEXT,
          resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          resolved_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_snapshot JSONB`, `
        CREATE TABLE IF NOT EXISTS report_events (
          id TEXT PRIMARY KEY,
          report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,
          actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          note TEXT,
          created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        )
      `]);
    })().catch((error) => {
      // Do not clear the memo: retrying the same refused DDL on every request
      // just repeats the failure. Report it once and let the column-filtered
      // reads carry on; `npm run db:migrate` is the supported fix.
      reportSchemaGapOnce("operations tables", error);
    });
  }
  return opsTablesReady;
}

function countMatches(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function stripHtml(value: unknown) {
  return sanitizePlainText(String(value || "").replace(/<[^>]+>/g, " "), 200000).replace(/\s+/g, " ").trim();
}

function similarity(a: string, b: string) {
  const aWords = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  const bWords = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  if (!aWords.size || !bWords.size) return 0;
  let overlap = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) overlap += 1;
  });
  return Math.round((overlap / Math.min(aWords.size, bWords.size)) * 100);
}

export async function analyzeContentText(textValue: unknown, targetId?: string) {
  await ensureOperationalTables();
  const text = stripHtml(textValue);
  const lower = text.toLowerCase();
  const nsfwTerms = ["explicit", "porn", "nude", "sexual", "erotic", "rape"];
  const violenceTerms = ["gore", "torture", "decapitat", "massacre", "suicide", "murder", "bloodbath"];
  const aiTerms = ["as an ai", "language model", "i cannot", "in conclusion", "delve into", "tapestry"];
  const profanityTerms = ["fuck", "shit", "bitch", "asshole", "slut", "whore"];

  const nsfwScore = Math.min(100, countMatches(lower, nsfwTerms) * 22);
  const violenceScore = Math.min(100, countMatches(lower, violenceTerms) * 18);
  const profanityScore = Math.min(100, countMatches(lower, profanityTerms) * 20);
  const repeatedPhrases = (lower.match(/\b(\w{5,})\b(?=.*\b\1\b)/g) || []).length;
  const aiScore = Math.min(100, countMatches(lower, aiTerms) * 24 + (repeatedPhrases > 35 ? 15 : 0));

  let plagiarismScore = 0;
  try {
    // ✅ FIX B-3: Use PostgreSQL trigram similarity. This searches ALL
    // chapters using the GIN index, returns only the top 5 most similar,
    // and computes similarity server-side. Requires migration 072.
    const { rows } = await db.query(
      `SELECT id,
              (similarity(content, $1) * 100)::int AS sim_score
         FROM chapters
        WHERE id <> COALESCE($2, '')
          AND content IS NOT NULL
          AND content % $1
        ORDER BY sim_score DESC
        LIMIT 5`,
      [text, targetId || ""]
    );
    if (rows.length > 0) {
      plagiarismScore = Math.max(...rows.map((r: any) => r.sim_score));
    }
  } catch (err: any) {
    // pg_trgm extension not installed — fall back to old behavior.
    if (String(err?.code || "") === "42704") {
      console.warn("[plagiarism] pg_trgm extension not installed, falling back to limited scan");
      const { rows } = await db.query(
        `SELECT id, content FROM chapters WHERE id <> COALESCE($1, '') AND content IS NOT NULL ORDER BY created_at DESC LIMIT 80`,
        [targetId || ""]
      );
      for (const row of rows) {
        plagiarismScore = Math.max(plagiarismScore, similarity(text, stripHtml(row.content)));
      }
    } else {
      console.warn("[plagiarism] trigram query failed:", err?.message || err);
    }
  }

  const sentenceCount = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const averageSentenceLength = wordCount / sentenceCount;
  const qualityScore = Math.max(0, Math.min(100, 100 - (averageSentenceLength > 45 ? 20 : 0) - (wordCount < 150 ? 15 : 0) - (repeatedPhrases > 35 ? 15 : 0)));
  const warningMismatchScore = Math.max(
    nsfwScore >= 40 ? 50 : 0,
    violenceScore >= 40 ? 50 : 0,
    profanityScore >= 40 ? 30 : 0
  );
  const flags = [
    nsfwScore >= 40 ? "NSFW" : "",
    violenceScore >= 40 ? "Violence" : "",
    aiScore >= 45 ? "AI-like" : "",
    plagiarismScore >= 55 ? "Possible plagiarism" : "",
    profanityScore >= 40 ? "Profanity" : "",
    warningMismatchScore >= 50 ? "Content warning mismatch" : "",
    qualityScore < 70 ? "Quality review" : ""
  ].filter(Boolean);
  const riskScore = Math.min(100, Math.max(nsfwScore, violenceScore, aiScore, plagiarismScore, profanityScore, warningMismatchScore, 100 - qualityScore));
  return {
    riskScore,
    nsfwScore,
    violenceScore,
    aiScore,
    plagiarismScore,
    duplicateContentScore: plagiarismScore,
    profanityScore,
    warningMismatchScore,
    qualityScore,
    flags,
    summary: flags.length
      ? `${flags.join(", ")} detected. Risk ${riskScore}%.`
      : `No strong risk signals detected. Risk ${riskScore}%.`
  };
}

export function buildTextDiff(previousValue: unknown, nextValue: unknown) {
  const previous = stripHtml(previousValue);
  const next = stripHtml(nextValue);
  const before = previous.split(/\s+/).filter(Boolean);
  const after = next.split(/\s+/).filter(Boolean);
  const beforeSet = new Set(before.map((word) => word.toLowerCase()));
  const afterSet = new Set(after.map((word) => word.toLowerCase()));
  const added = after.filter((word) => !beforeSet.has(word.toLowerCase())).slice(0, 80);
  const removed = before.filter((word) => !afterSet.has(word.toLowerCase())).slice(0, 80);
  return {
    beforeWords: before.length,
    afterWords: after.length,
    deltaWords: after.length - before.length,
    added,
    removed,
    changed: added.length + removed.length
  };
}
