import { User, Novel, Context, ScoredCandidate, UserEvent, ScoreBreakdown, EVENT_REWARDS } from './types';
import { PredictionsEngine, PredictionFeatures, MathUtils, ModelPrediction } from './utils';
import { PostgresSuggestionRepo } from './PostgresSuggestionRepo';

function stringSet(value: unknown): Set<string> {
  if (value instanceof Set) return new Set(Array.from(value, String));
  if (Array.isArray(value)) return new Set(value.map(String));
  // Older Redis entries serialized Set values as `{}`. Treat those entries as
  // empty instead of passing a non-iterable value to the Set constructor.
  return new Set<string>();
}

export class ScoringEngine {
  constructor(private pEngine: PredictionsEngine) {}

  public computeBaseScore(user: User, novel: Novel, userVector: Record<string, number>, context: Context, time: number, preds: ModelPrediction): { total: number, breakdown: ScoreBreakdown } {
    const P_click = preds.pClick;
    const P_desc = preds.pDesc;
    const P_ch1 = preds.pCh1;
    const P_ch5 = preds.pCh5;
    const P_ch10 = preds.pCh10;
    const P_bookmark = preds.pBookmark;
    const P_follow = preds.pFollow;
    const P_return = preds.pReturn;
    const P_negative = preds.pNegative;
    const P_satisfaction = preds.pSatisfaction;
    const P_futureSimilar = preds.pFutureSimilar;

    const AuthorAffinity = this.pEngine.getAuthorAffinity(user, novel);
    const GenreAffinity = MathUtils.clamp(Number(user.genreAffinity?.[novel.genre] || 0), 0, 1);
    const PreferenceFit = MathUtils.clamp(0.55 * GenreAffinity + 0.45 * AuthorAffinity, 0, 1);
    const ChurnRisk = this.pEngine.getChurnRisk(user, novel);

    const SV = 0.05 * P_click + 0.08 * P_desc + 0.15 * P_ch1 + 0.22 * P_ch5 + 0.20 * P_bookmark + 0.25 * P_follow - 0.30 * P_negative;
    const LV = 0.25 * P_ch10 + 0.25 * P_return + 0.25 * P_satisfaction + 0.10 * P_futureSimilar + 0.10 * AuthorAffinity - 0.25 * ChurnRisk;

    const Match = MathUtils.cosine(userVector, novel.vector);
    const Compat = MathUtils.bilinear(userVector, MathUtils.identityWeightMatrix(Object.keys(userVector)), novel.vector);

    const Quality = this.computeQuality(novel);
    const TimeFit = this.computeTimeFit(user, novel, time);
    const LengthFit = this.computeLengthFit(user, novel);
    const StatePenalty = this.computeStatePenalty(user, novel);
    const Popularity = this.computePopularity(novel);
    const Freshness = this.computeFreshness(novel);
    const GrowthBoost = this.computeGrowth(novel);
    const Exploration = this.computeExploration(user, novel);
    const BanditScore = this.computeUCB(user, novel);

    const PersonalNegative = this.computePersonalNegative(user, novel);
    const FatiguePenalty = this.computeFatigue(user, novel, time);
    const AuthorFatigue = this.computeAuthorFatigue(user, novel, time);
    const ClickbaitPenalty = this.computeClickbait(novel);

    const BaseScore =
        0.10 * SV +
        0.18 * LV +
        0.12 * PreferenceFit +
        0.10 * Match +
        0.12 * Compat +
        0.08 * Quality +
        0.06 * TimeFit +
        0.04 * LengthFit +
        0.04 * Popularity +
        0.04 * Freshness +
        0.05 * GrowthBoost +
        0.05 * Exploration +
        0.04 * BanditScore -
        0.05 * StatePenalty -
        0.08 * PersonalNegative -
        0.07 * FatiguePenalty -
        0.04 * AuthorFatigue -
        0.08 * ClickbaitPenalty -
        0.10 * ChurnRisk;

    const breakdown: ScoreBreakdown = {
      match: Match, preferenceFit: PreferenceFit, quality: Quality, timeFit: TimeFit, lengthFit: LengthFit,
      statePenalty: StatePenalty, popularity: Popularity, freshness: Freshness,
      growth: GrowthBoost, exploration: Exploration, bandit: BanditScore,
      personalNegative: PersonalNegative, fatiguePenalty: FatiguePenalty,
      authorFatigue: AuthorFatigue, clickbaitPenalty: ClickbaitPenalty,
      churnRisk: ChurnRisk, total: BaseScore
    };

    return { total: BaseScore, breakdown };
  }

