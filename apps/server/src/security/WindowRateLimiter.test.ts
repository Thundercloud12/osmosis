import { describe, expect, it } from "vitest";

import { WindowRateLimiter } from "./WindowRateLimiter";

describe("WindowRateLimiter", () => {
  it("allows the configured count, blocks excess requests, and resets at the window boundary", () => {
    const limiter = new WindowRateLimiter();
    expect(limiter.allow("ip", 2, 1_000, 10_000)).toBe(true);
    expect(limiter.allow("ip", 2, 1_000, 10_001)).toBe(true);
    expect(limiter.allow("ip", 2, 1_000, 10_002)).toBe(false);
    expect(limiter.allow("ip", 2, 1_000, 11_000)).toBe(true);
  });

  it("clears a scoped limiter state for isolated server lifecycle tests", () => {
    const limiter = new WindowRateLimiter();
    expect(limiter.allow("ip", 1, 1_000, 10_000)).toBe(true);
    expect(limiter.allow("ip", 1, 1_000, 10_001)).toBe(false);
    limiter.clear();
    expect(limiter.allow("ip", 1, 1_000, 10_002)).toBe(true);
  });
});
