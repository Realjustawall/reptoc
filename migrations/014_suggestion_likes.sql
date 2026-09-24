ALTER TABLE public.suggestion_novel_stats
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0;

UPDATE public.novels novels
SET likes_count = (SELECT COUNT(*)::integer FROM public.novel_likes likes WHERE likes.novel_id = novels.id);

UPDATE public.suggestion_novel_stats stats
SET likes = (SELECT COUNT(*)::integer FROM public.novel_likes novel_like WHERE novel_like.novel_id = stats.novel_id);
