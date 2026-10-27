import { describe, expect, it } from "vitest";
import { GAME_RULES } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { collectPickups } from "./PickupSystem";

function player(id: string, x: number, status: ServerPlayer["status"] = "ACTIVE"): ServerPlayer {
  return {
    id, nickname: id, teamId: "BLUE", x, y: 500, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: 0, points: 0, status, inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("pickup collection", () => {
  it("collects consecutive distinct pickups once each for an active player", () => {
    const collector = player("collector", 500);
    const first = [{ id: "star-1", x: 500, y: 500 }, { id: "star-2", x: 900, y: 500 }];
    const firstTick = collectPickups([collector], first);
    expect(firstTick.collections).toEqual([{ playerId: "collector", pickupId: "star-1", points: GAME_RULES.pickupReward }]);
    expect(firstTick.remainingPickups.map(({ id }) => id)).toEqual(["star-2"]);

    collector.x = 900;
    const secondTick = collectPickups([collector], firstTick.remainingPickups);
    expect(secondTick.collections).toEqual([{ playerId: "collector", pickupId: "star-2", points: GAME_RULES.pickupReward }]);
    expect(secondTick.remainingPickups).toEqual([]);
  });

  it("does not collect while inactive and resolves a contested star exactly once in stable order", () => {
    const inactive = player("inactive", 500, "INACTIVE");
    const activeZ = player("z-active", 500);
    const activeA = player("a-active", 500);
    const pickup = [{ id: "star", x: 500, y: 500 }];
    const result = collectPickups([inactive, activeZ, activeA], pickup);
    expect(result.collections).toEqual([{ playerId: "a-active", pickupId: "star", points: GAME_RULES.pickupReward }]);
    expect(result.remainingPickups).toEqual([]);
  });
});
