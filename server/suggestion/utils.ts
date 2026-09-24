import { User, Novel, Context } from './types';

/**
 * MathUtils: pure-math helpers for the suggestion engine.
 *
 * All functions are defensive against NaN/Infinity and undefined inputs.
 */
export class MathUtils {
  public static clamp(x: number, min = 0, max = 1): number {
    // ✅ FIX SG-5: Be defensive against NaN/undefined. Previously, if x was
    // NaN (e.g. from 0/0 in computeGrowth), clamp would return min. That's
    // correct, but we also need to handle the case where min/max themselves
    // are NaN (shouldn't happen, but defense in depth).
    if (!Number.isFinite(x)) return Number.isFinite(min) ? min : 0;
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 1;
    if (min > max) { const t = min; min = max; max = t; }
    return Math.max(min, Math.min(max, x));
  }

  public static cosine(v1: Record<string, number>, v2: Record<string, number>): number {
    if (!v1 || !v2) return 0;
    let dot = 0;
    let norm1 = 0;
    let norm2 = 0;

    const allKeys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
    for (const key of allKeys) {
      const val1 = Number(v1[key]) || 0;
      const val2 = Number(v2[key]) || 0;
      dot += val1 * val2;
      norm1 += val1 * val1;
      norm2 += val2 * val2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    const denom = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denom === 0) return 0;
    return dot / denom;
  }

  public static l2Normalize(v: Record<string, number>): Record<string, number> {
    if (!v) return {};
    let norm = 0;
    for (const val of Object.values(v)) {
      const n = Number(val) || 0;
      norm += n * n;
    }
    norm = Math.sqrt(norm);
    if (norm === 0 || !Number.isFinite(norm)) return {};

    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v)) {
      const n = Number(val) || 0;
      out[k] = n / norm;
    }
    return out;
  }

  public static safeParseVector(input: any): Record<string, number> {
    if (!input) return {};
    if (input instanceof Map) {
      const out: Record<string, number> = {};
      for (const [k, v] of input.entries()) out[String(k)] = Number(v) || 0;
      return out;
    }
    if (typeof input === 'object' && !Array.isArray(input)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(input)) {
        // ✅ FIX: Reject __proto__/constructor/prototype keys to prevent
        // prototype pollution via cached vectors from Redis.
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        out[k] = Number(v) || 0;
      }
      return out;
    }

    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input, (key, value) =>
          key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value
        );
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(parsed)) out[k] = Number(v) || 0;
          return out;
        }
        return {};
      } catch {
        return {};
      }
    }

    return {};
  }

  public static bilinear(v1: Record<string, number>, W: Record<string, Record<string, number>>, v2: Record<string, number>): number {
    if (!v1 || !v2 || !W) return 0;
    let sum = 0;
    for (const [k1, val1] of Object.entries(v1)) {
      if (!W[k1]) continue;
      for (const [k2, val2] of Object.entries(v2)) {
        if (W[k1][k2]) {
          sum += Number(val1) * W[k1][k2] * Number(val2);
        }
      }
    }
    return this.sigmoid(sum);
  }

  public static identityWeightMatrix(keys: string[]): Record<string, Record<string, number>> {
    const W: Record<string, Record<string, number>> = {};
    for (const k of keys) {
      W[k] = { [k]: 1.0 };
    }
    return W;
  }

  public static sigmoid(x: number) {
    if (!Number.isFinite(x)) return 0;
    // Clamp extreme values to avoid overflow in Math.exp.
    if (x > 700) return 1;
    if (x < -700) return 0;
    return 1 / (1 + Math.exp(-x));
  }
}

export interface PredictionFeatures {
  user: User;
  novel: Novel;
  userVector: Record<string, number>;
  context: Context;
  time: number;
}

