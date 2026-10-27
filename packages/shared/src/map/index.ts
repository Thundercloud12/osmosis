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

export interface WarehouseZone extends Rectangle {
  label: string;
  floorFrame: number;
  tint: number;
}

export interface WarehouseProp extends Point {
  id: string;
  frame: number;
  width: number;
  height: number;
  rotation?: number;
  tint?: number;
}

/** Adds a matched 1,008-unit approach lane between each HQ and the warehouse core. */
const CORE_APPROACH_OFFSET_X = 1_008;
const offsetX = <T extends { x: number }>(items: readonly T[], amount: number): T[] =>
  items.map((item) => ({ ...item, x: item.x + amount }));

/** Authored regions drive the Phaser floor layers and the tactical minimap. */
const AUTHORED_WAREHOUSE_ZONES: readonly WarehouseZone[] = [
  { id: "blue-hq", label: "BLUE HQ", x: 192, y: 2_112, width: 864, height: 1_152, floorFrame: 0, tint: 0x91d4e6 },
  { id: "receiving", label: "RECEIVING BAY", x: 1_056, y: 1_920, width: 1_440, height: 1_440, floorFrame: 1, tint: 0xe9ad72 },
  { id: "north-docks", label: "NORTH LOADING DOCKS", x: 1_056, y: 288, width: 7_056, height: 1_344, floorFrame: 0, tint: 0xd2b36b },
  { id: "sorting", label: "CENTRAL SORTING HALL", x: 3_120, y: 1_920, width: 2_976, height: 1_632, floorFrame: 2, tint: 0x93b5dd },
  { id: "dispatch", label: "DISPATCH BAY", x: 6_672, y: 1_920, width: 1_440, height: 1_440, floorFrame: 1, tint: 0xe9ad72 },
  { id: "red-hq", label: "RED HQ", x: 8_160, y: 2_112, width: 864, height: 1_152, floorFrame: 0, tint: 0xf08e83 },
  { id: "maintenance", label: "MAINTENANCE", x: 1_056, y: 3_792, width: 1_440, height: 1_296, floorFrame: 2, tint: 0x93a8bb },
  { id: "security-office", label: "SECURITY OFFICE", x: 3_120, y: 3_792, width: 1_440, height: 1_296, floorFrame: 0, tint: 0x89cbb2 },
  { id: "packing", label: "PACKING ANNEX", x: 5_184, y: 3_792, width: 1_440, height: 1_296, floorFrame: 1, tint: 0xe9ad72 },
  { id: "storage", label: "SOUTH STORAGE RACKS", x: 7_248, y: 3_792, width: 1_440, height: 1_296, floorFrame: 0, tint: 0xb6a1cf },
] as const;
export const WAREHOUSE_ZONES: readonly WarehouseZone[] = AUTHORED_WAREHOUSE_ZONES.map((zone) => ({
  ...zone,
  x: zone.id === "blue-hq" ? zone.x : zone.id === "red-hq"
    ? zone.x + CORE_APPROACH_OFFSET_X * 2
    : zone.x + CORE_APPROACH_OFFSET_X,
}));

interface RoomDoor {
  side: "north" | "east" | "south" | "west";
  center: number;
  width: number;
}