  private computeQuality(n: Novel): number {
    const alpha = 200;
    const CTR_adj = MathUtils.clamp((n.clicks + alpha * n.ctrGlobal) / (n.impressions + alpha + 0.001), 0, 1);

    const beta = 100;
    const R5_adj = MathUtils.clamp((n.ch5Complete + beta * n.r5Global) / (n.ch1Complete + beta + 0.001), 0, 1);
    const FollowRate_adj = MathUtils.clamp(n.follows / (n.ch1Complete + 20), 0, 1);

    const score = 0.15 * n.qualityAIWriting +
           0.15 * n.qualityAIHook +
           0.15 * n.qualityAICharacter +
           0.15 * n.qualityAIWorld +
           0.10 * CTR_adj +
           0.15 * R5_adj +
           0.15 * FollowRate_adj -
           0.10 * n.reportRate;

    return MathUtils.clamp(score, 0, 1);
  }

  private computeTimeFit(u: User, n: Novel, time: number): number {
    const hour = new Date(time).getUTCHours();
    const isLateNight = hour >= 22 || hour <= 4;
    if (isLateNight && n.avgChapterLength < 1200) return 0.8;
    if (!isLateNight && n.avgChapterLength > 1500) return 0.6;
    return 0.3;
  }

  private computeLengthFit(u: User, n: Novel): number {
    const diff = Math.abs(n.avgChapterLength - u.preferredLength);
    const sigma_L = 1000;
    const lengthFit = Math.exp(-diff / sigma_L);
    return lengthFit;
  }

  private computeStatePenalty(u: User, n: Novel): number {
    if (u.activeUnfinishedNovels && u.activeUnfinishedNovels.size > 5 && n.avgChapterLength > 2000) return 0.5;
    return 0;
  }

  private computePopularity(n: Novel): number {
    if (n.popularityPercentile !== undefined) return MathUtils.clamp(n.popularityPercentile, 0, 1);
    const raw = Math.log1p(
      0.1 * n.views +
      0.5 * n.clicks +
      2.0 * n.ch1Complete +
      5.0 * n.ch5Complete +
      8.0 * n.follows +
      7.0 * n.comments +
      9.0 * n.likes +
      10.0 * n.shares
    );
    return MathUtils.sigmoid((raw - 5) / 2);
  }

  private computeFreshness(n: Novel): number {
    const tau = 168;
    return MathUtils.clamp(Math.exp(-(n.ageHours || 0) / tau), 0, 1);
  }

  /**
   * ✅ FIX SG-6: For new novels (engagement7d < 10), return a base boost
   * instead of computing log1p(0 / epsilon) which yields ~0. This ensures
   * new novels get a non-zero GrowthBoost so they can appear in feeds.
   */
  private computeGrowth(n: Novel): number {
    const epsilon = 0.0001;
    // ✅ FIX SG-6: If the novel is new (very low 7d engagement), give it
    // a baseline growth boost so it can surface in feeds.
    if (!n.engagement7d || n.engagement7d < 10) {
      return MathUtils.clamp(Math.log1p((n.engagement24h || 0) + 1), 0, 1.5);
    }
    const ratio = n.engagement24h / (n.engagement7d / 7 + epsilon);
    if (!Number.isFinite(ratio)) return 0;
    return MathUtils.clamp(Math.log1p(ratio), 0, 1.5);
  }

  private computeExploration(u: User, n: Novel): number {
    const uncertainty = 1 / (Math.sqrt(n.impressions || 0) + 1);
    const exploreWillingness = u.exploreWillingness || 1.0;
    const novelty = 1.0;
    return MathUtils.clamp(uncertainty * exploreWillingness * novelty, 0, 1.5);
  }

  private computeUCB(u: User, n: Novel): number {
    const totalImpressions = 10000;
    const itemTrials = (n.impressions || 0) + 1;

    const positive = 1 * n.clicks + 3 * n.ch1Complete + 6 * n.ch5Complete + 10 * n.ch10Complete + 12 * n.follows + 9 * n.comments + 11 * n.likes + 15 * n.shares;
    const trials = (n.impressions || 0) + 100;
    const meanReward = MathUtils.clamp(positive / trials, 0, 1);

    const confidence = Math.sqrt(Math.log(totalImpressions + 1) / itemTrials);
    const c = 0.15 * (u.exploreWillingness || 1.0);

    return MathUtils.clamp(meanReward + c * confidence, 0, 1.5);
  }

