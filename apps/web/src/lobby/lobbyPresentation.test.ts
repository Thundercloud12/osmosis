import { describe, expect, it } from "vitest";

import type { LobbyPlayer, LobbySnapshot } from "@osmosis/shared";
import { buildCrewRoster, getLobbyPermissions, getLobbyStage, summarizeAllocation } from "./lobbyPresentation";

const player = (overrides: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  id: "blue-1",
  nickname: "Starbean",
  teamId: "BLUE",
  ready: false,
  connected: true,
  isHost: false,
  isCaptain: false,
  ...overrides,
});

const lobby = (overrides: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  roomCode: "ABC234",
  roomMode: "STANDARD",
  matchSettings: { teamSize: 1, matchDurationSeconds: 900 },
  phase: "LOBBY",
  selfPlayerId: "blue-1",
  voiceCredential: "x".repeat(20),
  voiceRoomName: "voice-room",
  hostPlayerId: "blue-1",
  isPublic: false,
  teamSelectionLocked: false,
  connectedPlayerCount: 2,
  players: [
    player({ isHost: true, isCaptain: true }),
    player({ id: "red-1", nickname: "Comet", teamId: "RED", isCaptain: true }),
  ],
  captainIds: { BLUE: "blue-1", RED: "red-1" },
  ownTeamAllocation: [{ playerId: "blue-1", points: 10_000 }],
  ownTeamLocked: false,
  allocationComplete: false,
  countdownSecondsRemaining: null,
  ...overrides,
});

describe("lobby presentation", () => {
  it("reflects joins, disconnects, and role changes from each latest roster snapshot", () => {
    const initial = buildCrewRoster([player()], "BLUE", 2, "blue-1");
    expect(initial.map((slot) => slot.player?.nickname ?? null)).toEqual(["Starbean", null]);
    expect(initial[0]?.isLocalPlayer).toBe(true);

    const updated = buildCrewRoster([
      player({ connected: false, isCaptain: true }),
      player({ id: "blue-2", nickname: "Moon", isHost: true }),
    ], "BLUE", 2, "blue-1");
    expect(updated[0]?.player?.connected).toBe(false);
    expect(updated[0]?.player?.isCaptain).toBe(true);
    expect(updated[1]?.player?.nickname).toBe("Moon");
    expect(updated[1]?.player?.isHost).toBe(true);
  });

  it("exposes host and captain actions only when their server-side prerequisites are met", () => {
    const captainHost = player({ isHost: true, isCaptain: true });
    const permissions = getLobbyPermissions(lobby(), captainHost);
    expect(permissions.canOpenAllocation).toBe(true);
    expect(permissions.canAdjustAllocation).toBe(false);
    expect(permissions.canStartMatch).toBe(false);
    expect(permissions.canJoinCrew("RED")).toBe(false);

    const openCrew = lobby({
      matchSettings: { teamSize: 2, matchDurationSeconds: 900 },
      connectedPlayerCount: 2,
      players: [
        player({ isHost: true, isCaptain: true }),
        player({ id: "red-1", nickname: "Comet", teamId: "RED", isCaptain: true }),
      ],
    });
    expect(getLobbyPermissions(openCrew, captainHost).canJoinCrew("RED")).toBe(true);

    const nonHost = getLobbyPermissions(lobby(), player({ isCaptain: true }));
    expect(nonHost.canOpenAllocation).toBe(false);
    expect(nonHost.canAdjustAllocation).toBe(false);
    expect(nonHost.canJoinCrew("RED")).toBe(false);

    const readySnapshot = lobby({
      allocationComplete: true,
      players: [
        player({ isHost: true, isCaptain: true, ready: true }),
        player({ id: "red-1", nickname: "Comet", teamId: "RED", isCaptain: true, ready: true }),
      ],
    });
    expect(getLobbyPermissions(readySnapshot, captainHost).canReady).toBe(true);
    expect(getLobbyPermissions(readySnapshot, captainHost).canStartMatch).toBe(true);
    expect(getLobbyPermissions(readySnapshot, player({ isCaptain: true })).canStartMatch).toBe(false);

    const allocating = lobby({ phase: "ALLOCATION" });
    expect(getLobbyPermissions(allocating, captainHost).canAdjustAllocation).toBe(true);
    expect(getLobbyPermissions(lobby({ ownTeamLocked: true, phase: "ALLOCATION" }), captainHost).canAdjustAllocation).toBe(false);
  });

  it("summarizes and validates allocations without relaxing game rules", () => {
    expect(summarizeAllocation([5_000, 5_000], 10_000, 500, 100)).toEqual({
      allocated: 10_000,
      remaining: 0,
      hasAllValues: true,
      valid: true,
    });
    expect(summarizeAllocation([9_600, 300], 10_000, 500, 100).valid).toBe(false);
    expect(summarizeAllocation([5_000, null], 10_000, 500, 100).hasAllValues).toBe(false);
  });

  it("moves the lobby status forward from crew assembly to points to readiness", () => {
    expect(getLobbyStage(lobby({ captainIds: { BLUE: null, RED: null } }))).toBe(0);
    expect(getLobbyStage(lobby({ phase: "ALLOCATION" }))).toBe(1);
    expect(getLobbyStage(lobby({ allocationComplete: true }))).toBe(2);
  });
});
