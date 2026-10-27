import Phaser from "phaser";
import {
  ARENA_CONFIG,
  MOVEMENT_CONFIG,
  SIGHT_BLOCKER_SEGMENTS,
  hasLineOfSight,
} from "@osmosis/shared";

interface FogTile {
  index: number;
  sample: { x: number; y: number };
}

export class FogOfWarRenderer {
  private readonly tileSize = 128;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  private tiles: FogTile[] = [];
  private visibleTiles: FogTile[] = [];
  private lastPosition = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
  private lastUpdateAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly scene: Phaser.Scene) {}

  create(startPosition: { x: number; y: number }): void {
    const texture = this.scene.make.graphics({ x: 0, y: 0 });
    texture.fillStyle(0x759b9d, 0.72).fillRect(0, 0, this.tileSize, this.tileSize);
    texture.generateTexture("fog-cover", this.tileSize, this.tileSize);
    texture.destroy();

    const columns = Math.ceil(ARENA_CONFIG.width / this.tileSize);
    const rows = Math.ceil(ARENA_CONFIG.height / this.tileSize);
    const data = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
    const map = this.scene.make.tilemap({ data, tileWidth: this.tileSize, tileHeight: this.tileSize });
    const tileset = map.addTilesetImage("fog-cover", "fog-cover", this.tileSize, this.tileSize, 0, 0);
    if (!tileset) throw new Error("Could not create the fog tileset.");
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) throw new Error("Could not create the fog tile layer.");
    this.layer = layer.setDepth(40).setCullPadding(2, 2);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column * this.tileSize;
        const y = row * this.tileSize;
        this.tiles.push({
          index: row * columns + column,
          sample: {
            x: Math.min(x + this.tileSize / 2, ARENA_CONFIG.width),
            y: Math.min(y + this.tileSize / 2, ARENA_CONFIG.height),
          },
        });
      }
    }
    this.update(0, startPosition, true);
  }

  update(time: number, focus: { x: number; y: number }, force = false): void {
    if (!force && time - this.lastUpdateAt < 50) return;
    if (!force && Math.hypot(focus.x - this.lastPosition.x, focus.y - this.lastPosition.y) < 4) return;
    this.lastPosition = { x: focus.x, y: focus.y };
    this.lastUpdateAt = time;

    const previousVisible = new Set(this.visibleTiles.map(({ index }) => index));
    const nextVisible: FogTile[] = [];
    const columns = Math.ceil(ARENA_CONFIG.width / this.tileSize);
    const bounds = {
      left: focus.x - MOVEMENT_CONFIG.viewRadius,
      right: focus.x + MOVEMENT_CONFIG.viewRadius,
      top: focus.y - MOVEMENT_CONFIG.viewRadius,
      bottom: focus.y + MOVEMENT_CONFIG.viewRadius,
    };
    const nearbyBlockers = SIGHT_BLOCKER_SEGMENTS.filter((segment) => {
      const left = Math.min(segment.start.x, segment.end.x);
      const right = Math.max(segment.start.x, segment.end.x);
      const top = Math.min(segment.start.y, segment.end.y);
      const bottom = Math.max(segment.start.y, segment.end.y);
      return right >= bounds.left && left <= bounds.right && bottom >= bounds.top && top <= bounds.bottom;
    });
    const minColumn = Math.max(0, Math.floor((focus.x - MOVEMENT_CONFIG.viewRadius) / this.tileSize));
    const maxColumn = Math.min(columns - 1, Math.floor((focus.x + MOVEMENT_CONFIG.viewRadius) / this.tileSize));
    const rowCount = Math.ceil(ARENA_CONFIG.height / this.tileSize);
    const minRow = Math.max(0, Math.floor((focus.y - MOVEMENT_CONFIG.viewRadius) / this.tileSize));
    const maxRow = Math.min(rowCount - 1, Math.floor((focus.y + MOVEMENT_CONFIG.viewRadius) / this.tileSize));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const tile = this.tiles[row * columns + column];
        if (!tile) continue;
        const distance = Math.hypot(tile.sample.x - focus.x, tile.sample.y - focus.y);
        if (distance <= MOVEMENT_CONFIG.viewRadius && hasLineOfSight(focus, tile.sample, nearbyBlockers)) nextVisible.push(tile);
      }
    }
    const nextVisibleIndices = new Set(nextVisible.map(({ index }) => index));
    for (const index of previousVisible) {
      if (!nextVisibleIndices.has(index)) this.layer.putTileAt(0, index % columns, Math.floor(index / columns), false);
    }
    for (const index of nextVisibleIndices) {
      if (!previousVisible.has(index)) this.layer.removeTileAt(index % columns, Math.floor(index / columns), true, false);
    }
    this.visibleTiles = nextVisible;
  }
}
