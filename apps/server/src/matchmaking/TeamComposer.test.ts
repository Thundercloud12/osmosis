import { describe, expect, it } from "vitest";

import { composeMatch, type QueueGroup } from "./TeamComposer";

interface TestGroup extends QueueGroup<string> {}

function group(id: string, size: number, createdAt = 0): TestGroup {
  return { id, createdAt, members: Array.from({ length: size }, (_, index) => `${id}-${index}`) };
}

describe("Quick Play team composition", () => {
  it.each([4, 5] as const)("fills both %i-player-per-side teams with whole parties", (teamSize) => {
    const groups = [group("old-party", 3, 1), group("solo-a", 1, 2), group("party-b", teamSize - 1, 3), group("solo-b", 1, 4), group("fill", teamSize - 1, 5)];

    const match = composeMatch(groups, teamSize);

    expect(match).toBeDefined();
    for (const team of [match!.blue, match!.red]) {
      expect(team.reduce((count, entry) => count + entry.members.length, 0)).toBe(teamSize);
      expect(new Set(team.map((entry) => entry.id)).size).toBe(team.length);
    }
    const selected = [...match!.blue, ...match!.red];
    expect(selected.every((entry) => groups.includes(entry))).toBe(true);
  });

  it("does not split groups when headcount is sufficient but no exact packing exists", () => {
    expect(composeMatch([group("one", 3), group("two", 3), group("three", 3)], 4)).toBeUndefined();
  });

  it("returns no match when total headcount is short", () => {
    expect(composeMatch([group("party", 4), group("solo", 3)], 4)).toBeUndefined();
  });
});