const DOOR_WIDTH = 288;
const ROOM_DOORS: Readonly<Record<string, readonly RoomDoor[]>> = {
  "blue-hq": [{ side: "east", center: 2_688, width: DOOR_WIDTH }],
  receiving: [
    { side: "north", center: 2_784, width: DOOR_WIDTH },
    { side: "west", center: 2_688, width: DOOR_WIDTH },
    { side: "east", center: 2_688, width: DOOR_WIDTH },
    { side: "south", center: 2_784, width: DOOR_WIDTH },
  ],
  "north-docks": [
    { side: "south", center: 2_784, width: DOOR_WIDTH },
    { side: "south", center: 5_616, width: DOOR_WIDTH },
    { side: "south", center: 8_400, width: DOOR_WIDTH },
  ],
  sorting: [
    { side: "north", center: 5_616, width: DOOR_WIDTH },
    { side: "west", center: 2_688, width: DOOR_WIDTH },
    { side: "east", center: 2_688, width: DOOR_WIDTH },
    { side: "south", center: 4_848, width: DOOR_WIDTH },
  ],
  dispatch: [
    { side: "north", center: 8_400, width: DOOR_WIDTH },
    { side: "west", center: 2_688, width: DOOR_WIDTH },
    { side: "east", center: 2_688, width: DOOR_WIDTH },
    { side: "south", center: 8_784, width: DOOR_WIDTH },
  ],
  "red-hq": [{ side: "west", center: 2_688, width: DOOR_WIDTH }],
  maintenance: [
    { side: "north", center: 2_784, width: DOOR_WIDTH },
    { side: "east", center: 4_368, width: DOOR_WIDTH },
  ],
  "security-office": [
    { side: "north", center: 4_848, width: DOOR_WIDTH },
    { side: "west", center: 4_368, width: DOOR_WIDTH },
    { side: "east", center: 4_368, width: DOOR_WIDTH },
  ],
  packing: [
    { side: "west", center: 4_368, width: DOOR_WIDTH },
    { side: "east", center: 4_368, width: DOOR_WIDTH },
  ],
  storage: [
    { side: "north", center: 8_784, width: DOOR_WIDTH },
    { side: "west", center: 4_368, width: DOOR_WIDTH },
  ],
};

function roomBoundaryWalls(room: WarehouseZone): Rectangle[] {
  const thickness = 96;
  const doors = ROOM_DOORS[room.id] ?? [];
  const walls: Rectangle[] = [];
  for (const side of ["north", "south"] as const) {
    const y = side === "north" ? room.y : room.y + room.height - thickness;
    const openings = doors.filter((door) => door.side === side)
      .map((door) => ({ start: door.center - door.width / 2, end: door.center + door.width / 2 }))
      .sort((a, b) => a.start - b.start);
    let cursor = room.x;
    let segment = 0;
    for (const opening of openings) {
      if (opening.start > cursor) walls.push({
        id: `wall-${room.id}-${side}-${segment++}`, x: cursor, y, width: opening.start - cursor, height: thickness,
      });
      cursor = Math.max(cursor, opening.end);
    }
    if (cursor < room.x + room.width) walls.push({
      id: `wall-${room.id}-${side}-${segment}`, x: cursor, y, width: room.x + room.width - cursor, height: thickness,
    });
  }
  for (const side of ["west", "east"] as const) {
    const x = side === "west" ? room.x : room.x + room.width - thickness;
    const startY = room.y + thickness;
    const endY = room.y + room.height - thickness;
    const openings = doors.filter((door) => door.side === side)
      .map((door) => ({ start: door.center - door.width / 2, end: door.center + door.width / 2 }))
      .sort((a, b) => a.start - b.start);
    let cursor = startY;
    let segment = 0;
    for (const opening of openings) {
      if (opening.start > cursor) walls.push({
        id: `wall-${room.id}-${side}-${segment++}`, x, y: cursor, width: thickness, height: opening.start - cursor,
      });
      cursor = Math.max(cursor, opening.end);
    }
    if (cursor < endY) walls.push({
      id: `wall-${room.id}-${side}-${segment}`, x, y: cursor, width: thickness, height: endY - cursor,
    });
  }
  return walls;
}

