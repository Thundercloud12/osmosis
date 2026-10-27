import { describe, expect, it } from "vitest";
import { GAME_RULES } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { advanceRaids, setRaid, type ActiveRaids, type RaidCooldowns } from "./RaidSystem";

function player(): ServerPlayer {
  return {
    id: "raider", nickname: "raider", teamId: "BLUE", x: 0, y: 0, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: 100, points: 100, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("base raids", () => {
  it("keeps the existing three-second reward, interruption, and team cooldown", () => {
    const raider = player();
    const raids: ActiveRaids = { BLUE: undefined, RED: undefined };
    const cooldowns: RaidCooldowns = { BLUE: 0, RED: 0 };
    let insideEnemyBase = true;
    const isInside = (_candidate: ServerPlayer, team: "BLUE" | "RED") => team === "RED" && insideEnemyBase;
    setRaid(raider, true, raids, cooldowns, 10_000, isInside);
    expect(advanceRaids(raids, cooldowns, 12_999, () => raider, isInside)).toEqual([]);
    expect(raider.points).toBe(100);
    expect(advanceRaids(raids, cooldowns, 13_000, () => raider, isInside)).toEqual([
      { stage: "COMPLETED", teamId: "BLUE", playerId: "raider" },
    ]);
    expect(raider.points).toBe(100 + GAME_RULES.raidReward);
    expect(raider.raidsCompleted).toBe(1);
    expect(cooldowns.BLUE).toBe(13_000 + GAME_RULES.raidCooldownSeconds * 1_000);
    expect(() => setRaid(raider, true, raids, cooldowns, 13_001, isInside)).toThrow("cooling down");

    insideEnemyBase = true;
    cooldowns.BLUE = 0;
    setRaid(raider, true, raids, cooldowns, 20_000, isInside);
    insideEnemyBase = false;
    expect(advanceRaids(raids, cooldowns, 20_100, () => raider, isInside)).toEqual([
      { stage: "INTERRUPTED", teamId: "BLUE", playerId: "raider" },
    ]);
    expect(raids.BLUE).toBeUndefined();
  });
});
