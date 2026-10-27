import { describe, expect, it } from "vitest";
import { stepMovement } from "./index";

describe("canonical movement step", () => {
  it("uses constant speed for diagonal movement", () => {
    const start = { x: 800, y: 1_800 };
    const end = stepMovement(start, { dx: 1, dy: 1 }, 0.05);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(13);
  });

  it("slides on each axis when an obstacle blocks the other axis", () => {
    const start = { x: 4_625, y: 2_050 };
    const end = stepMovement(start, { dx: 1, dy: 1 }, 0.1);
    expect(end.x).toBe(start.x);
    expect(end.y).toBeGreaterThan(start.y);
  });

  it("keeps allies outside an occupied pole zone", () => {
    const pole = { x: 864, y: 2_688, radius: 36 };
    const start = { x: 740, y: 2_688 };
    let end = start;
    for (let step = 0; step < 30; step += 1) {
      end = stepMovement(end, { dx: 1, dy: 0 }, 0.05, { forbiddenCircles: [pole] });
    }
    expect(Math.hypot(end.x - pole.x, end.y - pole.y)).toBeGreaterThanOrEqual(pole.radius + 22);
  });
});