/** Wide floor corridors join the enclosed rooms; each matches its door openings. */
export const WAREHOUSE_TUNNELS: readonly Rectangle[] = [
  { id: "tunnel-blue-receiving", x: 1_056, y: 2_544, width: 1_008, height: DOOR_WIDTH },
  { id: "tunnel-receiving-sorting", x: 3_504, y: 2_544, width: 624, height: DOOR_WIDTH },
  { id: "tunnel-sorting-dispatch", x: 7_104, y: 2_544, width: 576, height: DOOR_WIDTH },
  { id: "tunnel-dispatch-red", x: 9_120, y: 2_544, width: 1_056, height: DOOR_WIDTH },
  { id: "tunnel-north-receiving", x: 2_640, y: 1_632, width: DOOR_WIDTH, height: 288 },
  { id: "tunnel-north-sorting", x: 5_472, y: 1_632, width: DOOR_WIDTH, height: 288 },
  { id: "tunnel-north-dispatch", x: 8_256, y: 1_632, width: DOOR_WIDTH, height: 288 },
  { id: "tunnel-receiving-maintenance", x: 2_640, y: 3_360, width: DOOR_WIDTH, height: 432 },
  { id: "tunnel-sorting-office", x: 4_704, y: 3_552, width: DOOR_WIDTH, height: 240 },
  { id: "tunnel-maintenance-office", x: 3_504, y: 4_224, width: 624, height: DOOR_WIDTH },
  { id: "tunnel-office-packing", x: 5_568, y: 4_224, width: 624, height: DOOR_WIDTH },
  { id: "tunnel-packing-storage", x: 7_632, y: 4_224, width: 624, height: DOOR_WIDTH },
  { id: "tunnel-dispatch-storage", x: 8_640, y: 3_360, width: DOOR_WIDTH, height: 432 },
];

const TUNNEL_WALLS: readonly Rectangle[] = WAREHOUSE_TUNNELS.flatMap((tunnel) => {
  const thickness = 96;
  if (tunnel.width > tunnel.height) return [
    { id: `wall-${tunnel.id}-north`, x: tunnel.x, y: tunnel.y - thickness, width: tunnel.width, height: thickness },
    { id: `wall-${tunnel.id}-south`, x: tunnel.x, y: tunnel.y + tunnel.height, width: tunnel.width, height: thickness },
  ];
  return [
    { id: `wall-${tunnel.id}-west`, x: tunnel.x - thickness, y: tunnel.y, width: thickness, height: tunnel.height },
    { id: `wall-${tunnel.id}-east`, x: tunnel.x + tunnel.width, y: tunnel.y, width: thickness, height: tunnel.height },
  ];
});

/** Seal the unused space between adjacent room edges so each connector is a real corridor. */
const HORIZONTAL_CONNECTOR_SIDES: ReadonlyArray<{
  id: string; x: number; width: number; top: number; bottom: number; tunnelY: number; tunnelHeight: number;
}> = [
  { id: "blue-receiving", x: 1_056, width: 1_008, top: 2_112, bottom: 3_264, tunnelY: 2_544, tunnelHeight: DOOR_WIDTH },
  { id: "receiving-sorting", x: 3_504, width: 624, top: 1_920, bottom: 3_360, tunnelY: 2_544, tunnelHeight: DOOR_WIDTH },
  { id: "sorting-dispatch", x: 7_104, width: 576, top: 1_920, bottom: 3_360, tunnelY: 2_544, tunnelHeight: DOOR_WIDTH },
  { id: "dispatch-red", x: 9_120, width: 1_056, top: 2_112, bottom: 3_264, tunnelY: 2_544, tunnelHeight: DOOR_WIDTH },
  { id: "maintenance-office", x: 3_504, width: 624, top: 3_792, bottom: 5_088, tunnelY: 4_224, tunnelHeight: DOOR_WIDTH },
  { id: "office-packing", x: 5_568, width: 624, top: 3_792, bottom: 5_088, tunnelY: 4_224, tunnelHeight: DOOR_WIDTH },
  { id: "packing-storage", x: 7_632, width: 624, top: 3_792, bottom: 5_088, tunnelY: 4_224, tunnelHeight: DOOR_WIDTH },
];
const HORIZONTAL_CONNECTOR_WALLS: readonly Rectangle[] = HORIZONTAL_CONNECTOR_SIDES.flatMap((connector) => [
  { id: `wall-connector-${connector.id}-north`, x: connector.x, y: connector.top, width: connector.width, height: connector.tunnelY - connector.top },
  { id: `wall-connector-${connector.id}-south`, x: connector.x, y: connector.tunnelY + connector.tunnelHeight, width: connector.width, height: connector.bottom - connector.tunnelY - connector.tunnelHeight },
]);

