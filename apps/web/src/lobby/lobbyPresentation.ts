import type { LobbyPlayer, LobbySnapshot } from "@osmosis/shared";

export type TeamId = "BLUE" | "RED";

export interface CrewRosterSlot {
  player: LobbyPlayer | null;
  isLocalPlayer: boolean;
}

export function buildCrewRoster(
  players: readonly LobbyPlayer[],
  teamId: TeamId,
  capacity: number,
  localPlayerId: string,
): CrewRosterSlot[] {
  const crew = players.filter((player) => player.teamId === teamId);
  return Array.from({ length: capacity }, (_, index) => {
    const player = crew[index] ?? null;
    return { player, isLocalPlayer: player?.id === localPlayerId };
  });
}

export function getLobbyPermissions(lobby: LobbySnapshot, self: LobbyPlayer | undefined) {
  const inTeamSelection = lobby.phase === "LOBBY" && !lobby.allocationComplete;
  const blueFull = lobby.players.filter((player) => player.teamId === "BLUE").length === lobby.matchSettings.teamSize;
  const redFull = lobby.players.filter((player) => player.teamId === "RED").length === lobby.matchSettings.teamSize;
  const bothCrewsFull = blueFull && redFull;
  const bothCaptainsSelected = Boolean(lobby.captainIds.BLUE && lobby.captainIds.RED);
  const allPlayersReady = lobby.players.every((player) => player.ready);
  const allPlayersConnected = lobby.connectedPlayerCount === lobby.matchSettings.teamSize * 2;
  const canJoinCrew = (teamId: TeamId) => Boolean(
    self
      && self.teamId !== teamId
      && inTeamSelection
      && !lobby.teamSelectionLocked
      && lobby.players.filter((player) => player.teamId === teamId).length < lobby.matchSettings.teamSize,
  );

  return {
    canJoinCrew,
    canClaimCaptain: Boolean(self && inTeamSelection && !lobby.captainIds[self.teamId]),
    canReleaseCaptain: Boolean(self?.isCaptain && inTeamSelection),
    canOpenAllocation: Boolean(self?.isHost && inTeamSelection && bothCrewsFull && bothCaptainsSelected && allPlayersConnected),
    canAdjustAllocation: Boolean(self?.isCaptain && lobby.phase === "ALLOCATION" && !lobby.ownTeamLocked),
    canLockAllocation: Boolean(self?.isCaptain && lobby.phase === "ALLOCATION" && !lobby.ownTeamLocked),
    canReady: Boolean(self && lobby.phase === "LOBBY" && lobby.allocationComplete),
    canStartMatch: Boolean(self?.isHost && lobby.phase === "LOBBY" && lobby.allocationComplete && allPlayersConnected && allPlayersReady),
    canCancelCountdown: Boolean(self?.isHost && lobby.phase === "COUNTDOWN"),
    bothCrewsFull,
    bothCaptainsSelected,
    allPlayersConnected,
    allPlayersReady,
  };
}

export interface AllocationSummary {
  allocated: number;
  remaining: number;
  hasAllValues: boolean;
  valid: boolean;
}

export function summarizeAllocation(
  values: readonly (number | null)[],
  expectedTotal: number,
  minimumPerPlayer: number,
  increment: number,
): AllocationSummary {
  const hasAllValues = values.length > 0 && values.every((value) => value !== null);
  const allocated = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const valid = hasAllValues && values.every((value) =>
    Number.isInteger(value) && value! >= minimumPerPlayer && value! % increment === 0,
  ) && allocated === expectedTotal;

  return { allocated, remaining: expectedTotal - allocated, hasAllValues, valid };
}

export function getLobbyStage(lobby: LobbySnapshot): 0 | 1 | 2 {
  if (lobby.phase === "ALLOCATION") return 1;
  if (lobby.phase === "COUNTDOWN" || lobby.allocationComplete) return 2;
  const crewsFilled = ["BLUE", "RED"].every((teamId) =>
    lobby.players.filter((player) => player.teamId === teamId).length === lobby.matchSettings.teamSize,
  );
  return crewsFilled && lobby.captainIds.BLUE && lobby.captainIds.RED ? 1 : 0;
}
