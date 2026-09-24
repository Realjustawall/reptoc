-- Novels remain unrated until the first real reader rating, and their rating is
-- always the arithmetic mean: sum of ratings / number of ratings.
ALTER TABLE public.novels
  ALTER COLUMN rating SET DEFAULT 0.0;

UPDATE public.novels AS novel
SET rating = 0.0,
    reviews_count = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM public.reviews AS review
  WHERE review.novel_id = novel.id
);

CREATE OR REPLACE FUNCTION public.sync_novel_rating_average()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_novel_id TEXT;
BEGIN
  affected_novel_id := COALESCE(NEW.novel_id, OLD.novel_id);

  UPDATE public.novels
  SET rating = COALESCE((
        SELECT ROUND(AVG(review.rating)::numeric, 1)
        FROM public.reviews AS review
        WHERE review.novel_id = affected_novel_id
      ), 0.0),
      reviews_count = (
        SELECT COUNT(*)
        FROM public.reviews AS review
        WHERE review.novel_id = affected_novel_id
      )
  WHERE id = affected_novel_id;

  -- If an update moved a review between novels, refresh the old novel too.
  IF TG_OP = 'UPDATE' AND OLD.novel_id IS DISTINCT FROM NEW.novel_id THEN
    UPDATE public.novels
    SET rating = COALESCE((
          SELECT ROUND(AVG(review.rating)::numeric, 1)
          FROM public.reviews AS review
          WHERE review.novel_id = OLD.novel_id
        ), 0.0),
        reviews_count = (
          SELECT COUNT(*)
          FROM public.reviews AS review
          WHERE review.novel_id = OLD.novel_id
        )
    WHERE id = OLD.novel_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_sync_novel_rating_average ON public.reviews;
CREATE TRIGGER reviews_sync_novel_rating_average
AFTER INSERT OR UPDATE OF rating, novel_id OR DELETE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.sync_novel_rating_average();

-- Correct all existing averages when the migration is installed.
UPDATE public.novels AS novel
SET rating = COALESCE(stats.average_rating, 0.0),
    reviews_count = COALESCE(stats.rating_count, 0)
FROM (
  SELECT target.id AS novel_id,
         ROUND(AVG(review.rating)::numeric, 1) AS average_rating,
         COUNT(review.id)::integer AS rating_count
  FROM public.novels AS target
  LEFT JOIN public.reviews AS review ON review.novel_id = target.id
  GROUP BY target.id
) AS stats
WHERE novel.id = stats.novel_id;