const VERTICAL_CONNECTOR_SIDES: ReadonlyArray<{
  id: string; left: number; right: number; tunnelX: number; tunnelWidth: number; top: number; height: number;
}> = [
  { id: "receiving-maintenance", left: 2_064, right: 3_504, tunnelX: 2_640, tunnelWidth: DOOR_WIDTH, top: 3_360, height: 432 },
  { id: "sorting-office", left: 4_128, right: 5_568, tunnelX: 4_704, tunnelWidth: DOOR_WIDTH, top: 3_552, height: 240 },
  { id: "dispatch-storage", left: 8_256, right: 9_120, tunnelX: 8_640, tunnelWidth: DOOR_WIDTH, top: 3_360, height: 432 },
];
const VERTICAL_CONNECTOR_WALLS: readonly Rectangle[] = VERTICAL_CONNECTOR_SIDES.flatMap((connector) => [
  { id: `wall-connector-${connector.id}-west`, x: connector.left, y: connector.top, width: connector.tunnelX - connector.left - 96, height: connector.height },
  { id: `wall-connector-${connector.id}-east`, x: connector.tunnelX + connector.tunnelWidth + 96, y: connector.top, width: connector.right - connector.tunnelX - connector.tunnelWidth - 96, height: connector.height },
]);

const ROOM_WALLS: readonly Rectangle[] = WAREHOUSE_ZONES.flatMap(roomBoundaryWalls);

export const TEAM_BASES = {
  BLUE: { id: "blue-base", x: 192, y: 2_112, width: 864, height: 1_152 },
  RED: { id: "red-base", x: 10_176, y: 2_112, width: 864, height: 1_152 },
} as const;

/** Each home pole has an exclusive holder slot enforced by the authoritative match simulation. */
export const TEAM_HQ_POLES: Readonly<Record<"BLUE" | "RED", Point>> = {
  BLUE: { x: 864, y: 2_688 },
  RED: { x: 10_368, y: 2_688 },
};

export const TEAM_SPAWNS = {
  BLUE: { x: 624, y: 2_352 },
  RED: { x: 10_608, y: 2_352 },
} as const;
export const TEAM_SPAWN_SPACING = 65;

export const PROTOTYPE_SPAWN: Point = TEAM_SPAWNS.BLUE;

/** Opaque structures block both movement and sight. All coordinates align to the 48-unit tile grid. */
const AUTHORED_ARENA_OBSTACLES: readonly Rectangle[] = [
  // North loading docks: broken cargo rows leave exposed, wide travel lanes.
  { id: "north-west-pallets", x: 1_680, y: 720, width: 624, height: 144 },
  { id: "north-west-pallets-low", x: 1_680, y: 1_248, width: 624, height: 144 },
  { id: "north-mid-containers", x: 3_696, y: 432, width: 864, height: 144 },
  { id: "north-east-pallets", x: 6_384, y: 720, width: 672, height: 144 },
  { id: "north-east-pallets-low", x: 6_384, y: 1_248, width: 672, height: 144 },
  // Long receiving/dispatch racks form flanks without closing the north or south connectors.
  { id: "west-spine", x: 1_488, y: 2_016, width: 96, height: 816 },
  { id: "east-spine", x: 7_632, y: 2_016, width: 96, height: 816 },
  { id: "receiving-conveyor", x: 1_824, y: 2_160, width: 480, height: 96 },
  { id: "dispatch-conveyor", x: 6_912, y: 2_880, width: 480, height: 96 },
  // Sorting hall machinery leaves a broad central passage and side flanks.
  { id: "sorter-north-west", x: 3_648, y: 2_016, width: 624, height: 96 },
  { id: "sorter-north-east", x: 4_992, y: 2_016, width: 624, height: 96 },
  { id: "sorter-south-west", x: 3_648, y: 3_312, width: 624, height: 96 },
  { id: "sorter-south-east", x: 4_992, y: 3_312, width: 624, height: 96 },
  { id: "sorter-island", x: 4_512, y: 2_304, width: 192, height: 288 },
  { id: "sorter-west-table", x: 3_360, y: 2_592, width: 192, height: 144 },
  { id: "sorter-east-table", x: 5_664, y: 2_592, width: 192, height: 144 },
  // Maintenance and packing equipment; door gaps remain between each obstacle group.
  { id: "maintenance-generator", x: 1_632, y: 4_128, width: 192, height: 192 },
  { id: "maintenance-cabinets", x: 1_344, y: 4_080, width: 96, height: 384 },
  { id: "packing-line-west", x: 5_664, y: 4_032, width: 672, height: 96 },
  { id: "packing-line-east", x: 5_904, y: 4_608, width: 576, height: 96 },
  // Modular rack aisles sit entirely inside the enclosed south storage room.
  ...[7_392, 8_016, 8_496].flatMap((x, column) => [
    { id: `rack-${column + 1}-north`, x, y: 4_032, width: 96, height: 432 },
    { id: `rack-${column + 1}-south`, x, y: 4_656, width: 96, height: 336 },
  ]),
] as const;
export const ARENA_OBSTACLES: readonly Rectangle[] = [
  ...offsetX(AUTHORED_ARENA_OBSTACLES, CORE_APPROACH_OFFSET_X),
  ...ROOM_WALLS,
  ...HORIZONTAL_CONNECTOR_WALLS,
  ...VERTICAL_CONNECTOR_WALLS,
  ...TUNNEL_WALLS,
];

