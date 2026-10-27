import { settleBattle, type BattleSettlement, type TeamId } from "@osmosis/shared";
import type { ServerPlayer } from "../rooms/Player";
import type { PoleHolders } from "./MovementSystem";

export type ContactResolution =
  | { kind: "IGNORE" }
  | { kind: "ELIMINATE_ATTACKER"; attacker: ServerPlayer; holder: ServerPlayer }
  | { kind: "FREEZE_PLAYER"; frozenPlayer: ServerPlayer; inactivePlayer: ServerPlayer }
  | { kind: "BATTLE"; firstGroup: ServerPlayer[]; secondGroup: ServerPlayer[] };

/** Pole contact wins first; normal battles and inactive-contact freezes only use eligible opponents. */
export function resolveContact(first: ServerPlayer, second: ServerPlayer, holders: PoleHolders,
  findById: (id: string) => ServerPlayer | undefined): ContactResolution {
  if (first.teamId === second.teamId) return { kind: "IGNORE" };
  const firstCanContact = first.status === "ACTIVE" || first.status === "INACTIVE";
  const secondCanContact = second.status === "ACTIVE" || second.status === "INACTIVE";
  if (!firstCanContact || !secondCanContact) return { kind: "IGNORE" };
  if (first.status === "ACTIVE" && holders[first.teamId] === first.id) return { kind: "ELIMINATE_ATTACKER", attacker: second, holder: first };
  if (second.status === "ACTIVE" && holders[second.teamId] === second.id) return { kind: "ELIMINATE_ATTACKER", attacker: first, holder: second };
  if (first.status === "ACTIVE" && second.status === "INACTIVE") return { kind: "FREEZE_PLAYER", frozenPlayer: first, inactivePlayer: second };
  if (first.status === "INACTIVE" && second.status === "ACTIVE") return { kind: "FREEZE_PLAYER", frozenPlayer: second, inactivePlayer: first };
  if (first.status !== "ACTIVE" || second.status !== "ACTIVE") return { kind: "IGNORE" };
  return { kind: "BATTLE", firstGroup: combatGroup(first, findById), secondGroup: combatGroup(second, findById) };
}

export function settleGroups(first: readonly ServerPlayer[], second: readonly ServerPlayer[], transferLimit: number): BattleSettlement {
  return settleBattle(first.map(({ id, points }) => ({ id, points })), second.map(({ id, points }) => ({ id, points })), transferLimit);
}

export function opponentTeam(team: TeamId): TeamId { return team === "BLUE" ? "RED" : "BLUE"; }

function combatGroup(player: ServerPlayer, findById: (id: string) => ServerPlayer | undefined): ServerPlayer[] {
  const linked = player.linkedPlayerId ? findById(player.linkedPlayerId) : undefined;
  return linked?.status === "ACTIVE" ? [player, linked].sort((a, b) => a.id.localeCompare(b.id)) : [player];
}
