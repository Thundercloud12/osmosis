import { describe, expect, it } from "vitest";
import type { ServerPlayer } from "../rooms/Player";
import { resolveContact, settleGroups } from "./BattleSystem";

function player(id: string, teamId: "BLUE" | "RED", points = 1_000): ServerPlayer {
  return {
    id, nickname: id, teamId, x: 0, y: 0, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: points, points, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
  };
}

describe("contact and battle resolution", () => {
  it("keeps ordinary contact eligible for normal battle settlement inside or outside HQ", () => {
    const blue = player("blue", "BLUE", 1_200);
    const red = player("red", "RED", 500);
    const result = resolveContact(blue, red, { BLUE: undefined, RED: undefined }, () => undefined);
    expect(result.kind).toBe("BATTLE");
    if (result.kind === "BATTLE") expect(settleGroups(result.firstGroup, result.secondGroup, 500).transfer).toBe(500);
  });

  it("eliminates only the touching attacker when an active pole holder is involved", () => {
    const holder = player("holder", "BLUE", 0);
    const attacker = player("attacker", "RED", 10_000);
    const result = resolveContact(holder, attacker, { BLUE: "holder", RED: undefined }, () => undefined);
    expect(result).toMatchObject({ kind: "ELIMINATE_ATTACKER", attacker, holder });
  });

  it("freezes the active player on inactive contact without starting a battle", () => {
    const active = player("active", "BLUE", 1_200);
    const inactive = player("inactive", "RED", 500);
    inactive.status = "INACTIVE";
    expect(resolveContact(active, inactive, { BLUE: undefined, RED: undefined }, () => undefined))
      .toMatchObject({ kind: "FREEZE_PLAYER", frozenPlayer: active, inactivePlayer: inactive });
    expect(resolveContact(inactive, player("active-2", "BLUE"), { BLUE: undefined, RED: undefined }, () => undefined))
      .toMatchObject({ kind: "FREEZE_PLAYER", frozenPlayer: expect.objectContaining({ id: "active-2" }), inactivePlayer: inactive });
    inactive.status = "INACTIVE";
    const otherInactive = player("other-inactive", "BLUE");
    otherInactive.status = "INACTIVE";
    expect(resolveContact(inactive, otherInactive, { BLUE: undefined, RED: undefined }, () => undefined)).toEqual({ kind: "IGNORE" });
  });

  it("keeps pole elimination ahead of the inactive-contact freeze", () => {
    const holder = player("holder", "BLUE", 0);
    const inactiveAttacker = player("inactive-attacker", "RED", 1_000);
    inactiveAttacker.status = "INACTIVE";
    expect(resolveContact(holder, inactiveAttacker, { BLUE: holder.id, RED: undefined }, () => undefined))
      .toMatchObject({ kind: "ELIMINATE_ATTACKER", attacker: inactiveAttacker, holder });
  });

  it("ignores inactive and eliminated players for contact", () => {
    const holder = player("holder", "BLUE");
    const attacker = player("attacker", "RED");
    attacker.status = "ELIMINATED";
    expect(resolveContact(holder, attacker, { BLUE: "holder", RED: undefined }, () => undefined)).toEqual({ kind: "IGNORE" });
  });
});
