-- A novel's public like total includes direct novel likes plus likes on any of
-- its chapters. Keep the cached columns aligned with the source tables.
UPDATE public.novels AS novel
SET likes_count =
  (SELECT count(*)::integer FROM public.novel_likes AS direct_like WHERE direct_like.novel_id = novel.id)
  +
  (SELECT count(*)::integer FROM public.chapter_likes AS chapter_like WHERE chapter_like.novel_id = novel.id);

UPDATE public.suggestion_novel_stats AS stats
SET likes = novel.likes_count,
    updated_at = now()
FROM public.novels AS novel
WHERE novel.id = stats.novel_id;
