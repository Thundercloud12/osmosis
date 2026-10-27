import { TEAM_HQ_POLES, GAME_RULES, MOVEMENT_CONFIG, stepMovement, type TeamId } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";

export type PoleHolders = Record<TeamId, string | undefined>;

export function applyQueuedMovement(player: ServerPlayer): void {
  const input = player.pendingMoves.shift();
  if (!input) return;
  player.dx = input.dx;
  player.dy = input.dy;
  player.lastAppliedSequence = input.seq;
}

export function movePlayer(player: ServerPlayer, deltaSeconds: number, holders: PoleHolders, now = performance.now()): void {
  if (player.status !== "ACTIVE" && player.status !== "INACTIVE") return;
  if (player.frozenUntil > now) {
    player.dx = 0;
    player.dy = 0;
    player.pendingMoves.length = 0;
    return;
  }
  if (player.frozenUntil > 0) player.frozenUntil = 0;
  applyQueuedMovement(player);
  const holderId = holders[player.teamId];
  const forbiddenCircles = holderId && holderId !== player.id
    ? [{ ...TEAM_HQ_POLES[player.teamId], radius: GAME_RULES.hqPoleTouchRadius }]
    : [];
  const next = stepMovement(player, { dx: player.dx, dy: player.dy }, deltaSeconds, { forbiddenCircles });
  player.x = next.x;
  player.y = next.y;
  if (holderId === player.id && !touchesHomePole(player)) holders[player.teamId] = undefined;
  if (!holders[player.teamId] && player.status === "ACTIVE" && touchesHomePole(player)) holders[player.teamId] = player.id;
}

export function touchesHomePole(player: Pick<ServerPlayer, "x" | "y" | "teamId">): boolean {
  const pole = TEAM_HQ_POLES[player.teamId];
  return Math.hypot(player.x - pole.x, player.y - pole.y) <= MOVEMENT_CONFIG.playerRadius + GAME_RULES.hqPoleTouchRadius;
}

export function releasePole(player: Pick<ServerPlayer, "id" | "teamId">, holders: PoleHolders): void {
  if (holders[player.teamId] === player.id) holders[player.teamId] = undefined;
}
