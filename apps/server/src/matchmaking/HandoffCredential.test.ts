import { describe, expect, it } from "vitest";

import { issueHandoffCredential, issueQuickPlayRoomCredential, verifyHandoffCredential, verifyQuickPlayRoomCredential } from "./HandoffCredential";

describe("Quick Play handoff credentials", () => {
  it("binds a reserved seat to its player, team, room, and expiry", () => {
    const claims = {
      version: 1 as const,
      handoffId: "handoff-1",
      roomId: "arena-1",
      queueRoomId: "queue-1",
      sessionId: "session-1",
      playerId: "player-1",
      nickname: "Crewmate",
      teamId: "BLUE" as const,
      expiresAt: 2_000,
    };
    const credential = issueHandoffCredential(claims);

    expect(verifyHandoffCredential(credential, 1_999)).toEqual(claims);
    expect(verifyHandoffCredential(credential, 2_001)).toBeUndefined();
    expect(verifyHandoffCredential(`${credential.slice(0, -1)}x`, 1_999)).toBeUndefined();
  });

  it("validates unique, balanced-capable room seats and rejects malformed or expired claims", () => {
    const seats = Array.from({ length: 8 }, (_, index) => ({
      sessionId: `session-${index}`,
      playerId: `player-${index}`,
      nickname: `Crew ${index}`,
      teamId: index < 4 ? "BLUE" as const : "RED" as const,
    }));
    const claims = { version: 1 as const, handoffId: "handoff-1", queueRoomId: "queue-1", seats, expiresAt: 2_000 };
    const credential = issueQuickPlayRoomCredential(claims);

    expect(verifyQuickPlayRoomCredential(credential, 1_999)).toEqual(claims);
    expect(verifyQuickPlayRoomCredential(credential, 2_001)).toBeUndefined();

    const duplicateSeats = seats.map((seat, index) => index === 7 ? { ...seat, playerId: seats[0]!.playerId } : seat);
    expect(verifyQuickPlayRoomCredential(issueQuickPlayRoomCredential({ ...claims, seats: duplicateSeats }), 1_999)).toBeUndefined();
  });
});
