/**
 * Minimal fixed-window rate limiter keyed by an arbitrary string (session id, endpoint, ...).
 */
export class RateLimiter {
  private hits: Map<string, { count: number; windowStart: number }> = new Map();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  public allow(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}