/** Glass partitions stop players but deliberately do not enter the LOS blocker list. */
const AUTHORED_TRANSPARENT_BARRIERS: readonly Rectangle[] = [
  { id: "office-glass-west", x: 3_408, y: 3_984, width: 48, height: 384 },
  { id: "office-glass-east", x: 4_368, y: 3_984, width: 48, height: 384 },
  { id: "office-glass-north", x: 3_264, y: 3_936, width: 1_056, height: 48 },
] as const;
export const TRANSPARENT_BARRIERS: readonly Rectangle[] = offsetX(AUTHORED_TRANSPARENT_BARRIERS, CORE_APPROACH_OFFSET_X);

/** Every blocking footprint is authoritative for movement, including see-through barriers. */
export const MOVEMENT_COLLIDERS: readonly Rectangle[] = [...ARENA_OBSTACLES, ...TRANSPARENT_BARRIERS];

/** Hand-placed art props use frames from the locally stored Kenney Tiny Factory atlas. */
const AUTHORED_WAREHOUSE_PROPS: readonly WarehouseProp[] = [
  { id: "dock-forklift-west", x: 1_248, y: 480, frame: 120, width: 96, height: 96 },
  { id: "dock-forklift-east", x: 7_776, y: 1_392, frame: 127, width: 96, height: 96 },
  { id: "dock-pallet-west", x: 1_248, y: 912, frame: 73, width: 96, height: 96 },
  { id: "dock-pallet-east", x: 7_776, y: 528, frame: 85, width: 96, height: 96 },
  { id: "receiving-crate-a", x: 1_296, y: 2_400, frame: 74, width: 96, height: 96 },
  { id: "receiving-crate-b", x: 2_160, y: 2_784, frame: 109, width: 96, height: 96 },
  { id: "dispatch-crate-a", x: 7_056, y: 2_304, frame: 123, width: 96, height: 96 },
  { id: "dispatch-crate-b", x: 6_816, y: 2_640, frame: 74, width: 96, height: 96 },
  { id: "sorter-conveyor-a", x: 3_936, y: 2_256, frame: 55, width: 384, height: 96 },
  { id: "sorter-conveyor-b", x: 5_040, y: 2_928, frame: 55, width: 384, height: 96 },
  { id: "maintenance-generator-art", x: 1_584, y: 4_128, frame: 86, width: 144, height: 144 },
  { id: "maintenance-console", x: 1_296, y: 4_416, frame: 90, width: 96, height: 96 },
  { id: "packing-crate-west", x: 5_568, y: 3_840, frame: 75, width: 96, height: 96 },
  { id: "packing-crate-east", x: 6_384, y: 4_512, frame: 87, width: 96, height: 96 },
  ...[7_392, 8_016, 8_496].flatMap((x, column) => [
    { id: `rack-${column + 1}-upper`, x, y: 4_032, frame: 84, width: 96, height: 432 },
    { id: `rack-${column + 1}-lower`, x, y: 4_656, frame: 84, width: 96, height: 336 },
  ]),
  { id: "storage-pallet-west", x: 7_584, y: 4_800, frame: 73, width: 96, height: 96 },
  { id: "storage-pallet-east", x: 8_280, y: 4_800, frame: 85, width: 96, height: 96 },
] as const;
export const WAREHOUSE_PROPS: readonly WarehouseProp[] = offsetX(AUTHORED_WAREHOUSE_PROPS, CORE_APPROACH_OFFSET_X);

