import { describe, expect, it } from "vitest";

import { ARENA_OBSTACLES, MOVEMENT_CONFIG, settleBattle, remainingSeconds, generatePickupLocations } from "..";

describe("authoritative gameplay rules", () => {
  it("makes ties transfer no points", () => {
    expect(settleBattle([{ id: "a", points: 400 }], [{ id: "b", points: 400 }], 500)).toMatchObject({
      transfer: 0,
      tied: true,
      winnerPoints: {},
      loserPoints: {},
    });
  });

  it("caps solo battle transfers by the loser's balance", () => {
    const outcome = settleBattle([{ id: "winner", points: 1_000 }], [{ id: "loser", points: 130 }], 500);
    expect(outcome.transfer).toBe(130);
    expect(outcome.winnerPoints).toEqual({ winner: 130 });
    expect(outcome.loserPoints).toEqual({ loser: 130 });
  });

  it("splits linked battle gains evenly with stable ID remainder and charges losses proportionally", () => {
    const outcome = settleBattle(
      [{ id: "winner-z", points: 600 }, { id: "winner-a", points: 500 }],
      [{ id: "loser-z", points: 700 }, { id: "loser-a", points: 300 }],
      500,
    );
    expect(outcome.winnerPoints).toEqual({ "winner-a": 250, "winner-z": 250 });
    expect(outcome.loserPoints).toEqual({ "loser-a": 150, "loser-z": 350 });
    expect(Object.values(outcome.winnerPoints).reduce((a, b) => a + b, 0)).toBe(outcome.transfer);
    expect(Object.values(outcome.loserPoints).reduce((a, b) => a + b, 0)).toBe(outcome.transfer);
  });

  it("does not charge a zero-balance linked player", () => {
    const outcome = settleBattle(
      [{ id: "winner", points: 100 }],
      [{ id: "empty", points: 0 }, { id: "funded", points: 80 }],
      500,
    );
    expect(outcome.transfer).toBe(80);
    expect(outcome.loserPoints).toEqual({ empty: 0, funded: 80 });
  });

  it("generates repeatable room-seeded pickups away from both spawn bases", () => {
    const first = generatePickupLocations(123456);
    expect(generatePickupLocations(123456)).toEqual(first);
    expect(generatePickupLocations(654321)).not.toEqual(first);
    expect(first).toHaveLength(12);
    expect(first.every(({ x }) => x > 350 && x < 2_450)).toBe(true);
    expect(first.every((point) => ARENA_OBSTACLES.every((wall) => {
      const nearestX = Math.max(wall.x, Math.min(point.x, wall.x + wall.width));
      const nearestY = Math.max(wall.y, Math.min(point.y, wall.y + wall.height));
      return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2 >= MOVEMENT_CONFIG.playerRadius ** 2;
    }))).toBe(true);
  });

  it("rounds a server deadline up and clamps at zero", () => {
    expect(remainingSeconds(10_100, 0)).toBe(11);
    expect(remainingSeconds(900, 1_000)).toBe(0);
  });
});
