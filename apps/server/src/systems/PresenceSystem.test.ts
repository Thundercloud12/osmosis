import { describe, expect, it } from "vitest";
import type { ServerPlayer } from "../rooms/Player";
import { connectedPlayerCount, disconnectPlayer, oldestConnectedPlayerId, purgeDisconnectedPlayersForRematch, reconnectPlayer } from "./PresenceSystem";

function makePlayer(overrides: Partial<ServerPlayer> = {}): ServerPlayer {
  return {
    id: "player-1", nickname: "Crew", teamId: "BLUE", x: 100, y: 100, dx: 1, dy: 0,
    lastSequence: 8, lastAppliedSequence: 7, pendingMoves: [{ seq: 8, dx: 1, dy: 0 }], ready: true,
    joinOrder: 0, startingPoints: 2_000, points: 2_000, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, reconnectUntil: undefined, linkedPlayerId: undefined,
    voiceCredential: undefined, voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined,
    pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
    ...overrides,
  };
}

describe("player presence transitions", () => {
  it("freezes movement while retaining a reserved reconnect deadline and prior status", () => {
    const player = makePlayer({ status: "INACTIVE", inactiveUntil: 15_000, reconnectUntil: undefined });
    disconnectPlayer(player, 120_000);
    expect(player.connected).toBe(false);
    expect(player.status).toBe("DISCONNECTED");
    expect(player.statusBeforeDisconnect).toBe("INACTIVE");
    expect(player.reconnectUntil).toBe(120_000);
    expect(player.dx).toBe(0);
    expect(player.pendingMoves).toEqual([]);
    expect(player.ready).toBe(false);
  });

  it("restores an unexpired inactivity state but resets movement sequencing", () => {
    const player = makePlayer({ statusBeforeDisconnect: "INACTIVE", connected: false, inactiveUntil: 15_000, frozenUntil: 0, status: "DISCONNECTED", reconnectUntil: 120_000 });
    reconnectPlayer(player, 8_000, () => false);
    expect(player.connected).toBe(true);
    expect(player.status).toBe("INACTIVE");
    expect(player.lastSequence).toBe(-1);
    expect(player.lastAppliedSequence).toBe(-1);
    expect(player.reconnectUntil).toBeUndefined();
    expect(player.statusBeforeDisconnect).toBeUndefined();
  });

  it("does not reactivate an eliminated player on reconnect", () => {
    const player = makePlayer({ status: "DISCONNECTED", statusBeforeDisconnect: "ELIMINATED", connected: false, points: 0, reconnectUntil: 120_000 });
    reconnectPlayer(player, 9_000, () => true);
    expect(player.status).toBe("ELIMINATED");
    expect(player.points).toBe(0);
    expect(player.connected).toBe(true);
  });

  it("retains points while reconnecting a living player", () => {
    const player = makePlayer({ status: "DISCONNECTED", statusBeforeDisconnect: "ACTIVE", connected: false, points: 2_375, reconnectUntil: 120_000 });
    reconnectPlayer(player, 9_000, () => false);
    expect(player.points).toBe(2_375);
    expect(player.status).toBe("ACTIVE");
  });

  it("restores an inactive player immediately inside their own base", () => {
    const player = makePlayer({ status: "DISCONNECTED", statusBeforeDisconnect: "INACTIVE", connected: false, inactiveUntil: 15_000, reconnectUntil: 120_000 });
    reconnectPlayer(player, 8_000, () => true);
    expect(player.status).toBe("ACTIVE");
    expect(player.inactiveUntil).toBe(0);
  });

  it("counts only live connections and promotes the oldest connected player", () => {
    const players = [
      makePlayer({ id: "oldest", joinOrder: 0, connected: false, status: "DISCONNECTED" }),
      makePlayer({ id: "later", joinOrder: 3 }),
      makePlayer({ id: "middle", joinOrder: 1 }),
    ];
    expect(connectedPlayerCount(players)).toBe(2);
    expect(oldestConnectedPlayerId(players)).toBe("middle");
  });

  it("keeps only connected players or seats whose reconnect window is still open for a rematch", () => {
    const players = new Map([
      ["connected", makePlayer({ id: "connected" })],
      ["reserved", makePlayer({ id: "reserved", connected: false, status: "DISCONNECTED", reconnectUntil: 20_000 })],
      ["expired", makePlayer({ id: "expired", connected: false, status: "DISCONNECTED", reconnectUntil: 9_000 })],
      ["left", makePlayer({ id: "left", connected: false, status: "DISCONNECTED", reconnectUntil: undefined })],
    ]);
    purgeDisconnectedPlayersForRematch(players, 10_000);
    expect([...players.keys()].sort()).toEqual(["connected", "reserved"]);
  });
});
