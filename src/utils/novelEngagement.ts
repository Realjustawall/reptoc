import type { Novel } from "../types";

export function applyChapterLikeToNovel(
  novel: Novel,
  chapterId: string,
  liked: boolean,
  chapterLikesCount: number,
  novelLikesCount: number,
): Novel {
  const normalizedNovelLikes = Math.max(0, Number(novelLikesCount || 0));
  const normalizedChapterLikes = Math.max(0, Number(chapterLikesCount || 0));
  const currentChapter = (novel.chapters || []).find((chapter) => chapter.id === chapterId);
  if (
    Number(novel.likesCount || 0) === normalizedNovelLikes
    && currentChapter
    && Number(currentChapter.likesCount || 0) === normalizedChapterLikes
    && currentChapter.likedByCurrentUser === liked
  ) {
    return novel;
  }
  return {
    ...novel,
    likesCount: normalizedNovelLikes,
    chapters: (novel.chapters || []).map((chapter) => (
      chapter.id === chapterId
        ? {
            ...chapter,
            likesCount: normalizedChapterLikes,
            likedByCurrentUser: liked,
          }
        : chapter
    )),
  };
}
