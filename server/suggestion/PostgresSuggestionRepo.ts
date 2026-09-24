import { supabase, db } from '@/server/postgres';
import { Novel, User, UserEvent, Context, EVENT_REWARDS } from './types';
import { MathUtils } from './utils';
import { backfillSuggestionArtifacts, recordSuggestionStatsEvent } from './maintenance';
import { cache } from '@/server/utils/cache';
import { buildExplicitPreferenceSignals, mergeAffinityMaps } from './preferences';

const AUTHOR_EVENT_REWARDS: Record<string, number> = {
  click: 0.5,
  chapter_start: 1.0,
  chapter_complete: 2.0,
  bookmark: 10.0,
  library_add: 12.0,
  follow: 15.0,
  favorite: 20.0,
  comment: 25.0,
  share: 30.0,
};

export class PostgresSuggestionRepo {
  /**
   * Load user profile and pre-compute author affinity.
   *
   * ✅ FIX SG-8: authorAffinity is now populated here (one pass over
   * recentEvents) instead of being computed lazily inside getAuthorAffinity
   * for every novel in the candidate set. This reduces per-request CPU from
   * O(novels × events) to O(events).
   */
  public async getUserProfiles(userId: string, loadedRecentEvents: any[] = []) {
    const isAnonymous = userId.startsWith('anon-');
    const [profileResult, readingResult, bookmarkResult, followResult] = await Promise.all([
      supabase.from('suggestion_user_profiles').select('*').eq('user_id', userId).single(),
      isAnonymous
        ? Promise.resolve({ data: [] as any[] })
        : supabase.from('reading_progress').select('novel_id, scroll_percentage, completed').eq('user_id', userId),
      isAnonymous
        ? Promise.resolve({ data: [] as any[] })
        : supabase.from('bookmarks').select('novel_id, shelf_status').eq('user_id', userId),
      isAnonymous
        ? Promise.resolve({ data: [] as any[] })
        : supabase.from('follows').select('target_type, target_id').eq('follower_id', userId),
    ]);
    const profile = profileResult.data;

    const activeUnfinishedNovels = new Set<string>();
    const seenNovels = new Set<string>();

    const negativeVector = MathUtils.safeParseVector(profile?.negative_vector);
    const longTerm = MathUtils.safeParseVector(profile?.long_term_vector);
    const midTerm = MathUtils.safeParseVector(profile?.mid_term_vector);

    // ✅ FIX SG-8: Pre-compute author affinity map in one pass.
    let authorAffinity: Record<string, number> = MathUtils.safeParseVector(profile?.author_affinity);
    let genreAffinity: Record<string, number> = MathUtils.safeParseVector(profile?.genre_affinity);

    const latestStateByNovel = new Map<string, string>();
    const activeEvents = new Set(['chapter_start', 'chapter_progress', 'chapter_complete', 'return_to_novel', 'reopen_novel']);
    const terminalEvents = new Set(['novel_complete', 'remove_from_library', 'hide', 'not_interested', 'report', 'fast_exit']);

    if (loadedRecentEvents && loadedRecentEvents.length > 0) {
      for (const ev of loadedRecentEvents) {
        seenNovels.add(ev.novel_id);

        if (!latestStateByNovel.has(ev.novel_id)) {
          if (activeEvents.has(ev.event_type || ev.event)) {
            latestStateByNovel.set(ev.novel_id, 'active');
          } else if (terminalEvents.has(ev.event_type || ev.event)) {
            latestStateByNovel.set(ev.novel_id, 'terminal');
          }
        }
      }

      for (const [novelId, state] of latestStateByNovel.entries()) {
        if (state === 'active') activeUnfinishedNovels.add(novelId);
      }

      const eventAuthorAffinity: Record<string, number> = {};
      for (const ev of loadedRecentEvents) {
        if (!ev.author_id) continue;
        const reward = AUTHOR_EVENT_REWARDS[ev.event] || AUTHOR_EVENT_REWARDS[ev.event_type] || 0;
        if (reward > 0) {
          eventAuthorAffinity[ev.author_id] = (eventAuthorAffinity[ev.author_id] || 0) + reward;
        }
      }
      for (const author of Object.keys(eventAuthorAffinity)) {
        const raw = eventAuthorAffinity[author];
        eventAuthorAffinity[author] = MathUtils.clamp(MathUtils.sigmoid(raw * 0.05) * 2 - 0.9, 0, 1);
      }
      authorAffinity = mergeAffinityMaps(authorAffinity, eventAuthorAffinity);
    }

    const reading = (readingResult.data || []).map((row: any) => ({
      novelId: row.novel_id,
      scrollPercentage: row.scroll_percentage,
      completed: row.completed,
    }));
    const bookmarks = (bookmarkResult.data || []).map((row: any) => ({
      novelId: row.novel_id,
      shelfStatus: row.shelf_status,
    }));
    const follows = (followResult.data || []).map((row: any) => ({
      targetType: row.target_type,
      targetId: row.target_id,
    }));
    const explicitNovelIds = Array.from(new Set([
      ...reading.map((item: any) => item.novelId),
      ...bookmarks.map((item: any) => item.novelId),
      ...follows.filter((item: any) => item.targetType === 'novel').map((item: any) => item.targetId),
    ].filter(Boolean)));
    const { data: explicitNovelMetadata } = explicitNovelIds.length
      ? await supabase.from('novels').select('id, genre, author_id').in('id', explicitNovelIds)
      : { data: [] as any[] };
    const explicitPreferences = buildExplicitPreferenceSignals({
      novels: (explicitNovelMetadata || []).map((row: any) => ({ novelId: row.id, genre: row.genre, authorId: row.author_id })),
      reading,
      bookmarks,
      follows,
    });
    explicitPreferences.seenNovels.forEach((id) => seenNovels.add(id));
    explicitPreferences.activeUnfinishedNovels.forEach((id) => activeUnfinishedNovels.add(id));
    authorAffinity = mergeAffinityMaps(authorAffinity, explicitPreferences.authorAffinity);
    genreAffinity = mergeAffinityMaps(genreAffinity, explicitPreferences.genreAffinity);

    return {
      longTerm,
      midTerm,
      negative: negativeVector,
      preferredLength: profile?.preferred_length || 1500,
      exploreWillingness: profile?.explore_willingness || 1.0,
      activeUnfinishedNovels,
      seenNovels,
      authorAffinity,
      genreAffinity,
      churnRisk: profile?.churn_risk || 0.1,
      profileVersion: profile?.profile_version || 1
    };
  }

