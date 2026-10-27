import { describe, expect, it } from "vitest";

import { ARENA_CONFIG, MOVEMENT_CONFIG } from "../constants";
import {
  ARENA_OBSTACLES,
  MOVEMENT_COLLIDERS,
  TEAM_BASES,
  TEAM_SPAWNS,
  TEAM_SPAWN_SPACING,
  TRANSPARENT_BARRIERS,
  WAREHOUSE_TUNNELS,
  WAREHOUSE_PROPS,
  WAREHOUSE_ZONES,
  SIGHT_BLOCKER_SEGMENTS,
  generatePickupLocations,
  hasLineOfSight,
  raySegmentIntersection,
  rectangleToSegments,
  visibilityPolygon,
} from "./index";

const CELL = 48;
const columns = ARENA_CONFIG.width / CELL;
const rows = ARENA_CONFIG.height / CELL;

function canStandAt(x: number, y: number): boolean {
  if (x < MOVEMENT_CONFIG.playerRadius || y < MOVEMENT_CONFIG.playerRadius ||
    x > ARENA_CONFIG.width - MOVEMENT_CONFIG.playerRadius || y > ARENA_CONFIG.height - MOVEMENT_CONFIG.playerRadius) return false;
  return MOVEMENT_COLLIDERS.every((obstacle) => {
    const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
    const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
    return (x - nearestX) ** 2 + (y - nearestY) ** 2 >= MOVEMENT_CONFIG.playerRadius ** 2;
  });
}

function walkableGrid(): boolean[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return canStandAt(column * CELL + CELL / 2, row * CELL + CELL / 2);
  });
}

function cellAt(point: { x: number; y: number }): number {
  const column = Math.max(0, Math.min(columns - 1, Math.floor(point.x / CELL)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(point.y / CELL)));
  return row * columns + column;
}

