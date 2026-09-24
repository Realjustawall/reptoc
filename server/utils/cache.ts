import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';

interface CacheEnvelope<T> {
  data: T;
  timestamp: number;
}

class CacheManager {
  private redis: Redis | null = null;
  private lruCache: LRUCache<string, any>;
  private fetchPromises = new Map<string, Promise<any>>();
  private readonly redisNamespace = "reptoc:";

  // ✅ SECURITY: Bound the total byte size of the in-process LRU cache.
  // Without this, an attacker (or just a popular novel) could push thousands
  // of large entries and exhaust process memory.
  private readonly MAX_LRU_BYTES = Number(process.env.CACHE_MAX_BYTES || 64 * 1024 * 1024); // 64MB default

  private redisKey(key: string): string {
    return `${this.redisNamespace}${key}`;
  }

  constructor() {
    this.lruCache = new LRUCache({
      max: 5000,
      ttl: 1000 * 60 * 15, // 15 minutes by default
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      // ✅ SECURITY: Bound the total size of cached entries.
      // (lru-cache 11+ supports a sizeCalculation + maxSize pair.)
      sizeCalculation: (value) => {
        try {
          // Approximate byte size of the value.
          return JSON.stringify(value).length * 2; // JS strings are UTF-16
        } catch {
          return 1024; // fallback for non-serializable values
        }
      },
      maxSize: this.MAX_LRU_BYTES,
    });

    if (process.env.REDIS_URL) {
      try {
        this.redis = new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            if (times > 3) {
              return null; // Stop retrying, fallback to lru-cache
            }
            return Math.min(times * 100, 3000);
          }
        });

        this.redis.on('error', (err) => {
          console.warn('Redis Cache Error, falling back to LRU:', err.message);
        });

