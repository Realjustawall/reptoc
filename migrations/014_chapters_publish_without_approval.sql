-- Chapter publication never requires editorial approval. Repair chapters that
-- were previously converted from Publish/Schedule into submitted drafts.
UPDATE public.chapters
SET
  status = CASE
    WHEN scheduled_at IS NOT NULL AND scheduled_at > NOW() THEN 'Scheduled'
    ELSE 'Published'
  END,
  editorial_status = CASE
    WHEN scheduled_at IS NOT NULL AND scheduled_at > NOW() THEN 'scheduled'
    ELSE 'published'
  END,
  approved_at = COALESCE(approved_at, NOW()),
  published_at = CASE
    WHEN scheduled_at IS NULL OR scheduled_at <= NOW() THEN COALESCE(published_at, NOW())
    ELSE published_at
  END,
  updated_at = NOW()
WHERE status = 'Draft'
  AND editorial_status = 'submitted';