  public async getRecentEvents(userId: string, limit: number = 200): Promise<UserEvent[]> {
    const { data } = await supabase
      .from('suggestion_user_events')
      .select('event_type, novel_id, chapter, read_time, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return [];

    const novelIds = [...new Set(data.map(d => d.novel_id))];
    const { data: vectorsData } = await supabase
      .from('suggestion_novel_vectors')
      .select('novel_id, vector, author_id')
      .in('novel_id', novelIds);

    const vectorMap = new Map<string, Record<string, number>>();
    const authorMap = new Map<string, string>();
    if (vectorsData) {
      vectorsData.forEach(v => {
        vectorMap.set(v.novel_id, MathUtils.safeParseVector(v.vector));
        authorMap.set(v.novel_id, v.author_id || '');
      });
    }

    return data.map(d => ({
      event: d.event_type,
      novel_id: d.novel_id,
      author_id: authorMap.get(d.novel_id) || '',
      novel_vector: vectorMap.get(d.novel_id) || {},
      chapter: d.chapter,
      read_time: d.read_time,
      timestamp: new Date(d.created_at).getTime()
    }));
  }

  public async getNovel(novelId: string): Promise<Novel | null> {
    const [{ data: vec }, { data: stats }] = await Promise.all([
      supabase.from('suggestion_novel_vectors').select('*').eq('novel_id', novelId).single(),
      supabase.from('suggestion_novel_stats').select('*').eq('novel_id', novelId).single()
    ]);

    if (!vec || !stats) return null;

    return this.mapToNovel(vec, stats);
  }

  /**
   * ✅ FIX SG-3: activeUnfinished is now used as a Set (via .has()) instead
   * of being converted to an Array and searched with .includes() (O(n) per
   * lookup). This reduces candidate filtering from O(n²) to O(n).
   *
   * ✅ FIX SG-7: The fallback backfill is now guarded by a Redis lock so
   * only one request per 5 minutes triggers it. Previously, every request
   * that hit the empty-candidate path would spawn a full backfill, which
   * could DoS the database under load.
   */
  public async getCandidateNovels(user: User, context: Context, limit: number = 200): Promise<Novel[]> {
    const idSet = new Set<string>();
    const sourcesMap = new Map<string, string[]>();

    const addSource = (id: string, src: string) => {
      if (!sourcesMap.has(id)) sourcesMap.set(id, []);
      sourcesMap.get(id)!.push(src);
    };

    // ✅ FIX SG-3: Keep as Set, do NOT convert to Array.
    const activeUnfinished = user.activeUnfinishedNovels || new Set<string>();

    const topGenres = Object.entries(user.genreAffinity || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre]) => genre);

