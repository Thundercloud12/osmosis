import { describe, expect, it } from "vitest";
import { roomModeAllowed } from "./RoomModePolicy";

describe("temporary room-mode policy", () => {
  it("keeps 1v1 and 2v2 enabled for development and denies them in production by default", () => {
    expect(roomModeAllowed("STANDARD", { NODE_ENV: "production" })).toBe(true);
    expect(roomModeAllowed("TEST_1V1", { NODE_ENV: "development" })).toBe(true);
    expect(roomModeAllowed("TEST_2V2", { NODE_ENV: "production" })).toBe(false);
  });

  it("allows an explicit production override for a controlled test deployment", () => {
    expect(roomModeAllowed("TEST_2V2", { NODE_ENV: "production", ENABLE_TEST_ROOM_MODES: "true" })).toBe(true);
  });
});
