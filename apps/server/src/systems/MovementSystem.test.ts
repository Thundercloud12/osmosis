import { describe, expect, it } from "vitest";
import { GAME_RULES, MOVEMENT_CONFIG, TEAM_HQ_POLES } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { movePlayer, releasePole, touchesHomePole } from "./MovementSystem";

function player(id: string, x: number, y: number): ServerPlayer {
  return {
    id, nickname: id, teamId: "BLUE", x, y, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: 0, points: 0, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("HQ pole ownership and movement", () => {
  it("claims the pole for its first active occupant and blocks a teammate from entering", () => {
    const pole = TEAM_HQ_POLES.BLUE;
    const holders = { BLUE: undefined as string | undefined, RED: undefined as string | undefined };
    const holder = player("holder", pole.x, pole.y);
    movePlayer(holder, 1 / 30, holders);
    expect(holders.BLUE).toBe("holder");
    expect(touchesHomePole(holder)).toBe(true);

    const teammate = player("teammate", pole.x - 110, pole.y);
    teammate.dx = 1;
    movePlayer(teammate, 0.5, holders);
    expect(Math.hypot(teammate.x - pole.x, teammate.y - pole.y)).toBeGreaterThan(GAME_RULES.hqPoleTouchRadius + MOVEMENT_CONFIG.playerRadius);
    expect(holders.BLUE).toBe("holder");
  });

  it("releases a holder cleanly when they leave the pole", () => {
    const pole = TEAM_HQ_POLES.BLUE;
    const holders = { BLUE: "holder" as string | undefined, RED: undefined as string | undefined };
    const holder = player("holder", pole.x, pole.y);
    holder.dx = 1;
    movePlayer(holder, 0.5, holders);
    expect(holders.BLUE).toBeUndefined();
    releasePole(holder, holders);
    expect(holders.BLUE).toBeUndefined();
  });

  it("allows inactive players to move and blocks an active player's movement during a freeze", () => {
    const holders = { BLUE: undefined as string | undefined, RED: undefined as string | undefined };
    const inactive = player("inactive", 500, 500);
    inactive.status = "INACTIVE";
    inactive.dx = 1;
    movePlayer(inactive, 0.1, holders, 1_000);
    expect(inactive.x).toBeGreaterThan(500);

    const frozen = player("frozen", 500, 500);
    frozen.dx = 1;
    frozen.frozenUntil = 2_000;
    movePlayer(frozen, 0.1, holders, 1_500);
    expect(frozen.x).toBe(500);
    expect(frozen.dx).toBe(0);
    frozen.pendingMoves.push({ seq: 1, dx: 1, dy: 0 });
    movePlayer(frozen, 0.1, holders, 2_000);
    expect(frozen.x).toBeGreaterThan(500);
  });
});
