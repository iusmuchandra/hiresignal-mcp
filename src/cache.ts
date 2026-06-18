interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export interface CacheOptions {
  defaultTtlMs: number;
  maxEntries?: number;
}

export class TtlCache<V = unknown> {
  private readonly store = new Map<string, CacheEntry<V>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(opts: CacheOptions) {
    this.defaultTtlMs = opts.defaultTtlMs;
    this.maxEntries = opts.maxEntries ?? 1000;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // LRU touch
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt });
    this.evictIfNeeded();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  async getOrCompute(
    key: string,
    compute: () => Promise<V>,
    ttlMs?: number
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }
}

export function stableKey(parts: Record<string, unknown>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parts[k] ?? null)}`)
    .join("|");
  return sorted;
}

export const jobSearchCache = new TtlCache<unknown>({
  defaultTtlMs: 15 * 60 * 1000,
  maxEntries: 500,
});