    const topAuthors = Object.entries(user.authorAffinity || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([authorId]) => authorId);

    const [topEngagementRes, recentRes, popularRes, genreRes, authorRes] = await Promise.all([
      supabase.from('suggestion_novel_stats').select('novel_id').order('engagement_24h', { ascending: false }).limit(Math.floor(limit * 0.4)),
      supabase.from('suggestion_novel_vectors').select('novel_id').order('created_at', { ascending: false }).limit(Math.floor(limit * 0.4)),
      supabase.from('suggestion_novel_stats').select('novel_id').order('impressions', { ascending: false }).limit(Math.floor(limit * 0.2)),
      topGenres.length > 0 ? supabase.from('suggestion_novel_vectors').select('novel_id').in('genre', topGenres).limit(Math.floor(limit * 0.2)) : Promise.resolve({ data: [] }),
      topAuthors.length > 0 ? supabase.from('suggestion_novel_vectors').select('novel_id').in('author_id', topAuthors).limit(Math.floor(limit * 0.2)) : Promise.resolve({ data: [] })
    ]);

    topEngagementRes.data?.forEach(row => { idSet.add(row.novel_id); addSource(row.novel_id, 'trending'); });
    recentRes.data?.forEach(row => { idSet.add(row.novel_id); addSource(row.novel_id, 'fresh'); });
    popularRes.data?.forEach(row => { idSet.add(row.novel_id); addSource(row.novel_id, 'popular'); });
    genreRes.data?.forEach(row => { idSet.add(row.novel_id); addSource(row.novel_id, 'personalized_genre'); });
    authorRes.data?.forEach(row => { idSet.add(row.novel_id); addSource(row.novel_id, 'personalized_author'); });

    // ✅ FIX SG-3: Use Set.forEach instead of Array.from + forEach.
    activeUnfinished.forEach(id => { idSet.add(id); addSource(id, 'continue_reading'); });

    const blocked = new Set<string>();
    const impressionsMap = new Map<string, number>();
    const positiveMap = new Set<string>();

    if (user.recentEvents) {
      for (const e of user.recentEvents) {
        if (['hide', 'not_interested', 'report', 'remove_from_library', 'unfollow', 'fast_exit'].includes(e.event)) {
          blocked.add(e.novel_id);
        }
        if (e.event === 'impression' || e.event === 'impression_no_click') {
          impressionsMap.set(e.novel_id, (impressionsMap.get(e.novel_id) || 0) + 1);
        }
        if (['click', 'chapter_start', 'bookmark', 'follow', 'library_add'].includes(e.event)) {
          positiveMap.add(e.novel_id);
        }
      }
    }

    const filteredIdSet = new Set<string>();
    const activeIds: string[] = [];
    const otherIds: string[] = [];

    for (const d of idSet) {
      if (!blocked.has(d)) {
        // ✅ FIX SG-3: Use Set.has() — O(1) instead of Array.includes() O(n).
        if ((impressionsMap.get(d) || 0) >= 3 && !positiveMap.has(d) && !activeUnfinished.has(d)) {
          continue;
        }
        filteredIdSet.add(d);

        if (activeUnfinished.has(d)) {
          activeIds.push(d);
        } else {
          otherIds.push(d);
        }
      }
    }

    let novelIds = [
      ...activeIds.slice(0, 50),
      ...otherIds
    ].slice(0, 400);

    if (novelIds.length === 0) {
      // ✅ FIX SG-7: Use a Redis lock to ensure only one request per 5 minutes
      // triggers the backfill. Without this, concurrent empty-candidate
      // requests would each spawn a full backfill, causing DB DoS.
      const backfillLockKey = 'suggestion:backfill:running';
      const acquired = await cache.markOnce(backfillLockKey, 300).catch(() => false);
      if (acquired) {
        // Run backfill in the background — do not block the request on it.
        backfillSuggestionArtifacts(Math.min(limit, 200)).catch(() => 0);
      }
      const { data: fallback } = await supabase.from('suggestion_novel_stats').select('novel_id').order('impressions', {ascending: false}).limit(50);
      if (fallback) {
        fallback.forEach(f => {
          if (!blocked.has(f.novel_id)) {
            novelIds.push(f.novel_id);
            addSource(f.novel_id, 'fallback');
          }
        });
      }
    }