  private computePersonalNegative(u: User, n: Novel): number {
    return MathUtils.clamp(MathUtils.cosine(u.negativeVector || {}, n.vector), 0, 1);
  }

  private computeFatigue(u: User, n: Novel, time: number): number {
    if (!u.recentEvents) return 0;
    const recentSightings = u.recentEvents.filter(e => e.novel_id === n.id && e.event === 'impression' && (time - e.timestamp) < 86400000).length;
    return MathUtils.clamp(1 - Math.exp(-recentSightings / 3), 0, 1);
  }

  private computeAuthorFatigue(u: User, n: Novel, time: number): number {
    if (!n.author || !u.recentEvents) return 0;
    const recentSightings = u.recentEvents.filter(e => e.author_id === n.author && e.event === 'impression' && (time - e.timestamp) < 86400000).length;
    return MathUtils.clamp(1 - Math.exp(-recentSightings / 5), 0, 1);
  }

  private computeClickbait(n: Novel): number {
    const CTR_adj = MathUtils.clamp(n.clicks / (n.impressions + 50), 0, 1);
    const Retention = MathUtils.clamp(n.ch5Complete / (n.ch1Complete + 20), 0, 1);
    const clickbaitGap = Math.max(0, CTR_adj - Retention);

    const risk = MathUtils.clamp(
      0.5 * clickbaitGap +
      0.3 * n.fastExitRate +
      0.2 * n.reportRate,
      0,
      1
    );

    return risk;
  }
}

export class DiversityEngine {
  public rerank(user: User, topCandidates: ScoredCandidate[], limit: number, allCandidates: Novel[] = []): Novel[] {
    const pool = [...topCandidates];
    const S: Novel[] = [];

    const exploreTarget = Math.max(1, Math.floor(limit * 0.1 * (user.exploreWillingness || 1.0)));
    let exploreCount = 0;

    const exploreItems = allCandidates.filter(c => c.impressions < 100 && c.qualityAIWriting > 0.6 && !pool.some(p => p.novel.id === c.id));
    exploreItems.sort((a,b) => b.qualityAIWriting - a.qualityAIWriting);
    for (const item of exploreItems.slice(0, exploreTarget * 3)) {
      pool.push({ novel: item, baseScore: 0.5 });
    }

    while (S.length < limit && pool.length > 0) {
      let bestNovel: Novel | null = null;
      let bestScore = -Infinity;
      let bestIndex = -1;

      for (let i = 0; i < pool.length; i++) {
        const candidate = pool[i];
        const n = candidate.novel;

        const redundancy = this.maxSimilarity(n, S);
        const coverage = this.computeCoverageGain(n, S);
        const continueBoost = this.computeContinueBoost(user, n);

        const positionScore = candidate.baseScore;

        if (this.violatesHardRules(n, S)) {
           continue;
        }

        let finalScore =
            positionScore
            + continueBoost
            - 0.20 * redundancy
            + 0.05 * coverage;

        if (n.impressions < 100 && exploreCount < exploreTarget) {
            finalScore += 0.8;
        }

        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestNovel = n;
          bestIndex = i;
        }
      }

      if (bestNovel && bestIndex > -1) {
        S.push(bestNovel);
        pool.splice(bestIndex, 1);
        if (bestNovel.impressions < 100) exploreCount++;
      } else {
        break;
      }
    }

    return S;
  }

  private maxSimilarity(n: Novel, S: Novel[]): number {
    if (S.length === 0) return 0;
    let maxSim = 0;
    for (const m of S) {
      const sim = MathUtils.cosine(n.vector, m.vector);
      if (sim > maxSim) maxSim = sim;
    }
    return maxSim;
  }

  private computeCoverageGain(n: Novel, S: Novel[]): number {
    let gain = 0;
    for (const key of Object.keys(n.vector)) {
      const isCovered = S.some(m => (m.vector[key] || 0) > 0.5);
      if (!isCovered) {
        gain += (n.vector[key] || 0);
      }
    }
    return MathUtils.clamp(gain, 0, 1);
  }

  private violatesHardRules(n: Novel, S: Novel[]): boolean {
    if (n.author) {
      const authorCount = S.filter(m => m.author === n.author).length;
      if (authorCount >= 2) return true;
    }

    const maxGenreQuota = 5;
    if (n.genre) {
      const genreCount = S.filter(m => m.genre === n.genre).length;
      if (genreCount >= maxGenreQuota) return true;
    }

    return false;
  }

  private computeContinueBoost(u: User, n: Novel): number {
    if (u.activeUnfinishedNovels && u.activeUnfinishedNovels.has(n.id)) {
      return 0.35;
    }
    return 0;
  }
}

