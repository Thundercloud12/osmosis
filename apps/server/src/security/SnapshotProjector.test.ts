import { describe, expect, it } from "vitest";
import type { ServerPlayer } from "../rooms/Player";
import { projectSnapshot } from "./SnapshotProjector";

function player(id: string, teamId: "BLUE" | "RED", options: Partial<ServerPlayer> = {}): ServerPlayer {
  return {
    id, nickname: id, teamId, x: 700, y: 1_000, dx: 0, dy: 0, lastSequence: -1, lastAppliedSequence: -1,
    pendingMoves: [], ready: false, joinOrder: 0, startingPoints: 5_000, points: 5_000, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
    connected: true, statusBeforeDisconnect: undefined, reconnectUntil: undefined, linkedPlayerId: undefined, voiceCredential: undefined,
    voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined, pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
    ...options,
  };
}

const baseInput = {
  phase: "PLAYING" as const, teamSize: 5, connectedPlayerCount: 10, hostPlayerId: "blue", serverTime: 1_000, now: 1_000,
  remainingSeconds: 800, pickups: [], raidStartedAt: undefined, raidCooldownUntil: 0,
  poleHolders: { BLUE: undefined, RED: undefined }, winnerOverride: null,
};

describe("recipient-specific snapshots", () => {
  it("omits opposing numeric totals and masks a spotted enemy's temporary inactivity", () => {
    const self = player("blue", "BLUE", { points: 4_000 });
    const teammate = player("ally", "BLUE", { points: 6_000 });
    const enemy = player("red", "RED", { points: 99_999, status: "INACTIVE", inactiveUntil: 8_000 });
    const snapshot = projectSnapshot({ ...baseInput, self, players: [self, teammate, enemy] });
    expect(snapshot.hostPlayerId).toBe("blue");
    expect(snapshot.teamScores).toEqual({ BLUE: 10_000, RED: null });
    expect(snapshot.players.find(({ id }) => id === "red")).toMatchObject({ status: "ACTIVE" });
    expect(snapshot.players.find(({ id }) => id === "red")).not.toHaveProperty("points");
    expect(snapshot.players.find(({ id }) => id === "ally")?.points).toBe(6_000);
  });

  it("sends the movement-freeze timer only to the affected player", () => {
    const self = player("blue", "BLUE", { frozenUntil: 4_000 });
    const enemy = player("red", "RED", { status: "INACTIVE", inactiveUntil: 8_000 });
    const selfView = projectSnapshot({ ...baseInput, self, players: [self, enemy] });
    expect(selfView.players.find(({ id }) => id === "blue")?.frozenSecondsRemaining).toBe(3);
    expect(selfView.players.find(({ id }) => id === "red")?.status).toBe("ACTIVE");
    expect(selfView.players.find(({ id }) => id === "red")).not.toHaveProperty("inactiveSecondsRemaining");
    expect(selfView.players.find(({ id }) => id === "red")).not.toHaveProperty("frozenSecondsRemaining");

    const enemyView = projectSnapshot({ ...baseInput, self: enemy, players: [self, enemy] });
    expect(enemyView.players.find(({ id }) => id === "blue")?.status).toBe("ACTIVE");
    expect(enemyView.players.find(({ id }) => id === "blue")).not.toHaveProperty("frozenSecondsRemaining");
  });

  it("reveals complete final scores only in results and follows the next living teammate", () => {
    const self = player("blue-dead", "BLUE", { status: "ELIMINATED", points: 0, joinOrder: 0 });
    const teammate = player("blue-alive", "BLUE", { joinOrder: 1, points: 8_000 });
    const enemy = player("red", "RED", { points: 55_000 });
    const snapshot = projectSnapshot({ ...baseInput, phase: "RESULTS", self, players: [self, teammate, enemy] });
    expect(snapshot.spectatorTargetId).toBe("blue-alive");
    expect(snapshot.result?.teamScores).toEqual({ BLUE: 8_000, RED: 55_000 });
    expect(snapshot.teamScores).toEqual({ BLUE: 8_000, RED: 55_000 });
    expect(snapshot.result?.players.map(({ id }) => id).sort()).toEqual(["blue-alive", "blue-dead", "red"]);
    expect(snapshot.result?.players.find(({ id }) => id === "blue-dead")?.points).toBe(0);
    expect(snapshot.players.find(({ id }) => id === "red")).not.toHaveProperty("points");
  });
});