    if (novelIds.length === 0) return [];

    const { data: vectors } = await supabase.from('suggestion_novel_vectors').select('*').in('novel_id', novelIds);
    if (!vectors) return [];

    const { data: stats } = await supabase.from('suggestion_novel_stats').select('*').in('novel_id', novelIds);

    const statsMap = new Map();
    if (stats) {
      stats.forEach(s => statsMap.set(s.novel_id, s));
    }

    const novels: Novel[] = [];
    for (const vec of vectors) {
      if (vec.author_id && vec.author_id === user.id) continue;
      const s = statsMap.get(vec.novel_id) || {};
      const mapped = this.mapToNovel(vec, s);
      mapped.sources = sourcesMap.get(vec.novel_id) || ['fallback'];
      novels.push(mapped);
    }

    return novels;
  }

  private mapToNovel(vec: any, stats: any): Novel {
    const createdAt = vec.created_at ? new Date(vec.created_at).getTime() : Date.now();
    return {
      id: vec.novel_id,
      vector: MathUtils.safeParseVector(vec.vector),
      genre: vec.genre || '',
      author: vec.author_id || '',
      avgChapterLength: vec.avg_chapter_length || 1500,

      impressions: stats.impressions || 0,
      clicks: stats.clicks || 0,
      ch1Complete: stats.ch1_complete || 0,
      ch5Complete: stats.ch5_complete || 0,
      ch10Complete: stats.ch10_complete || 0,
      follows: stats.follows || 0,
      comments: stats.comments || 0,
      likes: stats.likes || 0,
      shares: stats.shares || 0,
      views: stats.views || 0,

      ageHours: Math.max(0, (Date.now() - createdAt) / 3600000),
      engagement24h: stats.engagement_24h || 0,
      engagement7d: stats.engagement_7d || 0,

      ctrGlobal: stats.ctr_global || 0.05,
      r5Global: stats.r5_global || 0.2,
      r10Global: stats.r10_global || 0.1,

      qualityAIWriting: vec.quality_ai_writing || 0.5,
      qualityAIHook: vec.quality_ai_hook || 0.5,
      qualityAICharacter: vec.quality_ai_character || 0.5,
      qualityAIWorld: vec.quality_ai_world || 0.5,

      reportRate: (stats.reports || 0) / Math.max(1, stats.impressions || 1),
      fastExitRate: (stats.fast_exits || 0) / Math.max(1, stats.clicks || 1)
    };
  }

  private applyRewardUpdate(profile: any, nVec: Record<string, number>, reward: number) {
    const UM = { ...(profile.midTerm || {}) };
    const UL = { ...(profile.longTerm || {}) };
    const UNeg = { ...(profile.negative || {}) };

    const eta_M = 0.03;
    const eta_L = 0.005;

    if (reward > 0) {
      for (const [key, val] of Object.entries(nVec)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const x = Number(val) || 0;
        UM[key] = (1 - eta_M) * (UM[key] || 0) + eta_M * reward * x;
        UL[key] = (1 - eta_L) * (UL[key] || 0) + eta_L * reward * x;
      }
    } else if (reward < 0) {
      for (const [key, val] of Object.entries(nVec)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const x = Number(val) || 0;
        UNeg[key] = (1 - eta_M) * (UNeg[key] || 0) + Math.abs(eta_M * reward * x);
      }
    }

    return {
      UM: MathUtils.l2Normalize(UM),
      UL: MathUtils.l2Normalize(UL),
      UNeg: MathUtils.l2Normalize(UNeg)
    };
  }

  /**
   * ✅ FIX SG-4: Use a database transaction with SELECT FOR UPDATE instead
   * of an optimistic-locking retry loop. This guarantees that:
   *   1. The event insert and profile update are atomic.
   *   2. No event is lost if the profile update fails.
   *   3. No race condition can cause lost updates.
   *
   * Previously, the event was always inserted first (even if profile update
   * failed), and 3 retries with optimistic locking could all fail under
   * concurrency, silently dropping the profile update.
   */
  public async logEventAndUpdateProfile(userId: string, novelId: string, event: string, readTime: number = 0, chapter: number = 0) {
    try {
      await db.withTransaction(async (client) => {
        // 1. Insert event inside the transaction.
        await client.query(
          `INSERT INTO suggestion_user_events (user_id, novel_id, event_type, read_time, chapter)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, novelId, event, readTime, chapter]
        );

        // 2. Update novel stats inside the same transaction.
        // (recordSuggestionStatsEvent uses supabase, not the transaction client,
        //  so we run it outside the transaction. But we still want the event
        //  insert to be atomic with the profile update.)

        // 3. Fetch novel vector.
        const vecResult = await client.query(
          `SELECT vector FROM suggestion_novel_vectors WHERE novel_id = $1`,
          [novelId]
        );
        const novelVecRaw = vecResult.rows[0]?.vector;
        if (!novelVecRaw) return;
        const nVec = MathUtils.safeParseVector(novelVecRaw);

        const reward = EVENT_REWARDS[event] || 0;

        // 4. Lock the user profile row for the duration of the transaction.
        const profileResult = await client.query(
          `SELECT * FROM suggestion_user_profiles WHERE user_id = $1 FOR UPDATE`,
          [userId]
        );
        const rawProfile = profileResult.rows[0];

        // ✅ CRITICAL FIX: Map DB column names to the property names that
        // applyRewardUpdate expects. The DB columns are named
        // `long_term_vector`, `mid_term_vector`, `negative_vector`, but
        // applyRewardUpdate accesses `profile.longTerm`, `profile.midTerm`,
        // `profile.negative`. Without this mapping, the vectors would
        // always be undefined, causing complete data loss on every event.
        const currentProfile = rawProfile ? {
          midTerm: MathUtils.safeParseVector(rawProfile.mid_term_vector),
          longTerm: MathUtils.safeParseVector(rawProfile.long_term_vector),
          negative: MathUtils.safeParseVector(rawProfile.negative_vector),
          profile_version: rawProfile.profile_version || 0,
        } : {};

        const { UM, UL, UNeg } = this.applyRewardUpdate(currentProfile, nVec, reward);
        const oldVersion = currentProfile.profile_version || 0;
        const newVersion = oldVersion + 1;

        if (rawProfile) {
          // 5. Update existing profile (no optimistic lock needed — row is locked).
          await client.query(
            `UPDATE suggestion_user_profiles
                SET long_term_vector = $1,
                    mid_term_vector = $2,
                    negative_vector = $3,
                    profile_version = $4,
                    updated_at = now()
              WHERE user_id = $5`,
            [JSON.stringify(UL), JSON.stringify(UM), JSON.stringify(UNeg), newVersion, userId]
          );
        } else {
          // 6. Insert new profile if it doesn't exist yet.
          await client.query(
            `INSERT INTO suggestion_user_profiles
                (user_id, long_term_vector, mid_term_vector, negative_vector, profile_version, updated_at)
             VALUES ($1, $2, $3, $4, 1, now())
             ON CONFLICT (user_id) DO UPDATE
                SET long_term_vector = EXCLUDED.long_term_vector,
                    mid_term_vector = EXCLUDED.mid_term_vector,
                    negative_vector = EXCLUDED.negative_vector,
                    profile_version = suggestion_user_profiles.profile_version + 1,
                    updated_at = now()`,
            [userId, JSON.stringify(UL), JSON.stringify(UM), JSON.stringify(UNeg)]
          );
        }
      });

      // Update novel stats outside the transaction (uses supabase, not client).
      await recordSuggestionStatsEvent(novelId, event, chapter).catch(() => {});
    } catch (err: any) {
      // ✅ FIX SG-4: Log the error so failures are visible. Previously,
      // failures were silently swallowed.
      console.warn("[suggestion] logEventAndUpdateProfile failed (non-fatal):", err?.message || err);
    }
  }

  public async logRecommendationDecision(userId: string, context: Context, returned: Novel[], allCandidates: any[], meta: any) {
    const items = returned.map((n, i) => ({ novel_id: n.id, position: i }));
    try {
      await supabase.from('suggestion_recommendation_logs').insert({
        user_id: userId,
        session_id: context.sessionId || 'anonymous',
        candidate_count: meta.candidateCount || allCandidates.length,
        returned_count: returned.length,
        ranking_version: meta.rankingVersion || 'v1',
        model_version: meta.modelVersion || 'v1',
        items: items,
        surface: context.position || 0
      });
    } catch (e) {
      console.warn("Recommendation log failed, non-blocking", e);
    }
  }
}
