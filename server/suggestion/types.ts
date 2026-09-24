export interface UserEvent {
  event: string;
  novel_id: string;
  author_id?: string;
  novel_vector: Record<string, number>;
  chapter?: number;
  read_time?: number;
  timestamp: number;
  position?: number;
  scrollDepth?: number;
  duration?: number;
  completionRatio?: number;
}

export interface User {
  id: string;
  recentEvents: UserEvent[];
  preferredLength: number;
  seenNovels: Set<string>;
  activeUnfinishedNovels: Set<string>;
  negativeVector?: Record<string, number>;
  exploreWillingness?: number;
  authorAffinity?: Record<string, number>;
  genreAffinity?: Record<string, number>;
  fatigueAuthor?: Record<string, number>;
  fatigueGenre?: Record<string, number>;
  churnRisk?: number;
  sessionVector?: Record<string, number>;
  sessionIntent?: Record<string, number>;
  moodVector?: Record<string, number>;
  profileVersion?: number;
}

export interface Novel {
  id: string;
  vector: Record<string, number>;
  genre: string;
  author: string;
  authorId?: string;
  avgChapterLength: number;
  chapterCount?: number;
  popularityPercentile?: number;
  qualityScore?: number;
  negativeSignals?: number;
  
  impressions: number;
  clicks: number;
  ch1Complete: number;
  ch5Complete: number;
  ch10Complete: number;
  follows: number;
  comments: number;
  likes: number;
  shares: number;
  views: number;
  
  ageHours: number;
  engagement24h: number;
  engagement7d: number;
  
  ctrGlobal: number;
  r5Global: number;
  r10Global: number;
  
  qualityAIWriting: number;
  qualityAIHook: number;
  qualityAICharacter: number;
  qualityAIWorld: number;
  
  reportRate: number;
  fastExitRate: number;
  
  sources?: string[];
}

export interface Context {
  device: 'mobile' | 'desktop' | 'tablet';
  position?: number; 
  time?: number;
  sessionId?: string;
  locale?: string;
}

export interface ScoreBreakdown {
  match: number;
  preferenceFit: number;
  quality: number;
  timeFit: number;
  lengthFit: number;
  statePenalty: number;
  popularity: number;
  freshness: number;
  growth: number;
  exploration: number;
  bandit: number;
  personalNegative: number;
  fatiguePenalty: number;
  authorFatigue: number;
  clickbaitPenalty: number;
  churnRisk: number;
  total: number;
}

export interface ScoredCandidate {
  novel: Novel;
  baseScore: number;
  breakdown?: ScoreBreakdown;
  source?: string[];
}

export const EVENT_REWARDS: Record<string, number> = {
  'impression': 0.05,
  'hover': 0.5,
  'click': 2.0,
  'chapter_start': 5.0,
  'chapter_complete': 15.0,
  'bookmark': 40.0,
  'library_add': 45.0,
  'favorite': 55.0,
  'follow': 70.0,
  'comment': 80.0,
  'share': 100.0,

  'impression_no_click': -2.0,
  'skip_after_open': -8.0,
  'abandon_chapter': -10.0,
  'bounce': -15.0,
  'fast_exit': -20.0,
  'short_read': -12.0,
  'hide': -60.0,
  'not_interested': -70.0,
  'remove_from_library': -50.0,
  'unfollow': -80.0,
  'report': -120.0
};
