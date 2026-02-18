/**
 * KV Namespace Adapter — Redis + In-Memory implementations
 *
 * Provides the Cloudflare KVNamespace interface backed by either Redis (ioredis)
 * for multi-node deployments or an in-memory Map for single-node / dev use.
 *
 * All methods are fail-open: errors return null/void rather than throwing,
 * preserving the same resilience pattern the gateway uses with CF KV.
 */

import { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// KVNamespace interface (mirrors @cloudflare/workers-types)
// ---------------------------------------------------------------------------

export interface KVNamespace {
  get(key: string, options?: { type?: string }): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string, type: 'text'): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Redis KV Adapter
// ---------------------------------------------------------------------------

export class RedisKVAdapter implements KVNamespace {
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(redis: Redis, prefix = 'kv:') {
    this.redis = redis;
    this.prefix = prefix;
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string, typeOrOptions?: string | { type?: string }): Promise<any> {
    try {
      const raw = await this.redis.get(this.key(key));
      if (raw === null) return null;

      const type =
        typeof typeOrOptions === 'string'
          ? typeOrOptions
          : typeOrOptions?.type ?? 'text';

      if (type === 'json') {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }

      return raw;
    } catch (err) {
      console.error('[RedisKV] get error (fail-open):', err);
      return null;
    }
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    try {
      const redisKey = this.key(key);

      if (options?.expirationTtl && options.expirationTtl > 0) {
        await this.redis.setex(redisKey, options.expirationTtl, value);
      } else if (options?.expiration) {
        // expiration is an absolute Unix timestamp in seconds
        const ttl = Math.max(1, options.expiration - Math.floor(Date.now() / 1000));
        await this.redis.setex(redisKey, ttl, value);
      } else {
        await this.redis.set(redisKey, value);
      }
    } catch (err) {
      console.error('[RedisKV] put error (fail-open):', err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.key(key));
    } catch (err) {
      console.error('[RedisKV] delete error (fail-open):', err);
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    try {
      const scanPrefix = this.key(options?.prefix ?? '');
      const count = options?.limit ?? 1000;
      const startCursor = options?.cursor ?? '0';

      const [nextCursor, rawKeys] = await this.redis.scan(
        startCursor,
        'MATCH',
        `${scanPrefix}*`,
        'COUNT',
        count,
      );

      const keys = rawKeys.map((k) => ({
        name: k.startsWith(this.prefix) ? k.slice(this.prefix.length) : k,
      }));

      return {
        keys,
        list_complete: nextCursor === '0',
        cursor: nextCursor === '0' ? undefined : nextCursor,
      };
    } catch (err) {
      console.error('[RedisKV] list error (fail-open):', err);
      return { keys: [], list_complete: true };
    }
  }

  /** Expose underlying Redis client for health checks. */
  getRedisClient(): Redis {
    return this.redis;
  }
}

// ---------------------------------------------------------------------------
// In-Memory KV Adapter (single-node / dev)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

export class InMemoryKVAdapter implements KVNamespace {
  private readonly store = new Map<string, MemoryEntry>();

  private isExpired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  async get(key: string, typeOrOptions?: string | { type?: string }): Promise<any> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.store.delete(key);
      return null;
    }

    const type =
      typeof typeOrOptions === 'string'
        ? typeOrOptions
        : typeOrOptions?.type ?? 'text';

    if (type === 'json') {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }

    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    let expiresAt: number | null = null;

    if (options?.expirationTtl && options.expirationTtl > 0) {
      expiresAt = Date.now() + options.expirationTtl * 1000;
    } else if (options?.expiration) {
      expiresAt = options.expiration * 1000;
    }

    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;

    const matching: { name: string }[] = [];
    for (const [k, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(k);
        continue;
      }
      if (k.startsWith(prefix)) {
        matching.push({ name: k });
        if (matching.length >= limit) break;
      }
    }

    return { keys: matching, list_complete: true };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createKVAdapter(redisUrl?: string): KVNamespace {
  if (redisUrl) {
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
    return new RedisKVAdapter(redis);
  }
  console.warn('[KV] No REDIS_URL configured — using in-memory KV adapter');
  return new InMemoryKVAdapter();
}
