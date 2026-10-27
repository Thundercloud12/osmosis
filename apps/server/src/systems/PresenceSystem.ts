import type { PlayerStatus } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";

/** Retains the player's prior state while reserving their seat for reconnection. */
export function disconnectPlayer(player: ServerPlayer, reconnectUntil: number | undefined): void {
  if (player.status !== "DISCONNECTED") player.statusBeforeDisconnect = player.status;
  player.connected = false;
  player.status = "DISCONNECTED";
  player.dx = 0;
  player.dy = 0;
  player.pendingMoves.length = 0;
  player.ready = false;
  player.reconnectUntil = reconnectUntil;
}

/** Restores a reserved player without reviving an elimination or stale movement input. */
export function reconnectPlayer(player: ServerPlayer, now: number, isInsideOwnBase: (player: ServerPlayer) => boolean): void {
  const previousStatus: Exclude<PlayerStatus, "DISCONNECTED"> = player.statusBeforeDisconnect ?? "ACTIVE";
  player.connected = true;
  player.status = previousStatus;
  player.lastSequence = -1;
  player.lastAppliedSequence = -1;
  player.pendingMoves.length = 0;
  player.dx = 0;
  player.dy = 0;
  if (player.status === "INACTIVE" && (now >= player.inactiveUntil || isInsideOwnBase(player))) {
    player.status = "ACTIVE";
  }
  if (player.status === "ACTIVE") player.inactiveUntil = 0;
  if (player.frozenUntil <= now) player.frozenUntil = 0;
  player.statusBeforeDisconnect = undefined;
  player.reconnectUntil = undefined;
  player.ready = false;
}

export function connectedPlayerCount(players: Iterable<ServerPlayer>): number {
  let count = 0;
  for (const player of players) if (player.connected) count += 1;
  return count;
}

export function oldestConnectedPlayerId(players: Iterable<ServerPlayer>): string | undefined {
  return [...players]
    .filter((player) => player.connected)
    .sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;
}

/** Removes explicit departures and expired reservations before a rematch roster is built. */
export function purgeDisconnectedPlayersForRematch(players: Map<string, ServerPlayer>, now: number): void {
  for (const [sessionId, player] of players) {
    if (!player.connected && (player.reconnectUntil === undefined || player.reconnectUntil <= now)) players.delete(sessionId);
  }
}
