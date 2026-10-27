import { describe, expect, it } from "vitest";
import { GAME_RULES } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { eliminatePlayer, eliminatedTeamWinner, freezeMovement, makeInactive, rearmPlayers } from "./PlayerStatusSystem";

function player(id: string, teamId: "BLUE" | "RED", status: ServerPlayer["status"] = "ACTIVE"): ServerPlayer {
  return {
    id, nickname: id, teamId, x: 2_000, y: 2_000, dx: 1, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [{ seq: 0, dx: 1, dy: 0 }], ready: false, joinOrder: 0, startingPoints: 500, points: 500, status, inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("player status lifecycle", () => {
  it("freezes an active player for three seconds without changing status or extending an existing freeze", () => {
    const active = player("active", "BLUE");
    freezeMovement(active, 1_000);
    expect(active.status).toBe("ACTIVE");
    expect(active.frozenUntil).toBe(1_000 + GAME_RULES.inactiveContactFreezeSeconds * 1_000);
    freezeMovement(active, 2_000);
    expect(active.frozenUntil).toBe(4_000);

    const inactive = player("inactive", "RED", "INACTIVE");
    freezeMovement(inactive, 1_000);
    expect(inactive.frozenUntil).toBe(0);
  });

  it("re-arms temporary inactivity by timer while permanent elimination survives the same timer", () => {
    const inactive = player("inactive", "BLUE", "INACTIVE");
    inactive.inactiveUntil = 100;
    const eliminated = player("eliminated", "RED", "ELIMINATED");
    rearmPlayers([inactive, eliminated], 101);
    expect(inactive.status).toBe("ACTIVE");
    expect(eliminated.status).toBe("ELIMINATED");

    const holders = { BLUE: undefined as string | undefined, RED: undefined as string | undefined };
    const raids = { BLUE: undefined, RED: undefined };
    const doomed = player("doomed", "RED");
    const linked = player("ally", "RED");
    doomed.linkedPlayerId = linked.id; linked.linkedPlayerId = doomed.id;
    eliminatePlayer(doomed, (id) => id === linked.id ? linked : undefined, raids, holders);
    rearmPlayers([doomed], 100_000);
    expect(doomed.status).toBe("ELIMINATED");
    expect(doomed.points).toBe(0);
    expect(doomed.dx).toBe(0);
    expect(doomed.pendingMoves).toHaveLength(0);
    expect(linked.linkedPlayerId).toBeUndefined();
  });

  it("ends the match only when exactly one team has been permanently eliminated", () => {
    const blueA = player("blue-a", "BLUE", "ELIMINATED");
    const blueB = player("blue-b", "BLUE", "ELIMINATED");
    const red = player("red", "RED");
    expect(eliminatedTeamWinner([blueA, blueB, red])).toBe("RED");
    expect(eliminatedTeamWinner([blueA, red])).toBe("RED");
    red.status = "ELIMINATED";
    expect(eliminatedTeamWinner([blueA, red])).toBeUndefined();
  });

  it("clears pole ownership when its holder becomes inactive", () => {
    const holder = player("holder", "BLUE");
    const holders = { BLUE: holder.id, RED: undefined as string | undefined };
    const raids = { BLUE: undefined, RED: undefined };
    makeInactive(holder, 1_000, () => undefined, raids, holders);
    expect(holders.BLUE).toBeUndefined();
    expect(holder.status).toBe("INACTIVE");
  });
});
