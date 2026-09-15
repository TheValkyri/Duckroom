/**
 * Bounded In-Memory LRU (Least Recently Used) Cache with TTL.
 *
 * Designed for serverless execution environments:
 * - Constant-time O(1) reads, updates, and evictions via JavaScript Map order preservation.
 * - Automatic eviction of oldest entry when capacity is reached.
 * - Time-To-Live (TTL) expiration per entry with lazy eviction and proactive pruning.
 * - Zero node built-in imports: completely safe for both client boundary and server runtimes.
 */

export interface LruCacheOptions {
  /** Maximum number of entries before eviction occurs. Minimum 1. */
  maxSize: number;
  /** Default Time-To-Live in milliseconds. Defaults to 60,000ms (60s). */
  ttlMs?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(options: LruCacheOptions) {
    this.maxSize = Math.max(1, options.maxSize);
    this.defaultTtlMs = options.ttlMs && options.ttlMs > 0 ? options.ttlMs : 60_000;
  }

  /**
   * Retrieves a value by key.
   * If the key exists and has not expired, marks it as most recently used and returns the value.
   * If expired, removes the key and returns undefined.
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency in Map (delete then re-insert moves key to the end)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * Stores a value by key with an optional custom TTL.
   * If capacity is exceeded, prunes expired entries first; if still full, evicts the least recently used entry.
   */
  set(key: K, value: V, customTtlMs?: number): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    const ttl = customTtlMs !== undefined ? Math.max(0, customTtlMs) : this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;

    // If at or over capacity, attempt prune first
    if (this.entries.size >= this.maxSize) {
      this.prune();
    }

    // If still at capacity, evict the oldest (first key in Map iterator)
    if (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, { value, expiresAt });
  }

  /**
   * Checks if a non-expired key exists in the cache.
   */
  has(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Removes a specific key from the cache.
   */
  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Scans and removes all expired entries. Returns the number of pruned entries.
   */
  prune(now = Date.now()): number {
    let pruned = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Removes entries matching a custom predicate. Returns the count of deleted entries.
   */
  deleteWhere(predicate: (value: V, key: K) => boolean): number {
    let deleted = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (predicate(entry.value, key)) {
        this.entries.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Returns current count of entries in the cache.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Returns configured maximum capacity.
   */
  get capacity(): number {
    return this.maxSize;
  }
}
