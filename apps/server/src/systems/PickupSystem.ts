import { GAME_RULES, MOVEMENT_CONFIG } from "@osmosis/shared";
import type { Pickup, ServerPlayer } from "../rooms/Player";

export interface PickupCollection {
  playerId: string;
  pickupId: string;
  points: number;
}

/** Resolves contested pickups in stable player order; each pickup is awarded at most once. */
export function collectPickups(players: Iterable<ServerPlayer>, pickups: readonly Pickup[]): {
  remainingPickups: Pickup[];
  collections: PickupCollection[];
} {
  const remaining = [...pickups];
  const collections: PickupCollection[] = [];
  for (const player of [...players].filter((candidate) => candidate.status === "ACTIVE").sort((a, b) => a.id.localeCompare(b.id))) {
    const index = remaining.findIndex((pickup) =>
      Math.hypot(player.x - pickup.x, player.y - pickup.y) <= MOVEMENT_CONFIG.playerRadius + 16,
    );
    if (index < 0) continue;
    const [pickup] = remaining.splice(index, 1);
    if (pickup) collections.push({ playerId: player.id, pickupId: pickup.id, points: GAME_RULES.pickupReward });
  }
  return { remainingPickups: remaining, collections };
}