export class NovaXRanker {
  private pEngine: PredictionsEngine;
  private scoring: ScoringEngine;
  private diversity: DiversityEngine;
  private repo: PostgresSuggestionRepo;
  private static activeComputations = 0;

  constructor() {
    this.pEngine = new PredictionsEngine();
    this.scoring = new ScoringEngine(this.pEngine);
    this.diversity = new DiversityEngine();
    this.repo = new PostgresSuggestionRepo();
  }

  public async recommend(userId: string, context: Context, time: number): Promise<Novel[]> {
    NovaXRanker.activeComputations++;
    try {
      const load = NovaXRanker.activeComputations;
      let candidateLimit = 500;
      let rerankLimit = 150;

      if (load > 50) {
          candidateLimit = 100;
          rerankLimit = 30;
      } else if (load > 20) {
          candidateLimit = 200;
          rerankLimit = 50;
      } else if (load > 5) {
          candidateLimit = 300;
          rerankLimit = 100;
      }

      const { cache } = await import('@/server/utils/cache');

      const profileData = await cache.getWithSWR(
        `profile_full:${userId}`,
        async () => {
          const ev = (await this.repo.getRecentEvents(userId).catch(() => [])) as UserEvent[];
          const prof = await this.repo.getUserProfiles(userId, ev).catch(() => ({
            longTerm: {}, midTerm: {}, negative: {}, preferredLength: 1500, exploreWillingness: 1.0, activeUnfinishedNovels: new Set<string>(), seenNovels: new Set<string>(), authorAffinity: {}, genreAffinity: {}, churnRisk: 0.1, profileVersion: 1
          }));
          return { recentEvents: ev, userProfiles: prof };
        },
        120,
        86400 * 3
      );

      // ✅ FIX: cache.getWithSWR may return null if the fetchFn threw an error
      // (dedupedFetch catches errors and returns null as T). Without this check,
      // profileData.recentEvents would crash with TypeError.
      if (!profileData) {
        return [];
      }

      const recentEvents = profileData.recentEvents || [];
      const userProfiles = profileData.userProfiles;

      const user: User = {
        id: userId,
        recentEvents: recentEvents,
        preferredLength: userProfiles.preferredLength || 1500,
        seenNovels: stringSet(userProfiles.seenNovels),
        activeUnfinishedNovels: stringSet(userProfiles.activeUnfinishedNovels),
        negativeVector: userProfiles.negative || {},
        exploreWillingness: userProfiles.exploreWillingness || 1.0,
        authorAffinity: userProfiles.authorAffinity || {},
        genreAffinity: userProfiles.genreAffinity || {},
        churnRisk: userProfiles.churnRisk,
        profileVersion: userProfiles.profileVersion
      };

      const UL = userProfiles.longTerm || {};
      const UM = userProfiles.midTerm || {};

      const US = this.buildSessionProfile(recentEvents, time);
      const Mood = this.detectMood(recentEvents, time);
      const Intent = this.detectIntent(recentEvents, time);

      user.sessionVector = US;
      user.sessionIntent = Intent;
      user.moodVector = Mood;

      const U = this.combineUserVectors(UL, UM, US, Mood, Intent, time, user.exploreWillingness);

      let C = await cache.getWithSWR(
        `candidates:${userId}:${candidateLimit}`,
        () => this.repo.getCandidateNovels(user, context, candidateLimit),
        180,
        86400 * 3
      ).catch(() => []);

      if (!C || C.length === 0) return [];

      const predictions = await this.pEngine.predictBatch(user, C, U, context, time).catch(() => new Map());

      const scoredCandidates = C.map(n => {
        const pred = predictions.get(n.id) || {
          pClick: 0, pDesc: 0, pCh1: 0, pCh5: 0, pCh10: 0,
          pBookmark: 0, pFollow: 0, pReturn: 0, pNegative: 0, pSatisfaction: 0, pFutureSimilar: 0
        };

        const { total: baseScore, breakdown } = this.scoring.computeBaseScore(user, n, U, context, time, pred);
        return { novel: n, baseScore, breakdown };
      });

      scoredCandidates.sort((a, b) => b.baseScore - a.baseScore);
      const topBracket = scoredCandidates.slice(0, rerankLimit);

      const feedLimit = 20;
      const S = this.diversity.rerank(user, topBracket, feedLimit, C);

      this.repo.logRecommendationDecision(userId, context, S, scoredCandidates, {
         rankingVersion: 'nova-rs-v0.6',
         modelVersion: 'heuristic-v0.4',
         candidateCount: C.length,
         activeComputations: load
      }).catch(console.warn);

      return S;
    } catch (e) {
      console.error("Critical failure in recommend algorithm:", e);
      return [];
    } finally {
      NovaXRanker.activeComputations--;
    }
  }

