import { ARENA_CONFIG, MOVEMENT_CONFIG } from "../constants";
import { MOVEMENT_COLLIDERS } from "../map";

export interface MovementInput {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

export interface ForbiddenCircle {
  x: number;
  y: number;
  radius: number;
}

export interface MovementOptions {
  forbiddenCircles?: readonly ForbiddenCircle[];
}

/** Canonical walk step shared by the authoritative server and local prediction. */
export function stepMovement(
  position: { x: number; y: number },
  input: MovementInput,
  deltaSeconds: number,
  options: MovementOptions = {},
): { x: number; y: number } {
  const magnitude = Math.hypot(input.dx, input.dy);
  if (magnitude === 0 || deltaSeconds <= 0) return { ...position };

  const distance = (MOVEMENT_CONFIG.speed * deltaSeconds) / magnitude;
  let x = position.x;
  let y = position.y;
  const nextX = x + input.dx * distance;
  if (isPositionFree(nextX, y, options)) x = nextX;
  const nextY = y + input.dy * distance;
  if (isPositionFree(x, nextY, options)) y = nextY;
  return { x, y };
}

export function isPositionFree(
  x: number,
  y: number,
  options: MovementOptions = {},
): boolean {
  const radius = MOVEMENT_CONFIG.playerRadius;
  if (x < radius || y < radius || x > ARENA_CONFIG.width - radius || y > ARENA_CONFIG.height - radius) return false;
  for (const obstacle of MOVEMENT_COLLIDERS) {
    const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
    const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy < radius * radius) return false;
  }
  for (const circle of options.forbiddenCircles ?? []) {
    const dx = x - circle.x;
    const dy = y - circle.y;
    const combinedRadius = circle.radius + radius;
    if (dx * dx + dy * dy < combinedRadius * combinedRadius) return false;
  }
  return true;
}
