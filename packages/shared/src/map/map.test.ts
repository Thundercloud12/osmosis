import { describe, expect, it } from "vitest";

import { ARENA_CONFIG } from "../constants";
import { ARENA_OBSTACLES, TEAM_BASES, hasLineOfSight,
  raySegmentIntersection,
  rectangleToSegments,
  visibilityPolygon,
} from "./index";

describe("canonical arena geometry", () => {
  it("uses the expanded, mirrored arena while retaining generous connected lanes", () => {
    expect(ARENA_CONFIG).toMatchObject({ width: 2_800, height: 1_600 });
    expect(TEAM_BASES.BLUE.x).toBe(ARENA_CONFIG.width - TEAM_BASES.RED.x - TEAM_BASES.RED.width);
    const west = ARENA_OBSTACLES.find(({ id }) => id === "west-spine")!;
    const east = ARENA_OBSTACLES.find(({ id }) => id === "east-spine")!;
    expect(east.x).toBe(ARENA_CONFIG.width - west.x - west.width);
    const north = ARENA_OBSTACLES.find(({ id }) => id === "center-north")!;
    const south = ARENA_OBSTACLES.find(({ id }) => id === "center-south")!;
    expect(south.y).toBe(ARENA_CONFIG.height - north.y - north.height);
    const island = ARENA_OBSTACLES.find(({ id }) => id === "center-island")!;
    expect(island.x - north.x).toBeGreaterThanOrEqual(160);
    expect(north.x + north.width - (island.x + island.width)).toBeGreaterThanOrEqual(160);
    expect(island.y - (north.y + north.height)).toBeGreaterThanOrEqual(160);
  });

  it("turns an obstacle into four closed edges", () => {
    const edges = rectangleToSegments({ id: "test", x: 10, y: 20, width: 30, height: 40 });

    expect(edges).toHaveLength(4);
    expect(edges[0]).toEqual({ start: { x: 10, y: 20 }, end: { x: 40, y: 20 } });
    expect(edges[3]?.end).toEqual(edges[0]?.start);
  });

  it("finds the nearest forward ray intersection", () => {
    const hit = raySegmentIntersection(
      { x: 0, y: 0 },
      0,
      { start: { x: 10, y: -5 }, end: { x: 10, y: 5 } },
    );

    expect(hit).toEqual({ x: 10, y: 0 });
  });

  it("blocks sight through a wall but not beside it", () => {
    const blocker = rectangleToSegments({ id: "wall", x: 40, y: -10, width: 20, height: 20 });

    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 100, y: 0 }, blocker)).toBe(false);
    expect(hasLineOfSight({ x: 0, y: 30 }, { x: 100, y: 30 }, blocker)).toBe(true);
  });

  it("caps the visibility polygon at the configured radius", () => {
    const origin = { x: 50, y: 50 };
    const polygon = visibilityPolygon(origin, 25, rectangleToSegments({
      id: "bounds",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }));

    expect(polygon.length).toBeGreaterThan(0);
    expect(polygon.every((point) => Math.hypot(point.x - origin.x, point.y - origin.y) <= 25.001)).toBe(true);
  });
});
