import { ARENA_CONFIG, MOVEMENT_CONFIG } from "../constants";

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  start: Point;
  end: Point;
}

export const ARENA_OBSTACLES: readonly Rectangle[] = [
  { id: "north-west", x: 380, y: 260, width: 560, height: 110 },
  { id: "north-east", x: 1_860, y: 260, width: 560, height: 110 },
  { id: "south-west", x: 380, y: 1_230, width: 560, height: 110 },
  { id: "south-east", x: 1_860, y: 1_230, width: 560, height: 110 },
  { id: "west-spine", x: 760, y: 600, width: 120, height: 400 },
  { id: "east-spine", x: 1_920, y: 600, width: 120, height: 400 },
  { id: "center-north", x: 1_150, y: 400, width: 500, height: 100 },
  { id: "center-south", x: 1_150, y: 1_100, width: 500, height: 100 },
  { id: "center-island", x: 1_320, y: 680, width: 160, height: 240 },
] as const;

export const TEAM_BASES = {
  BLUE: { id: "blue-base", x: 90, y: 600, width: 240, height: 400 },
  RED: { id: "red-base", x: 2_470, y: 600, width: 240, height: 400 },
} as const;

export const PROTOTYPE_SPAWN: Point = { x: 210, y: 800 };

const PICKUP_CANDIDATES: readonly Point[] = [
  { x: 500, y: 500 }, { x: 1_050, y: 560 }, { x: 1_750, y: 560 }, { x: 2_300, y: 500 },
  { x: 500, y: 1_100 }, { x: 1_050, y: 1_040 }, { x: 1_750, y: 1_040 }, { x: 2_300, y: 1_100 },
  { x: 500, y: 800 }, { x: 1_000, y: 800 }, { x: 1_800, y: 800 }, { x: 2_300, y: 800 },
  { x: 1_000, y: 560 }, { x: 1_800, y: 560 }, { x: 1_000, y: 1_040 }, { x: 1_800, y: 1_040 },
  { x: 600, y: 450 }, { x: 2_200, y: 450 }, { x: 600, y: 1_150 }, { x: 2_200, y: 1_150 },
];

/** A stable, room-seeded selection of pickup points, away from both spawn bases. */
export function generatePickupLocations(seed: number, count = 12): Array<Point & { id: string }> {
  let state = seed >>> 0 || 0x6d2b79f5;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const radiusSquared = MOVEMENT_CONFIG.playerRadius ** 2;
  const candidates = PICKUP_CANDIDATES.filter((point) => {
    if (point.x < MOVEMENT_CONFIG.playerRadius || point.y < MOVEMENT_CONFIG.playerRadius ||
      point.x > ARENA_CONFIG.width - MOVEMENT_CONFIG.playerRadius || point.y > ARENA_CONFIG.height - MOVEMENT_CONFIG.playerRadius) return false;
    const clearOf = (rectangle: Rectangle) => {
      const nearestX = Math.max(rectangle.x, Math.min(point.x, rectangle.x + rectangle.width));
      const nearestY = Math.max(rectangle.y, Math.min(point.y, rectangle.y + rectangle.height));
      return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2 >= radiusSquared;
    };
    return ARENA_OBSTACLES.every(clearOf) && Object.values(TEAM_BASES).every(clearOf);
  });
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex]!, candidates[index]!];
  }
  return candidates.slice(0, Math.min(count, candidates.length)).map((point, index) => ({
    ...point,
    id: `pickup-${String(index + 1).padStart(2, "0")}`,
  }));
}

export function rectangleToSegments(rectangle: Rectangle): Segment[] {
  const left = rectangle.x;
  const right = rectangle.x + rectangle.width;
  const top = rectangle.y;
  const bottom = rectangle.y + rectangle.height;

  return [
    { start: { x: left, y: top }, end: { x: right, y: top } },
    { start: { x: right, y: top }, end: { x: right, y: bottom } },
    { start: { x: right, y: bottom }, end: { x: left, y: bottom } },
    { start: { x: left, y: bottom }, end: { x: left, y: top } },
  ];
}

export const ARENA_BOUNDARY_SEGMENTS: readonly Segment[] = rectangleToSegments({
  id: "arena-boundary",
  x: 0,
  y: 0,
  width: ARENA_CONFIG.width,
  height: ARENA_CONFIG.height,
});

export const SIGHT_BLOCKER_SEGMENTS: readonly Segment[] = [
  ...ARENA_BOUNDARY_SEGMENTS,
  ...ARENA_OBSTACLES.flatMap(rectangleToSegments),
];

const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

export function raySegmentIntersection(
  origin: Point,
  angle: number,
  segment: Segment,
): Point | null {
  const ray = { x: Math.cos(angle), y: Math.sin(angle) };
  const edge = {
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y,
  };
  const offset = {
    x: segment.start.x - origin.x,
    y: segment.start.y - origin.y,
  };
  const denominator = cross(ray, edge);

  if (Math.abs(denominator) < 1e-9) return null;

  const distanceAlongRay = cross(offset, edge) / denominator;
  const distanceAlongSegment = cross(offset, ray) / denominator;

  if (distanceAlongRay < 0 || distanceAlongSegment < 0 || distanceAlongSegment > 1) {
    return null;
  }

  return {
    x: origin.x + ray.x * distanceAlongRay,
    y: origin.y + ray.y * distanceAlongRay,
  };
}

export function hasLineOfSight(
  origin: Point,
  target: Point,
  blockers: readonly Segment[] = SIGHT_BLOCKER_SEGMENTS,
): boolean {
  const delta = { x: target.x - origin.x, y: target.y - origin.y };
  const targetDistance = Math.hypot(delta.x, delta.y);
  if (targetDistance === 0) return true;

  const angle = Math.atan2(delta.y, delta.x);
  return !blockers.some((segment) => {
    const hit = raySegmentIntersection(origin, angle, segment);
    if (!hit) return false;
    const hitDistance = Math.hypot(hit.x - origin.x, hit.y - origin.y);
    return hitDistance > 1e-6 && hitDistance < targetDistance - 1e-6;
  });
}

export function visibilityPolygon(
  origin: Point,
  radius: number,
  blockers: readonly Segment[] = SIGHT_BLOCKER_SEGMENTS,
): Point[] {
  const epsilon = 0.00001;
  const endpointAngles = blockers.flatMap(({ start, end }) => [start, end]).flatMap((point) => {
    const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
    return [angle - epsilon, angle, angle + epsilon];
  });

  return endpointAngles
    .map((angle) => {
      let closest: Point = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      };
      let closestDistance = radius;

      for (const blocker of blockers) {
        const hit = raySegmentIntersection(origin, angle, blocker);
        if (!hit) continue;
        const distance = Math.hypot(hit.x - origin.x, hit.y - origin.y);
        if (distance < closestDistance) {
          closest = hit;
          closestDistance = distance;
        }
      }

      return { angle, point: closest };
    })
    .sort((a, b) => a.angle - b.angle)
    .map(({ point }) => point);
}
