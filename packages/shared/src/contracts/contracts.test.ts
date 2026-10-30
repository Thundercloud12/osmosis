import { describe, expect, it } from "vitest";

import { clientCommandSchema, matchSettingsSchema, roomCreationOptionsSchema } from "./index";

describe("client command contract", () => {
  it("accepts normalized movement intent", () => {
    expect(clientCommandSchema.safeParse({ type: "move", seq: 1, dx: -1, dy: 1 }).success).toBe(true);
  });

  it("rejects coordinates disguised as movement intent", () => {
    expect(clientCommandSchema.safeParse({ type: "move", seq: 2, dx: 48, dy: 0 }).success).toBe(false);
  });

  it("accepts a simple Help command without trusting client-supplied location or category", () => {
    expect(clientCommandSchema.safeParse({ type: "ping" }).success).toBe(true);
    expect(clientCommandSchema.safeParse({ type: "ping", x: 120, y: 240, kind: "attack" }).success).toBe(false);
  });
});

describe("match settings contract", () => {
  it("accepts official formats, gated test formats, and supported durations", () => {
    expect(matchSettingsSchema.safeParse({ teamSize: 4, matchDurationSeconds: 300 }).success).toBe(true);
    expect(matchSettingsSchema.safeParse({ teamSize: 5, matchDurationSeconds: 1_800 }).success).toBe(true);
    expect(matchSettingsSchema.safeParse({ teamSize: 1, matchDurationSeconds: 900 }).success).toBe(true);
    expect(roomCreationOptionsSchema.safeParse({ nickname: "Crew", matchSettings: { teamSize: 4 } }).success).toBe(true);
  });

  it("rejects unsupported team sizes and durations outside the 5–30 minute minute-step range", () => {
    expect(matchSettingsSchema.safeParse({ teamSize: 3, matchDurationSeconds: 900 }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ teamSize: 4, matchDurationSeconds: 299 }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ teamSize: 4, matchDurationSeconds: 301 }).success).toBe(false);
    expect(matchSettingsSchema.safeParse({ teamSize: 5, matchDurationSeconds: 1_801 }).success).toBe(false);
    expect(roomCreationOptionsSchema.safeParse({ matchSettings: { teamSize: 4, matchDurationSeconds: 3 } }).success).toBe(false);
  });
});