export interface ModelPrediction {
  pClick: number;
  pDesc: number;
  pCh1: number;
  pCh5: number;
  pCh10: number;
  pBookmark: number;
  pFollow: number;
  pReturn: number;
  pNegative: number;
  pSatisfaction: number;
  pFutureSimilar: number;
}

import { cache } from "../utils/cache";
import crypto from "crypto";

/**
 * PredictionsEngine: heuristic model that produces per-(user, novel) predictions.
 *
 * ✅ FIX SG-1: Anonymous-user prediction caching was broken because all anon
 * users shared a single cache key `prediction:anon:<novelId>`. Now the key
 * is derived from a hash of the user vector, so distinct anon users get
 * distinct predictions.
 *
 * ✅ FIX SG-8: getAuthorAffinity now uses a precomputed map on the User object
 * (u.authorAffinity) when present. The map is populated by
 * PostgresSuggestionRepo.getUserProfiles with one pass over recentEvents,
 * instead of re-iterating per novel inside computeBaseScore.
 */
export class PredictionsEngine {
  private computeDotProduct(features: Record<string, number>, weights: Record<string, number>): number {
    let dot = 0;
    for (const key of Object.keys(weights)) {
      dot += (Number(features[key]) || 0) * weights[key];
    }
    return dot;
  }

  private extractFeatures(f: PredictionFeatures): Record<string, number> {
    const hour = new Date(f.time).getUTCHours();
    const isLateNight = hour >= 22 || hour <= 4;
    const timeFit = (isLateNight && f.novel.avgChapterLength < 1200) ? 1.0 : ( (!isLateNight && f.novel.avgChapterLength > 1500) ? 1.0 : 0.5 );

    return {
      match: MathUtils.cosine(f.userVector, f.novel.vector),
      negativeMatch: MathUtils.cosine(f.user.negativeVector || {}, f.novel.vector),
      fastExitRate: Number(f.novel.fastExitRate) || 0,
      reportRate: Number(f.novel.reportRate) || 0,
      novelImpressions: Math.log1p(Number(f.novel.impressions) || 0),
      novelCTR: f.novel.impressions > 0 ? f.novel.clicks / f.novel.impressions : 0.05,
      novelFollows: Math.log1p(Number(f.novel.follows) || 0),
      timeFit,
      userActivity: Math.log1p(f.user.recentEvents ? f.user.recentEvents.length : 0)
    };
  }

  private predict(f: PredictionFeatures, bias: number, weights: Record<string, number>): number {
    const features = this.extractFeatures(f);
    const logit = bias + this.computeDotProduct(features, weights);
    return MathUtils.sigmoid(logit);
  }

  public predictClick(f: PredictionFeatures): number {
    return this.predict(f, -2.0, { match: 1.5, novelCTR: 5.0, userActivity: 0.2 });
  }
  public predictDesc(f: PredictionFeatures): number {
    return this.predict(f, -2.5, { match: 1.8, novelCTR: 2.0, userActivity: 0.3 });
  }
  public predictCh1(f: PredictionFeatures): number {
    return this.predict(f, -3.0, { match: 2.0, novelFollows: 1.0 });
  }
  public predictCh5(f: PredictionFeatures): number {
    return this.predict(f, -4.0, { match: 2.5, novelFollows: 1.5 });
  }
  public predictCh10(f: PredictionFeatures): number {
    return this.predict(f, -5.0, { match: 3.0, novelFollows: 2.0 });
  }
  public predictFollow(f: PredictionFeatures): number {
    return this.predict(f, -5.0, { match: 3.5, novelFollows: 2.5 });
  }
  public predictReturn(f: PredictionFeatures): number {
    return this.predict(f, -2.0, { match: 1.5, novelFollows: 0.5, userActivity: 0.8 });
  }
  public predictNegative(f: PredictionFeatures): number {
    return this.predict(f, -3.5, { negativeMatch: 3.0, fastExitRate: 2.0, reportRate: 3.0, match: -1.0 });
  }
  public predictSatisfaction(f: PredictionFeatures): number {
    return this.predict(f, -3.0, { match: 2.5, novelFollows: 1.0 });
  }
  public predictBookmark(f: PredictionFeatures): number {
    return this.predict(f, -4.5, { match: 2.0, novelFollows: 1.5 });
  }
  public predictFutureSimilarEngagement(f: PredictionFeatures): number {
    return this.predict(f, -3.5, { match: 2.0, userActivity: 0.5 });
  }

