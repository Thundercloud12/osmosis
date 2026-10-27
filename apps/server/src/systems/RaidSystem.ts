import { GAME_RULES, type TeamId } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { opponentTeam } from "./BattleSystem";

export interface ActiveRaid { playerId: string; startedAt: number }
export interface RaidResolution { stage: "INTERRUPTED" | "COMPLETED"; teamId: TeamId; playerId: string }
export type ActiveRaids = Record<TeamId, ActiveRaid | undefined>;
export type RaidCooldowns = Record<TeamId, number>;

export function setRaid(player: ServerPlayer, active: boolean, raids: ActiveRaids, cooldowns: RaidCooldowns,
  now: number, isInsideBase: (player: ServerPlayer, team: TeamId) => boolean): void {
  const raid = raids[player.teamId];
  if (!active) {
    if (raid?.playerId === player.id) raids[player.teamId] = undefined;
    return;
  }
  if (player.status !== "ACTIVE") throw new Error("Only active players can start a base raid.");
  if (raids[player.teamId]) throw new Error("Your crew already has an active raid.");
  if (now < cooldowns[player.teamId]) throw new Error("Your crew's raid is cooling down.");
  if (!isInsideBase(player, opponentTeam(player.teamId))) throw new Error("Move inside the enemy base to start a raid.");
  raids[player.teamId] = { playerId: player.id, startedAt: now };
}

export function advanceRaids(raids: ActiveRaids, cooldowns: RaidCooldowns, now: number,
  findById: (id: string) => ServerPlayer | undefined, isInsideBase: (player: ServerPlayer, team: TeamId) => boolean): RaidResolution[] {
  const resolutions: RaidResolution[] = [];
  for (const teamId of ["BLUE", "RED"] as const) {
    const raid = raids[teamId];
    if (!raid) continue;
    const raider = findById(raid.playerId);
    if (!raider || raider.status !== "ACTIVE" || !isInsideBase(raider, opponentTeam(teamId))) {
      raids[teamId] = undefined;
      resolutions.push({ stage: "INTERRUPTED", teamId, playerId: raid.playerId });
      continue;
    }
    if (now - raid.startedAt < GAME_RULES.raidChannelSeconds * 1_000) continue;
    raider.points += GAME_RULES.raidReward;
    raider.raidsCompleted += 1;
    cooldowns[teamId] = now + GAME_RULES.raidCooldownSeconds * 1_000;
    raids[teamId] = undefined;
    resolutions.push({ stage: "COMPLETED", teamId, playerId: raider.id });
  }
  return resolutions;
}

export function cancelRaid(playerId: string, raids: ActiveRaids): void {
  for (const teamId of ["BLUE", "RED"] as const) if (raids[teamId]?.playerId === playerId) raids[teamId] = undefined;
}
