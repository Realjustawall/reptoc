import type { PremiumPresentation } from "../shared/premiumTemplates";
import type { ContentKind, MangaPage, ReadingDirection } from "../shared/manga";

export interface Chapter {
  id: string;
  novelId: string;
  title: string;
  content: string;
  chapterNumber: number;
  isAuxiliary?: boolean;
  createdAt: string;
  wordCount: number;
  authorNotesTop?: string;
  authorNotesBottom?: string;
  status?: "Draft" | "Published" | "Scheduled";
  scheduledAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  viewsCount?: number;
  likesCount?: number;
  likedByCurrentUser?: boolean;
  paragraphs?: Array<{ id: string; ordinal: number }>;
  /** Manga chapters carry ordered image pages instead of prose. */
  pages?: MangaPage[];
  pageCount?: number;
  /** Reader-side deterrence selected by the author for this chapter. */
  preventCopy?: boolean;
  preventScreenshot?: boolean;
}

export interface Review {
  id: string;
  userId?: string;
  username: string;
  displayName?: string;
  avatar?: string;
  role?: string;
  rating: number;
  comment: string;
  createdAt: string;
  // Royal Road multi-rating breakdown
  ratingOverall?: number;
  ratingStyle?: number;
  ratingStory?: number;
  ratingGrammar?: number;
  ratingCharacter?: number;
}

export interface Novel {
  id: string;
  title: string;
  author: string;
  author_id?: string;
  authorUsername?: string;
  authorAvatar?: string;
  authorDisplayName?: string;
  description: string;
  genre: string;
  cover: string;
  coverUrl?: string;
  rating: number;
  bookmarksCount: number;
  viewsCount: number;
  averageViews?: number;
  publishedChapterCount?: number;
  likesCount?: number;
  createdAt: string;
  updatedAt?: string;
  chapters: Chapter[];
  reviews: Review[];
  isUserCreated?: boolean;
  // Royal Road Specific features
  status?: "Ongoing" | "Completed" | "Hiatus";
  approvalStatus?: "pending_approval" | "approved" | "rejected";
  editorNote?: string;
  tags?: string[];
  mainCategories?: string[];
  subCategories?: string[];
  warnings?: string[];
  authorNotes?: string;
  ageRating?: string;
  reviewsCount?: number;
  wordsCount?: number;
  isCompleted?: boolean;
  isAIGenerated?: boolean;
  isAIAssisted?: boolean;
  originType?: "original" | "translated";
  originalAuthor?: string;
  translators?: string[];
  /** "novel" for prose, "manga" for a page-based comic. Fixed at creation. */
  contentKind?: ContentKind;
  /** Page-turn direction for the manga reader. */
  readingDirection?: ReadingDirection;
  characters?: Character[];
  premiumPresentation?: PremiumPresentation;
  premiumPresentationActive?: boolean;
  catalogueOnly?: boolean;
  recommendationSources?: string[];
  recommendationReason?: string;
  /** Story-wide protection inherited by every chapter. */
  preventCopy?: boolean;
  preventScreenshot?: boolean;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  bio: string;
  imageUrl?: string;
  votesCount?: number;
}

export interface ReadingProgress {
  novelId: string;
  novelTitle: string;
  novelCover: string;
  novelGenre: string;
  novelAuthor: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  scrollPercent: number;
  scrollPercentage?: number;
  readSeconds?: number;
  completed?: boolean;
  lastRead?: string;
  updatedAt: string;
}

export interface UserStats {
  novelsRead: number;
  chaptersRead: number;
  wordsWritten: number;
  novelsWritten: number;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  content: string;
  is_admin: number;
  created_at: string;
  sender?: string;
}

export interface FAQItem {
  id?: string;
  q: string;
  a: string;
}

export interface LeaderboardTag {
  name: string;
  share: string;
  growth: string;
}

export interface ActiveContest {
  title: string;
  theme: string;
  description: string;
}
