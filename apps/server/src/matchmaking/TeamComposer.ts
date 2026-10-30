export interface QueueGroup<T> {
  id: string;
  createdAt: number;
  members: readonly T[];
}

export interface ComposedMatch<T> {
  blue: QueueGroup<T>[];
  red: QueueGroup<T>[];
}

/** Packs whole parties into two exact teams. It never splits a group. */
export function composeMatch<G extends QueueGroup<unknown>>(groups: readonly G[], teamSize: 4 | 5): { blue: G[]; red: G[] } | undefined {
  const candidates = groups
    .filter((group) => group.members.length > 0 && group.members.length <= teamSize)
    .toSorted((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  if (candidates.reduce((sum, group) => sum + group.members.length, 0) < teamSize * 2) return undefined;

  const states = new Map<string, { blueCount: number; redCount: number; blue: G[]; red: G[] }>();
  states.set("0:0", { blueCount: 0, redCount: 0, blue: [], red: [] });
  for (const group of candidates) {
    const priorStates = [...states.values()];
    for (const state of priorStates) {
      const size = group.members.length;
      if (state.blueCount + size <= teamSize) {
        const next = {
          blueCount: state.blueCount + size,
          redCount: state.redCount,
          blue: [...state.blue, group],
          red: state.red,
        };
        if (next.blueCount === teamSize && next.redCount === teamSize) return next;
        const key = `${next.blueCount}:${next.redCount}`;
        if (!states.has(key)) states.set(key, next);
      }
      if (state.redCount + size <= teamSize) {
        const next = {
          blueCount: state.blueCount,
          redCount: state.redCount + size,
          blue: state.blue,
          red: [...state.red, group],
        };
        if (next.blueCount === teamSize && next.redCount === teamSize) return next;
        const key = `${next.blueCount}:${next.redCount}`;
        if (!states.has(key)) states.set(key, next);
      }
    }
  }
  return undefined;
}
