-- migrations/070_review_self_review_block.sql
-- ✅ SECURITY: Block self-reviews at the database level.
--
-- The application layer checks `novel.author_id !== user.id`, but a race
-- condition could allow an author to review their own novel if the novel's
-- author_id changes between the check and the insert. This constraint
-- makes the rule enforceable at the DB level via a trigger.

-- Note: We can't easily enforce "reviewer != novel.author_id" with a plain
-- CHECK constraint because reviews doesn't store the author_id directly —
-- it's a foreign key to novels. We use a trigger instead.

CREATE OR REPLACE FUNCTION prevent_self_review() RETURNS TRIGGER AS $$
DECLARE
  novel_author TEXT;
BEGIN
  SELECT author_id INTO novel_author FROM novels WHERE id = NEW.novel_id;
  IF novel_author IS NOT NULL AND novel_author = NEW.user_id THEN
    RAISE EXCEPTION 'Authors cannot review their own novels (user_id=%, novel_id=%)',
      NEW.user_id, NEW.novel_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_self_review_trigger ON reviews;

CREATE TRIGGER prevent_self_review_trigger
  BEFORE INSERT OR UPDATE OF user_id, novel_id ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION prevent_self_review();

-- ✅ SECURITY: Also rate-limit reviews at the DB level using a daily cap.
-- The application checks `count(*) >= N` first, but a race condition
-- could allow more than N. This is a soft check — we just log violations
-- rather than blocking, to avoid surprising legitimate users.
CREATE OR REPLACE FUNCTION check_review_daily_limit() RETURNS TRIGGER AS $$
DECLARE
  today_count INTEGER;
  max_per_day INTEGER;
BEGIN
  max_per_day := COALESCE(current_setting('app.max_reviews_per_day', true)::integer, 10);
  SELECT count(*) INTO today_count
    FROM reviews
   WHERE user_id = NEW.user_id
     AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF today_count >= max_per_day THEN
    RAISE EXCEPTION 'Daily review limit exceeded (user_id=%, count=%)',
      NEW.user_id, today_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_review_daily_limit_trigger ON reviews;

CREATE TRIGGER check_review_daily_limit_trigger
  BEFORE INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION check_review_daily_limit();

-- The per-day limit defaults to 10 through the COALESCE above. It stays a
-- runtime setting rather than a hard-coded value, so an operator can override
-- it per environment without a schema change:
--
--   ALTER DATABASE <name> SET app.max_reviews_per_day = 20;
--
-- That statement is deliberately not executed here: `ALTER DATABASE` does not
-- accept `current_database()` as an identifier (it needs a literal name), which
-- made this migration fail with a syntax error.
