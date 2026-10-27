import {
  GAME_RULES,
  MOVEMENT_CONFIG,
  hasLineOfSight,
  remainingSeconds,
  type PlayerSnapshot,
  type RoomSnapshot,
  type TeamId,
} from "@osmosis/shared";
import type { Pickup, ServerPlayer } from "../rooms/Player";
import type { PoleHolders } from "../systems/MovementSystem";

export interface SnapshotProjectionInput {
  phase: "PLAYING" | "RESULTS";
  teamSize: number;
  hostPlayerId?: string;
  self: ServerPlayer;
  players: readonly ServerPlayer[];
  connectedPlayerCount: number;
  serverTime: number;
  now: number;
  remainingSeconds: number;
  pickups: readonly Pickup[];
  raidStartedAt: number | undefined;
  raidCooldownUntil: number;
  poleHolders: PoleHolders;
  winnerOverride: TeamId | null;
}

export function projectSnapshot(input: SnapshotProjectionInput): RoomSnapshot {
  const { self, players } = input;
  const blueScore = players.filter((player) => player.teamId === "BLUE").reduce((sum, player) => sum + player.points, 0);
  const redScore = players.filter((player) => player.teamId === "RED").reduce((sum, player) => sum + player.points, 0);
  const teamScores = input.phase === "RESULTS" ? { BLUE: blueScore, RED: redScore } : {
    BLUE: self.teamId === "BLUE" ? blueScore : null,
    RED: self.teamId === "RED" ? redScore : null,
  };
  const naturalWinner: TeamId | null = blueScore === redScore ? null : blueScore > redScore ? "BLUE" : "RED";
  const winnerTeam = input.winnerOverride ?? naturalWinner;
  const result = input.phase === "RESULTS" ? {
    winnerTeam,
    teamScores: { BLUE: blueScore, RED: redScore },
    players: players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        teamId: player.teamId,
        points: player.points,
        pickupsCollected: player.pickupsCollected,
        battlesWon: player.battlesWon,
        raidsCompleted: player.raidsCompleted,
      }))
      .sort((left, right) => left.teamId.localeCompare(right.teamId) || right.points - left.points || left.id.localeCompare(right.id)),
  } : null;

  const spectatorTarget = self.status === "ELIMINATED"
    ? players.filter((player) => player.teamId === self.teamId && player.status !== "ELIMINATED" && player.status !== "DISCONNECTED")
      .sort((left, right) => left.joinOrder - right.joinOrder)[0]
    : undefined;
  const viewSource = spectatorTarget ?? self;
  const playerSnapshots: PlayerSnapshot[] = [];
  for (const candidate of players) {
    const isSelfOrTeammate = candidate.id === self.id || candidate.teamId === self.teamId;
    const distance = Math.hypot(candidate.x - viewSource.x, candidate.y - viewSource.y);
    const isSpottedEnemy = candidate.teamId !== self.teamId && candidate.status !== "DISCONNECTED" &&
      distance <= MOVEMENT_CONFIG.viewRadius && hasLineOfSight(viewSource, candidate);
    if (!isSelfOrTeammate && !isSpottedEnemy) continue;
    playerSnapshots.push({
      id: candidate.id,
      nickname: candidate.nickname,
      teamId: candidate.teamId,
      status: isSpottedEnemy && candidate.status === "INACTIVE" ? "ACTIVE" : candidate.status,
      x: candidate.x,
      y: candidate.y,
      poleHolder: input.poleHolders[candidate.teamId] === candidate.id,
      ...(candidate.id === self.id && candidate.status === "INACTIVE"
        ? { inactiveSecondsRemaining: remainingSeconds(candidate.inactiveUntil, input.now) }
        : {}),
      ...(candidate.id === self.id && candidate.frozenUntil > input.now
        ? { frozenSecondsRemaining: remainingSeconds(candidate.frozenUntil, input.now) }
        : {}),
      ...(candidate.teamId === self.teamId ? { points: candidate.points } : {}),
      ...(candidate.teamId === self.teamId && candidate.linkedPlayerId
        ? { linkedPlayerId: candidate.linkedPlayerId }
        : {}),
      ...(candidate.id === self.id ? { acknowledgedInputSeq: candidate.lastAppliedSequence } : {}),
    });
  }

  const selfRaid = input.raidStartedAt === undefined
    ? { progressSeconds: 0, cooldownSecondsRemaining: remainingSeconds(input.raidCooldownUntil, input.now) }
    : {
      progressSeconds: Math.min(GAME_RULES.raidChannelSeconds, (input.now - input.raidStartedAt) / 1_000),
      cooldownSecondsRemaining: remainingSeconds(input.raidCooldownUntil, input.now),
    };

  return {
    phase: input.phase,
    teamSize: input.teamSize,
    selfPlayerId: self.id,
    ...(input.hostPlayerId ? { hostPlayerId: input.hostPlayerId } : {}),
    connectedPlayerCount: input.connectedPlayerCount,
    serverTime: input.serverTime,
    remainingSeconds: input.remainingSeconds,
    players: playerSnapshots,
    ...(spectatorTarget ? { spectatorTargetId: spectatorTarget.id } : {}),
    teamScores,
    pickups: [...input.pickups],
    selfRaid,
    result,
  };
}