function reachableFrom(grid: readonly boolean[], start: number): Set<number> {
  const visited = new Set<number>();
  if (!grid[start]) return visited;
  const queue = [start];
  visited.add(start);
  for (let offset = 0; offset < queue.length; offset += 1) {
    const current = queue[offset]!;
    const column = current % columns;
    const neighbors = [
      ...(column > 0 ? [current - 1] : []),
      ...(column + 1 < columns ? [current + 1] : []),
      ...(current >= columns ? [current - columns] : []),
      ...(current + columns < grid.length ? [current + columns] : []),
    ];
    for (const neighbor of neighbors) {
      if (grid[neighbor] && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

function shortestSteps(grid: readonly boolean[], start: number, target: number): number {
  if (!grid[start] || !grid[target]) return Number.POSITIVE_INFINITY;
  const distance = new Int32Array(grid.length).fill(-1);
  const queue = [start];
  distance[start] = 0;
  for (let offset = 0; offset < queue.length; offset += 1) {
    const current = queue[offset]!;
    if (current === target) return distance[current]!;
    const column = current % columns;
    const neighbors = [
      ...(column > 0 ? [current - 1] : []),
      ...(column + 1 < columns ? [current + 1] : []),
      ...(current >= columns ? [current - columns] : []),
      ...(current + columns < grid.length ? [current + columns] : []),
    ];
    for (const neighbor of neighbors) {
      if (!grid[neighbor] || distance[neighbor] !== -1) continue;
      distance[neighbor] = distance[current]! + 1;
      queue.push(neighbor);
    }
  }
  return Number.POSITIVE_INFINITY;
}

function shortestDiagonalSteps(grid: readonly boolean[], start: number, target: number): number {
  if (!grid[start] || !grid[target]) return Number.POSITIVE_INFINITY;
  const distance = new Int32Array(grid.length).fill(-1);
  const queue = [start];
  distance[start] = 0;
  for (let offset = 0; offset < queue.length; offset += 1) {
    const current = queue[offset]!;
    if (current === target) return distance[current]!;
    const column = current % columns;
    const row = Math.floor(current / columns);
    const diagonals = [
      ...(column > 0 && row > 0 && grid[current - 1] && grid[current - columns] ? [current - columns - 1] : []),
      ...(column + 1 < columns && row > 0 && grid[current + 1] && grid[current - columns] ? [current - columns + 1] : []),
      ...(column > 0 && row + 1 < rows && grid[current - 1] && grid[current + columns] ? [current + columns - 1] : []),
      ...(column + 1 < columns && row + 1 < rows && grid[current + 1] && grid[current + columns] ? [current + columns + 1] : []),
    ];
    const neighbors = [
      ...(column > 0 ? [current - 1] : []),
      ...(column + 1 < columns ? [current + 1] : []),
      ...(row > 0 ? [current - columns] : []),
      ...(row + 1 < rows ? [current + columns] : []),
      ...diagonals,
    ];
    for (const neighbor of neighbors) {
      if (!grid[neighbor] || distance[neighbor] !== -1) continue;
      distance[neighbor] = distance[current]! + 1;
      queue.push(neighbor);
    }
  }
  return Number.POSITIVE_INFINITY;
}

describe("canonical Warehouse Complex geometry", () => {
  it("fits the authored world and mirrors the two headquarters", () => {
    expect(ARENA_CONFIG).toMatchObject({ width: 11_232, height: 5_376 });
    expect(ARENA_CONFIG.width % CELL).toBe(0);
    expect(ARENA_CONFIG.height % CELL).toBe(0);
    expect(TEAM_BASES.BLUE.x).toBe(ARENA_CONFIG.width - TEAM_BASES.RED.x - TEAM_BASES.RED.width);
    expect(TEAM_BASES.BLUE.y).toBe(TEAM_BASES.RED.y);
    expect(TEAM_SPAWNS.BLUE.x).toBeLessThan(ARENA_CONFIG.width / 2);
    expect(TEAM_SPAWNS.RED.x).toBeGreaterThan(ARENA_CONFIG.width / 2);
    expect(TEAM_SPAWNS.RED.x).toBe(ARENA_CONFIG.width - TEAM_SPAWNS.BLUE.x);
    expect(TEAM_SPAWNS.RED.y).toBe(TEAM_SPAWNS.BLUE.y);
  });

  it("defines all named warehouse zones and reuses their data for decor", () => {
    const ids = new Set(WAREHOUSE_ZONES.map(({ id }) => id));
    for (const id of ["blue-hq", "receiving", "north-docks", "sorting", "dispatch", "red-hq", "maintenance", "security-office", "packing", "storage"]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(WAREHOUSE_PROPS.length).toBeGreaterThan(20);
    for (const prop of WAREHOUSE_PROPS) {
      expect(prop.x).toBeGreaterThanOrEqual(0);
      expect(prop.y).toBeGreaterThanOrEqual(0);
      expect(prop.x + prop.width).toBeLessThanOrEqual(ARENA_CONFIG.width);
      expect(prop.y + prop.height).toBeLessThanOrEqual(ARENA_CONFIG.height);
    }
  });

  it("keeps HQs, all named zones, and three macro route gates connected", () => {
    const grid = walkableGrid();
    const connected = reachableFrom(grid, cellAt(TEAM_SPAWNS.BLUE));
    expect(connected.has(cellAt(TEAM_SPAWNS.RED))).toBe(true);

    const routes = [
      { name: "north loading docks", x: ARENA_CONFIG.width / 2, y: 1_008 },
      { name: "central sorting hall", x: ARENA_CONFIG.width / 2, y: 2_976 },
      { name: "south storage", x: 8_784, y: 4_608 },
    ];
    for (const route of routes) {
      const cell = cellAt(route);
      expect(grid[cell], `${route.name} route gate should be walkable`).toBe(true);
      expect(connected.has(cell), `${route.name} route should connect to both HQs`).toBe(true);
      const minimumTravelSeconds = (shortestDiagonalSteps(grid, cellAt(TEAM_SPAWNS.BLUE), cell) +
        shortestDiagonalSteps(grid, cellAt(TEAM_SPAWNS.RED), cell)) * CELL / MOVEMENT_CONFIG.speed;
      const cardinalTravelSeconds = (shortestSteps(grid, cellAt(TEAM_SPAWNS.BLUE), cell) +
        shortestSteps(grid, cellAt(TEAM_SPAWNS.RED), cell)) * CELL / MOVEMENT_CONFIG.speed;
      expect(minimumTravelSeconds, `${route.name} minimum diagonal route should stay above 35 seconds`)
        .toBeGreaterThanOrEqual(35);
      expect(cardinalTravelSeconds, `${route.name} cardinal route should stay within 60 seconds`)
        .toBeLessThanOrEqual(60);
    }

    for (const zone of WAREHOUSE_ZONES) {
      const center = cellAt({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 });
      expect(connected.has(center), `${zone.label} should be reachable`).toBe(true);
    }
  });

  it("encloses the room connectors so players must use the authored corridors", () => {
    const centerOf = (id: string) => {
      const tunnel = WAREHOUSE_TUNNELS.find((candidate) => candidate.id === id)!;
      return { x: tunnel.x + tunnel.width / 2, y: tunnel.y + tunnel.height / 2 };
    };
    for (const id of ["tunnel-receiving-sorting", "tunnel-maintenance-office", "tunnel-receiving-maintenance"]) {
      const point = centerOf(id);
      expect(canStandAt(point.x, point.y), `${id} should remain traversable`).toBe(true);
    }
    expect(canStandAt(3_816, 2_208), "space beside receiving/sorting tunnel should be sealed").toBe(false);
    expect(canStandAt(3_816, 3_984), "space beside maintenance/office tunnel should be sealed").toBe(false);
    expect(canStandAt(2_304, 3_576), "space beside receiving/maintenance tunnel should be sealed").toBe(false);
  });

  it("keeps spawns and seeded pickup locations outside collision footprints", () => {
    expect(canStandAt(TEAM_SPAWNS.BLUE.x, TEAM_SPAWNS.BLUE.y)).toBe(true);
    expect(canStandAt(TEAM_SPAWNS.RED.x, TEAM_SPAWNS.RED.y)).toBe(true);
    for (const teamId of ["BLUE", "RED"] as const) {
      const base = TEAM_BASES[teamId];
      for (let slot = 0; slot < 5; slot += 1) {
        const spawnY = TEAM_SPAWNS[teamId].y + slot * TEAM_SPAWN_SPACING;
        expect(spawnY).toBeLessThan(base.y + base.height);
        expect(canStandAt(TEAM_SPAWNS[teamId].x, spawnY)).toBe(true);
      }
    }
    const pickups = generatePickupLocations(17);
    expect(pickups.length).toBeGreaterThanOrEqual(12);
    expect(pickups).toEqual(generatePickupLocations(17));
    expect(pickups.every(({ x, y }) => canStandAt(x, y))).toBe(true);
    expect(pickups.every(({ x, y }) => Object.values(TEAM_BASES).every((base) =>
      x < base.x - MOVEMENT_CONFIG.playerRadius || x > base.x + base.width + MOVEMENT_CONFIG.playerRadius ||
      y < base.y - MOVEMENT_CONFIG.playerRadius || y > base.y + base.height + MOVEMENT_CONFIG.playerRadius,
    ))).toBe(true);
  });

  it("makes glass block movement but preserve sight while opaque racks block both", () => {
    const glass = TRANSPARENT_BARRIERS.find(({ id }) => id === "office-glass-west")!;
    expect(MOVEMENT_COLLIDERS).toContain(glass);
    expect(SIGHT_BLOCKER_SEGMENTS).not.toContainEqual(expect.objectContaining({ start: { x: glass.x, y: glass.y } }));
    expect(hasLineOfSight({ x: 4_368, y: 4_128 }, { x: 4_512, y: 4_128 })).toBe(true);

    const rack = ARENA_OBSTACLES.find(({ id }) => id === "rack-1-north")!;
    expect(MOVEMENT_COLLIDERS).toContain(rack);
    expect(hasLineOfSight({ x: 8_352, y: 4_224 }, { x: 8_544, y: 4_224 })).toBe(false);
  });

  it("keeps optimized line-of-sight results identical to the original full segment scan", () => {
    const points = [
      { x: 624, y: 2_352 }, { x: 2_300, y: 2_400 }, { x: 2_600, y: 3_000 },
      { x: 2_784, y: 1_008 }, { x: 5_616, y: 1_008 }, { x: 5_616, y: 2_976 },
      { x: 4_848, y: 4_368 }, { x: 8_784, y: 4_608 }, { x: 10_608, y: 2_352 },
    ];
    for (let index = 0; index < points.length; index += 1) {
      const origin = points[index]!;
      const target = points[(index * 5 + 3) % points.length]!;
      const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
      const targetDistance = Math.hypot(target.x - origin.x, target.y - origin.y);
      const originalResult = !SIGHT_BLOCKER_SEGMENTS.some((segment) => {
        const hit = raySegmentIntersection(origin, angle, segment);
        if (!hit) return false;
        const hitDistance = Math.hypot(hit.x - origin.x, hit.y - origin.y);
        return hitDistance > 1e-6 && hitDistance < targetDistance - 1e-6;
      });
      expect(hasLineOfSight(origin, target)).toBe(originalResult);
    }
  });

  it("turns a rectangle into four closed edges", () => {
    const edges = rectangleToSegments({ id: "test", x: 10, y: 20, width: 30, height: 40 });
    expect(edges).toHaveLength(4);
    expect(edges[0]).toEqual({ start: { x: 10, y: 20 }, end: { x: 40, y: 20 } });
    expect(edges[3]?.end).toEqual(edges[0]?.start);
  });

  it("finds the nearest forward ray intersection", () => {
    const hit = raySegmentIntersection(
      { x: 0, y: 0 }, 0,
      { start: { x: 10, y: -5 }, end: { x: 10, y: 5 } },
    );
    expect(hit).toEqual({ x: 10, y: 0 });
  });

  it("caps the visibility polygon at the configured radius", () => {
    const origin = { x: 50, y: 50 };
    const polygon = visibilityPolygon(origin, 25, rectangleToSegments({ id: "bounds", x: 0, y: 0, width: 100, height: 100 }));
    expect(polygon.length).toBeGreaterThan(0);
    expect(polygon.every((point) => Math.hypot(point.x - origin.x, point.y - origin.y) <= 25.001)).toBe(true);
  });
});
