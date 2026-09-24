-- Profile connections are available to every user and limited to five.
-- If legacy accounts have more, retain their first five in display order.
WITH ranked_connections AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY user_id
    ORDER BY position ASC, created_at ASC, id ASC
  ) AS connection_number
  FROM public.author_profile_links
)
DELETE FROM public.author_profile_links AS connection
USING ranked_connections AS ranked
WHERE connection.id = ranked.id
  AND ranked.connection_number > 5;

CREATE OR REPLACE FUNCTION public.enforce_profile_connection_limit()
RETURNS trigger AS $$
BEGIN
  -- Serialize inserts for the same profile so simultaneous requests cannot
  -- both pass the count check.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id, 0));
  IF (
    SELECT COUNT(*)
    FROM public.author_profile_links
    WHERE user_id = NEW.user_id
  ) >= 5 THEN
    RAISE EXCEPTION 'A profile can contain up to 5 connections.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profile_connection_limit ON public.author_profile_links;
CREATE TRIGGER profile_connection_limit
BEFORE INSERT ON public.author_profile_links
FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_connection_limit();
