import { describe, expect, it } from "vitest";
import type { ServerPlayer } from "../rooms/Player";
import { breakLink, startLink, validateLinks } from "./LinkSystem";

function player(id: string, teamId: "BLUE" | "RED" = "BLUE"): ServerPlayer {
  return {
    id, nickname: id, teamId, x: 500, y: 500, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: 0, points: 0, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("team links", () => {
  it("creates symmetric links only for same-team active players", () => {
    const blue = player("blue");
    const ally = player("ally");
    startLink(blue, ally, () => true);
    expect(blue.linkedPlayerId).toBe("ally");
    expect(ally.linkedPlayerId).toBe("blue");
    expect(() => startLink(player("blue-2"), player("red", "RED"), () => true)).toThrow("own crew");
  });

  it("breaks both ends when a player becomes inactive", () => {
    const blue = player("blue");
    const ally = player("ally");
    startLink(blue, ally, () => true);
    blue.status = "INACTIVE";
    validateLinks([blue, ally], (id) => id === blue.id ? blue : id === ally.id ? ally : undefined, () => true);
    expect(blue.linkedPlayerId).toBeUndefined();
    expect(ally.linkedPlayerId).toBeUndefined();
    breakLink(blue, (id) => id === ally.id ? ally : undefined);
  });
});