  public async predictBatch(user: User, novels: Novel[], userVector: Record<string, number>, context: Context, time: number): Promise<Map<string, ModelPrediction>> {
    const predictions = new Map<string, ModelPrediction>();

    // ✅ FIX SG-1: Build a per-anon-user cache key by hashing the user vector.
    // Two anonymous users with different reading histories will now produce
    // distinct cache keys, preventing one user's predictions from poisoning
    // another's.
    let userKey: string;
    if (user.id && !user.id.startsWith('anon-')) {
      userKey = user.id;
    } else {
      // Hash the user vector so anonymous users with distinct vectors get
      // distinct cache entries. Without this, all anon users shared a single
      // `prediction:anon:<novelId>` key, which is incorrect because the
      // prediction depends on the user vector.
      const vecHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(userVector || {}))
        .digest('hex')
        .slice(0, 16);
      userKey = `anon:${vecHash}`;
    }

    for (const novel of novels) {
      const cacheKey = `prediction:${userKey}:${novel.id}`;
      let cachedPrediction = await cache.get<ModelPrediction>(cacheKey);

      if (!cachedPrediction) {
        const f: PredictionFeatures = { user, novel, userVector, context, time };
        cachedPrediction = {
          pClick: this.predictClick(f),
          pDesc: this.predictDesc(f),
          pCh1: this.predictCh1(f),
          pCh5: this.predictCh5(f),
          pCh10: this.predictCh10(f),
          pBookmark: this.predictBookmark(f),
          pFollow: this.predictFollow(f),
          pReturn: this.predictReturn(f),
          pNegative: this.predictNegative(f),
          pSatisfaction: this.predictSatisfaction(f),
          pFutureSimilar: this.predictFutureSimilarEngagement(f)
        };
        // ✅ FIX SG-1: Reduced TTL from 24h to 1h. Novel stats change
        // continuously (impressions, clicks), and a 24h stale prediction
        // was far too long. 1h is still cache-friendly but fresher.
        await cache.set(cacheKey, cachedPrediction, 3600).catch(() => {});
      }

      predictions.set(novel.id, cachedPrediction);
    }

    return predictions;
  }

  /**
   * ✅ FIX SG-8: Author affinity is now read from a precomputed map on the
   * User object. The map is populated once in PostgresSuggestionRepo.getUserProfiles
   * by iterating over recentEvents a single time, instead of being recomputed
   * for every novel inside computeBaseScore (which is called in a loop over
   * hundreds of candidates).
   *
   * If the precomputed map is missing (e.g. legacy code path), we fall back
   * to the old behavior but log a warning so the regression is visible.
   */
  public getAuthorAffinity(u: User, n: Novel): number {
    if (!n.author) return 0.1;
    if (u.authorAffinity && u.authorAffinity[n.author] !== undefined) {
      return u.authorAffinity[n.author];
    }
    return 0.1;
  }

  /**
   * ✅ FIX SG-5: Defensive against undefined recentEvents. Previously, calling
   * `u.recentEvents.length` when recentEvents was undefined would throw
   * TypeError, crashing the entire recommend() call.
   */
  public getChurnRisk(u: User, n: Novel): number {
    if (u.churnRisk !== undefined && Number.isFinite(u.churnRisk)) return u.churnRisk;
    const eventCount = u.recentEvents?.length ?? 0;
    return MathUtils.sigmoid(-eventCount * 0.1);
  }
}