        this.redis.on('connect', () => {
          console.log('Redis connected successfully for caching.');
        });
      } catch (err) {
        console.warn('Failed to initialize Redis:', err);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const data = await this.redis.get(this.redisKey(key));
        if (data) {
          return JSON.parse(data) as T;
        }
        return null; // source of truth is Redis, do not fallback to LRU
      } catch (err) {
        console.warn('Redis read error, reading from LRU:', err);
      }
    }

    const lruData = this.lruCache.get(key);
    return lruData !== undefined ? (lruData as T) : null;
  }

  async set(key: string, value: any, ttlSeconds: number = 900): Promise<void> {
    this.lruCache.set(key, value, { ttl: ttlSeconds * 1000 });

    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.set(this.redisKey(key), JSON.stringify(value), 'EX', ttlSeconds);
      } catch (err) {
        console.warn('Redis write error:', err);
      }
    }
  }

  /**
   * Load a value once per key and share the same promise across concurrent misses.
   *
   * ✅ SECURITY: The promise stored in `fetchPromises` is wrapped so that
   * any rejection (from either the fetcher or the cache `set`) is converted
   * to a resolved null. This prevents unhandled-promise-rejection crashes
   * under load, and prevents one failed write from poisoning concurrent
   * readers that are awaiting the same key.
   */
  async remember<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds: number = 300): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.fetchPromises.get(key);
    if (existing) return existing as Promise<T>;

    const request = (async () => {
      try {
        const value = await fetchFn();
        await this.set(key, value, ttlSeconds).catch((err) => {
          console.warn('Cache write error (non-fatal):', err);
        });
        return value;
      } catch (err) {
        console.warn('Cache fetchFn error (non-fatal):', err);
        // ✅ SECURITY: Resolve to null on error so concurrent waiters don't crash.
        return null as T;
      }
    })();

    this.fetchPromises.set(key, request);
    try {
      return await request;
    } finally {
      this.fetchPromises.delete(key);
    }
  }

  /**
   * Security-sensitive cache-aside lookup. If a configured Redis service is
   * unavailable or errors, bypass every in-process stale value and consult the
   * database loader. This prevents an outage from preserving revoked access.
   */
  async rememberAuthoritative<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds = 60): Promise<T> {
    if (!this.redis) return this.remember(key, fetchFn, ttlSeconds);
    if (this.redis.status !== 'ready') return fetchFn();
    try {
      const raw = await this.redis.get(this.redisKey(key));
      if (raw !== null) return JSON.parse(raw) as T;
    } catch (error) {
      console.warn('Authoritative Redis read failed; bypassing cache:', error);
      return fetchFn();
    }
    const existing = this.fetchPromises.get(`authoritative:${key}`);
    if (existing) return existing as Promise<T>;
    // ✅ SECURITY: Same wrapper pattern — never let a rejected promise
    // leak into the fetchPromises map.
    const pending = (async () => {
      try {
        const value = await fetchFn();
        await this.set(key, value, ttlSeconds).catch(() => {});
        return value;
      } catch (err) {
        console.warn('Authoritative fetchFn error (non-fatal):', err);
        return null as T;
      }
    })();
    this.fetchPromises.set(`authoritative:${key}`, pending);
    try { return await pending; } finally { this.fetchPromises.delete(`authoritative:${key}`); }
  }

  async del(key: string): Promise<void> {
    this.lruCache.delete(key);
    if (this.redis && this.redis.status === 'ready') {
      try {
        await this.redis.del(this.redisKey(key));
      } catch (err) {
        console.warn('Redis delete error:', err);
      }
    }
  }

  async clearPrefix(prefix: string): Promise<void> {
    for (const key of this.lruCache.keys()) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        this.lruCache.delete(key);
      }
    }

    if (this.redis && this.redis.status === 'ready') {
      try {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${this.redisNamespace}${prefix}*`, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await this.redis.del(...keys);
          }
        } while (cursor !== '0');
      } catch (err) {
        console.warn('Redis clearPrefix error:', err);
      }
    }
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const multi = this.redis.multi();
        const namespacedKey = this.redisKey(key);
        multi.incr(namespacedKey);
        multi.expire(namespacedKey, ttlSeconds, 'NX');
        const result = await multi.exec();
        const value = result?.[0]?.[1];
        return typeof value === 'number' ? value : Number(value || 0);
      } catch (err) {
        console.warn('Redis increment error, using LRU:', err);
      }
    }

    const existing = Number(this.lruCache.get(key) || 0) + 1;
    this.lruCache.set(key, existing, { ttl: ttlSeconds * 1000 });
    return existing;
  }

  async markOnce(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const result = await this.redis.set(this.redisKey(key), '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch (err) {
        console.warn('Redis markOnce error, using LRU:', err);
      }
    }

    if (this.lruCache.has(key)) return false;
    this.lruCache.set(key, true, { ttl: ttlSeconds * 1000 });
    return true;
  }

  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; count: number; remaining: number }> {
    const count = await this.increment(key, windowSeconds);
    return {
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count)
    };
  }

  /**
   * Stale-While-Revalidate pattern with Cache Stampede prevention (Promise caching).
   *
   * ✅ SECURITY: All background fetches now have `.catch()` handlers to
   * prevent unhandled-promise-rejection crashes.
   */
  async getWithSWR<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = 300,        // Time before data becomes stale
    swrSeconds: number = 86400 * 7   // Max time data can live in cache (7 days)
  ): Promise<T> {
    const cachedRaw = await this.getRaw(key);

    if (cachedRaw !== undefined && cachedRaw !== null) {
      try {
        const envelope: CacheEnvelope<T> = typeof cachedRaw === 'string'
          ? JSON.parse(cachedRaw, (_key, value) => value?.__cacheType === 'Set' && Array.isArray(value.values) ? new Set(value.values) : value)
          : cachedRaw;
        const ageSeconds = (Date.now() - envelope.timestamp) / 1000;

        if (ageSeconds < ttlSeconds) {
          // completely fresh
          return envelope.data;
        }

        if (ageSeconds < swrSeconds) {
          // stale but acceptable, trigger bg refresh and return stale
          this.triggerBackgroundFetch(key, fetchFn, swrSeconds);
          return envelope.data;
        }
      } catch (e) {
        // parsing failed, act as miss
      }
    }

    // miss or too stale, fetch sync
    return this.dedupedFetch(key, fetchFn, swrSeconds);
  }

  private triggerBackgroundFetch(key: string, fetchFn: () => Promise<any>, maxTtlS: number) {
    if (this.fetchPromises.has(key)) return;
    // ✅ SECURITY: Always attach a `.catch()` so a background fetch failure
    // cannot cause an unhandled-promise-rejection crash.
    this.dedupedFetch(key, fetchFn, maxTtlS).catch(e => console.warn('Bg SWR fetch failed:', e?.message || e));
  }

  private async dedupedFetch<T>(key: string, fetchFn: () => Promise<T>, maxTtlS: number): Promise<T> {
    if (this.fetchPromises.has(key)) {
      return this.fetchPromises.get(key)!;
    }

    // ✅ SECURITY: Wrap the fetchFn so any rejection becomes a resolved null.
    // This guarantees the promise in fetchPromises never rejects, which means
    // concurrent waiters won't crash on unhandled rejections.
    const promise = (async () => {
      try {
        const data = await fetchFn();
        const envelope: CacheEnvelope<T> = { data, timestamp: Date.now() };

        this.lruCache.set(key, envelope, { ttl: maxTtlS * 1000 });
        if (this.redis && this.redis.status === 'ready') {
          try {
            await this.redis.set(this.redisKey(key), JSON.stringify(envelope, (_key, value) =>
              value instanceof Set ? { __cacheType: 'Set', values: Array.from(value) } : value
            ), 'EX', maxTtlS);
          } catch (e) {
            console.warn('Redis write in dedupedFetch failed (non-fatal):', e);
          }
        }
        return data;
      } catch (err) {
        console.warn('dedupedFetch fetchFn error (non-fatal):', err);
        return null as T;
      }
    })();

    this.fetchPromises.set(key, promise);
    try {
      return await promise;
    } finally {
      this.fetchPromises.delete(key);
    }
  }

  private async getRaw(key: string): Promise<any> {
    if (this.redis && this.redis.status === 'ready') {
      try {
        const data = await this.redis.get(this.redisKey(key));
        return data; // if null, it means it's correctly deleted from Redis, don't fallback to LRU
      } catch(e){
        console.warn('Redis read error, reading from LRU:', e);
      }
    }
    return this.lruCache.get(key);
  }
}

export const cache = new CacheManager();
