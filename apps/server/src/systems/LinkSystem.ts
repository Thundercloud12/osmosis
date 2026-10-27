import { MOVEMENT_CONFIG, hasLineOfSight } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";

export function startLink(player: ServerPlayer, teammate: ServerPlayer | undefined,
  withinRange: (first: ServerPlayer, second: ServerPlayer) => boolean): void {
  if (!teammate || teammate.id === player.id || player.status !== "ACTIVE" || teammate.status !== "ACTIVE") {
    throw new Error("Both crewmates must be active to link.");
  }
  if (teammate.teamId !== player.teamId) throw new Error("You can only link with your own crew.");
  if (player.linkedPlayerId || teammate.linkedPlayerId) throw new Error("A linked crewmate can only have one link.");
  if (!withinRange(player, teammate)) throw new Error("Move closer and keep a clear line of sight to link.");
  player.linkedPlayerId = teammate.id;
  teammate.linkedPlayerId = player.id;
}

export function breakLink(player: ServerPlayer, findById: (id: string) => ServerPlayer | undefined): void {
  const linked = player.linkedPlayerId ? findById(player.linkedPlayerId) : undefined;
  player.linkedPlayerId = undefined;
  if (linked?.linkedPlayerId === player.id) linked.linkedPlayerId = undefined;
}

export function validateLinks(players: Iterable<ServerPlayer>, findById: (id: string) => ServerPlayer | undefined,
  withinRange: (first: ServerPlayer, second: ServerPlayer) => boolean): void {
  for (const player of players) {
    if (!player.linkedPlayerId) continue;
    const linked = findById(player.linkedPlayerId);
    if (!linked) { breakLink(player, findById); continue; }
    if (player.id > linked.id) continue;
    if (player.status !== "ACTIVE" || linked.status !== "ACTIVE" || !withinRange(player, linked)) breakLink(player, findById);
  }
}

export function withinLinkRange(first: Pick<ServerPlayer, "x" | "y">, second: Pick<ServerPlayer, "x" | "y">): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= MOVEMENT_CONFIG.linkRadius && hasLineOfSight(first, second);
}
