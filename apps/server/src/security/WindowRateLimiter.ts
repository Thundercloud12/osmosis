interface WindowEntry { startedAt: number; count: number }

/** Small process-local limiter for the documented single-instance server. */
export class WindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  clear(): void { this.entries.clear(); }

  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const current = this.entries.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      this.prune(now, windowMs);
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  private prune(now: number, windowMs: number): void {
    if (this.entries.size < 2_048) return;
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= windowMs) this.entries.delete(key);
    }
  }
}
