import { GAME_RULES, TEAM_BASES, type TeamId } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import { breakLink } from "./LinkSystem";
import { cancelRaid, type ActiveRaids } from "./RaidSystem";
import { releasePole, touchesHomePole, type PoleHolders } from "./MovementSystem";

export function rearmPlayers(players: Iterable<ServerPlayer>, now: number): void {
  for (const player of players) {
    if (player.status !== "INACTIVE") continue;
    if (now >= player.inactiveUntil || isInsideBase(player, player.teamId)) {
      player.status = "ACTIVE";
      player.inactiveUntil = 0;
    }
  }
}

export function reconcilePoleHolders(players: Iterable<ServerPlayer>, holders: PoleHolders,
  findById: (id: string) => ServerPlayer | undefined): void {
  const roster = [...players];
  for (const teamId of ["BLUE", "RED"] as const) {
    const currentId = holders[teamId];
    const current = currentId ? findById(currentId) : undefined;
    if (!current || current.status !== "ACTIVE" || !touchesHomePole(current)) holders[teamId] = undefined;
    if (holders[teamId]) continue;
    const next = roster.filter((player) => player.teamId === teamId && player.status === "ACTIVE" && touchesHomePole(player))
      .sort((a, b) => a.joinOrder - b.joinOrder)[0];
    if (next) holders[teamId] = next.id;
  }
}

export function makeInactive(player: ServerPlayer, now: number, findById: (id: string) => ServerPlayer | undefined,
  raids: ActiveRaids, holders: PoleHolders): void {
  player.status = "INACTIVE";
  player.inactiveUntil = now + GAME_RULES.battleInactivitySeconds * 1_000;
  player.frozenUntil = 0;
  player.dx = 0; player.dy = 0; player.pendingMoves.length = 0;
  breakLink(player, findById);
  cancelRaid(player.id, raids);
  releasePole(player, holders);
}

/** Freezes only movement; the player remains ACTIVE and keeps normal battle status. */
export function freezeMovement(player: ServerPlayer, now: number): void {
  if (player.status !== "ACTIVE" || player.frozenUntil > now) return;
  player.frozenUntil = now + GAME_RULES.inactiveContactFreezeSeconds * 1_000;
  player.dx = 0;
  player.dy = 0;
  player.pendingMoves.length = 0;
}

export function eliminatePlayer(player: ServerPlayer, findById: (id: string) => ServerPlayer | undefined,
  raids: ActiveRaids, holders: PoleHolders): void {
  if (player.status !== "ACTIVE" && player.status !== "INACTIVE") return;
  player.status = "ELIMINATED";
  player.points = 0;
  player.inactiveUntil = 0;
  player.frozenUntil = 0;
  player.dx = 0; player.dy = 0; player.pendingMoves.length = 0;
  breakLink(player, findById);
  cancelRaid(player.id, raids);
  releasePole(player, holders);
}

export function eliminatedTeamWinner(players: Iterable<ServerPlayer>): TeamId | null | undefined {
  const roster = [...players];
  const blueWiped = roster.filter((player) => player.teamId === "BLUE").every((player) => player.status === "ELIMINATED");
  const redWiped = roster.filter((player) => player.teamId === "RED").every((player) => player.status === "ELIMINATED");
  if (blueWiped === redWiped) return undefined;
  return blueWiped ? "RED" : "BLUE";
}

function isInsideBase(player: ServerPlayer, team: TeamId): boolean {
  const base = TEAM_BASES[team];
  return player.x >= base.x && player.x <= base.x + base.width && player.y >= base.y && player.y <= base.y + base.height;
}