const AUTHORED_PICKUP_CANDIDATES: readonly Point[] = [
  { x: 1_440, y: 1_008 }, { x: 2_784, y: 1_008 }, { x: 4_080, y: 1_008 }, { x: 5_424, y: 1_008 }, { x: 6_768, y: 1_008 }, { x: 7_728, y: 1_008 },
  { x: 1_248, y: 2_688 }, { x: 2_880, y: 2_880 }, { x: 3_312, y: 2_352 }, { x: 5_904, y: 2_832 }, { x: 6_768, y: 2_688 }, { x: 7_968, y: 2_688 },
  { x: 1_248, y: 4_608 }, { x: 2_352, y: 4_512 }, { x: 3_072, y: 4_512 }, { x: 4_608, y: 4_512 }, { x: 6_144, y: 4_512 }, { x: 7_968, y: 4_608 },
  { x: 3_072, y: 1_536 }, { x: 6_144, y: 1_536 }, { x: 3_072, y: 3_168 }, { x: 6_144, y: 3_168 },
];
export const PICKUP_CANDIDATES: readonly Point[] = offsetX(AUTHORED_PICKUP_CANDIDATES, CORE_APPROACH_OFFSET_X);

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
    return MOVEMENT_COLLIDERS.every(clearOf) && Object.values(TEAM_BASES).every(clearOf);
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

interface SegmentMetrics {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  dx: number;
  dy: number;
}
const segmentMetricsCache = new WeakMap<Segment, SegmentMetrics>();
function segmentMetrics(segment: Segment): SegmentMetrics {
  let metrics = segmentMetricsCache.get(segment);
  if (!metrics) {
    metrics = {
      minX: Math.min(segment.start.x, segment.end.x),
      maxX: Math.max(segment.start.x, segment.end.x),
      minY: Math.min(segment.start.y, segment.end.y),
      maxY: Math.max(segment.start.y, segment.end.y),
      dx: segment.end.x - segment.start.x,
      dy: segment.end.y - segment.start.y,
    };
    segmentMetricsCache.set(segment, metrics);
  }
  return metrics;
}

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
  // A unit direction avoids recalculating sin/cos for every wall. The endpoint AABB
  // rejects distant walls before ray math, which matters now that the warehouse has
  // many more structural segments than the original prototype.
  const rayX = delta.x / targetDistance;
  const rayY = delta.y / targetDistance;
  const minX = Math.min(origin.x, target.x);
  const maxX = Math.max(origin.x, target.x);
  const minY = Math.min(origin.y, target.y);
  const maxY = Math.max(origin.y, target.y);
  for (const segment of blockers) {
    const metrics = segmentMetrics(segment);
    if (metrics.maxX < minX || metrics.minX > maxX || metrics.maxY < minY || metrics.minY > maxY) continue;
    const offsetX = segment.start.x - origin.x;
    const offsetY = segment.start.y - origin.y;
    const denominator = rayX * metrics.dy - rayY * metrics.dx;
    if (Math.abs(denominator) < 1e-9) continue;
    const distance = (offsetX * metrics.dy - offsetY * metrics.dx) / denominator;
    const segmentFraction = (offsetX * rayY - offsetY * rayX) / denominator;
    if (distance > 1e-6 && distance < targetDistance - 1e-6 && segmentFraction >= 0 && segmentFraction <= 1) return false;
  }
  return true;
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
