export interface CombatantBalance {
  id: string;
  points: number;
}

export interface BattleSettlement {
  winnerIds: string[];
  loserIds: string[];
  winnerPoints: Record<string, number>;
  loserPoints: Record<string, number>;
  transfer: number;
  tied: boolean;
}

function divideEvenly(total: number, players: readonly CombatantBalance[]): Record<string, number> {
  const ordered = [...players].sort((left, right) => left.id.localeCompare(right.id));
  const each = Math.floor(total / ordered.length);
  const remainder = total % ordered.length;
  return Object.fromEntries(ordered.map((player, index) => [player.id, each + Number(index < remainder)]));
}

function deductProportionally(total: number, players: readonly CombatantBalance[]): Record<string, number> {
  const ordered = [...players].filter((player) => player.points > 0).sort((left, right) => left.id.localeCompare(right.id));
  const balance = ordered.reduce((sum, player) => sum + player.points, 0);
  if (balance === 0 || total === 0) return Object.fromEntries(players.map((player) => [player.id, 0]));

  const deductions = ordered.map((player) => {
    const exact = (total * player.points) / balance;
    return { id: player.id, points: Math.floor(exact), fraction: exact - Math.floor(exact), capacity: player.points };
  });
  let unassigned = total - deductions.reduce((sum, player) => sum + player.points, 0);
  const byRemainder = [...deductions].sort((left, right) => right.fraction - left.fraction || left.id.localeCompare(right.id));
  for (const player of byRemainder) {
    if (unassigned === 0) break;
    if (player.points < player.capacity) {
      player.points += 1;
      unassigned -= 1;
    }
  }
  return Object.fromEntries(players.map((player) => [player.id, deductions.find((entry) => entry.id === player.id)?.points ?? 0]));
}

/** Compare linked groups and transfer up to `transferLimit` without creating or losing points. */
export function settleBattle(
  firstGroup: readonly CombatantBalance[],
  secondGroup: readonly CombatantBalance[],
  transferLimit: number,
): BattleSettlement {
  const firstTotal = firstGroup.reduce((sum, player) => sum + player.points, 0);
  const secondTotal = secondGroup.reduce((sum, player) => sum + player.points, 0);
  if (firstTotal === secondTotal) {
    return {
      winnerIds: [],
      loserIds: [],
      winnerPoints: {},
      loserPoints: {},
      transfer: 0,
      tied: true,
    };
  }

  const winners = firstTotal > secondTotal ? firstGroup : secondGroup;
  const losers = firstTotal > secondTotal ? secondGroup : firstGroup;
  const transfer = Math.min(transferLimit, firstTotal > secondTotal ? secondTotal : firstTotal);
  return {
    winnerIds: winners.map((player) => player.id),
    loserIds: losers.map((player) => player.id),
    winnerPoints: divideEvenly(transfer, winners),
    loserPoints: deductProportionally(transfer, losers),
    transfer,
    tied: false,
  };
}

export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}