  private buildSessionProfile(recentEvents: UserEvent[], time: number): Record<string, number> {
    const US: Record<string, number> = {};
    const lambda_S = 0.08;

    for (const event of recentEvents || []) {
      const ageHours = (time - event.timestamp) / 3600000;
      const decay = Math.exp(-lambda_S * ageHours);
      const R = EVENT_REWARDS[event.event] || 0;

      const N_i = event.novel_vector || {};

      for (const [key, val] of Object.entries(N_i)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const numericVal = Number(val) || 0;
        US[key] = (US[key] || 0) + (R * numericVal * decay);
      }
    }
    return MathUtils.l2Normalize(US);
  }

  private detectMood(recentEvents: UserEvent[], time: number): Record<string, number> {
    const moodVector: Record<string, number> = {};
    const veryRecentEvents = (recentEvents || []).filter(e => (time - e.timestamp) < 2 * 3600000);

    for (const event of veryRecentEvents) {
      if (['chapter_complete', 'follow', 'bookmark', 'hover', 'reopen_novel'].includes(event.event)) {
         for (const [key, val] of Object.entries(event.novel_vector || {})) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            moodVector[key] = (moodVector[key] || 0) + (Number(val) * 1.5);
         }
      } else if (['fast_exit', 'hide', 'not_interested', 'report'].includes(event.event)) {
         for (const [key, val] of Object.entries(event.novel_vector || {})) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            moodVector[key] = (moodVector[key] || 0) - (Number(val) * 2.0);
         }
      }
    }
    return MathUtils.l2Normalize(moodVector);
  }

  private detectIntent(recentEvents: UserEvent[], time: number): Record<string, number> {
    const intentVector: Record<string, number> = {};
    const intenseInteractions = (recentEvents || []).filter(e => (time - e.timestamp) < 1 * 3600000 &&
       ['click', 'chapter_start', 'hover', 'search_click', 'return_to_novel'].includes(e.event));

    for (const event of intenseInteractions) {
       for (const [key, val] of Object.entries(event.novel_vector || {})) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
          intentVector[key] = (intentVector[key] || 0) + Number(val);
       }
    }
    return MathUtils.l2Normalize(intentVector);
  }

  private combineUserVectors(UL: Record<string, number>, UM: Record<string, number>, US: Record<string, number>, Mood: Record<string, number>, Intent: Record<string, number>, time: number, exploreWillingness: number = 1.0): Record<string, number> {
    const wL = 0.20, wM = 0.20, wS = 0.30, wI = 0.20, wMood = 0.10;
    const exploreScale = 1.0;

    const U: Record<string, number> = {};

    const sources = [
      { vec: UL, w: wL * exploreScale },
      { vec: UM, w: wM * exploreScale },
      { vec: US, w: wS },
      { vec: Mood, w: wMood },
      { vec: Intent, w: wI }
    ];

    for (const s of sources) {
      for (const [k, v] of Object.entries(s.vec || {})) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        U[k] = (U[k] || 0) + s.w * (Number(v) || 0);
      }
    }
    return MathUtils.l2Normalize(U);
  }

  public async trackEvent(userId: string, novelId: string, event: string, readTime: number = 0, chapter: number = 0) {
    await this.repo.logEventAndUpdateProfile(userId, novelId, event, readTime, chapter);
  }
}
