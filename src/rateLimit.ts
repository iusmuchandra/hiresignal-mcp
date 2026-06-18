import { RateLimitedError } from "./errors.js";

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
  }

  consume(key: string, cost = 1): void {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens < cost) {
      const deficit = cost - bucket.tokens;
      const retryAfterSec = Math.ceil(deficit / this.refillPerSecond);
      throw new RateLimitedError(retryAfterSec);
    }
    bucket.tokens -= cost;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

// 30 calls/min sustained, with a small burst capacity.
export const toolRateLimiter = new TokenBucketLimiter({
  capacity: 30,
  refillPerSecond: 30 / 60,
});
