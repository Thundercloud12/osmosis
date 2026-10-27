import Phaser from "phaser";
import {
  ARENA_CONFIG,
  ARENA_OBSTACLES,
  TEAM_BASES,
  TEAM_HQ_POLES,
  TRANSPARENT_BARRIERS,
  WAREHOUSE_TUNNELS,
  WAREHOUSE_PROPS,
  WAREHOUSE_ZONES,
  type Point,
} from "@osmosis/shared";

export class WarehouseRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  draw(): void { this.drawArena(); }

  private drawArena(): void {
    this.drawWarehouseFloor();
    const zoneWashes = this.scene.add.graphics().setDepth(-10);
    for (const zone of WAREHOUSE_ZONES) zoneWashes.fillStyle(zone.tint, 0.12).fillRect(zone.x, zone.y, zone.width, zone.height);

    const floorDetails = this.scene.add.graphics().setDepth(-8);
    for (const zone of WAREHOUSE_ZONES) {
      this.scene.add.text(zone.x + zone.width / 2, zone.y + 28, zone.label, {
        color: "#fff4d7", fontFamily: "Trebuchet MS, sans-serif", fontSize: "32px", fontStyle: "bold",
        stroke: "#443b4c", strokeThickness: 7,
      }).setOrigin(0.5, 0).setAlpha(0.88).setDepth(-7);
    }

    const tunnelDetails = this.scene.add.graphics().setDepth(-8);
    for (const tunnel of WAREHOUSE_TUNNELS) {
      tunnelDetails.fillStyle(0xffe6a5, 0.12).fillRect(tunnel.x, tunnel.y, tunnel.width, tunnel.height);
      tunnelDetails.lineStyle(8, 0xf4c44f, 0.8);
      if (tunnel.width > tunnel.height) {
        tunnelDetails.lineBetween(tunnel.x, tunnel.y + 36, tunnel.x + tunnel.width, tunnel.y + 36);
        tunnelDetails.lineBetween(tunnel.x, tunnel.y + tunnel.height - 36, tunnel.x + tunnel.width, tunnel.y + tunnel.height - 36);
      } else {
        tunnelDetails.lineBetween(tunnel.x + 36, tunnel.y, tunnel.x + 36, tunnel.y + tunnel.height);
        tunnelDetails.lineBetween(tunnel.x + tunnel.width - 36, tunnel.y, tunnel.x + tunnel.width - 36, tunnel.y + tunnel.height);
      }
    }

    this.drawWarehouseObstacles();
    for (const prop of WAREHOUSE_PROPS) this.drawWarehouseProp(prop);
    for (const barrier of TRANSPARENT_BARRIERS) this.drawGlassBarrier(barrier);

    this.drawBase(TEAM_BASES.BLUE, 0x428fd4, "BLUE HQ", 110);
    this.drawBase(TEAM_BASES.RED, 0xee6e70, "RED HQ", 110);
    this.drawHqPole(TEAM_HQ_POLES.BLUE, 0x428fd4);
    this.drawHqPole(TEAM_HQ_POLES.RED, 0xee6e70);

    const border = this.scene.add.graphics().setDepth(30);
    border.lineStyle(22, 0x342c3c, 1).strokeRect(8, 8, ARENA_CONFIG.width - 16, ARENA_CONFIG.height - 16);
    border.lineStyle(8, 0xf9e6b4, 0.9).strokeRect(32, 32, ARENA_CONFIG.width - 64, ARENA_CONFIG.height - 64);
  }

  private drawWarehouseFloor(): void {
    const columns = ARENA_CONFIG.width / 48;
    const rows = ARENA_CONFIG.height / 48;
    const floor = Array.from({ length: rows }, () => Array<number>(columns).fill(1));
    for (const zone of WAREHOUSE_ZONES) {
      const startColumn = Math.floor(zone.x / 48);
      const startRow = Math.floor(zone.y / 48);
      const zoneColumns = Math.ceil(zone.width / 48);
      const zoneRows = Math.ceil(zone.height / 48);
      for (let row = startRow; row < startRow + zoneRows; row += 1) {
        for (let column = startColumn; column < startColumn + zoneColumns; column += 1) {
          if (floor[row]?.[column] !== undefined) floor[row]![column] = zone.floorFrame + 1;
        }
      }
    }
    for (const tunnel of WAREHOUSE_TUNNELS) {
      const startColumn = Math.floor(tunnel.x / 48);
      const startRow = Math.floor(tunnel.y / 48);
      const tunnelColumns = Math.ceil(tunnel.width / 48);
      const tunnelRows = Math.ceil(tunnel.height / 48);
      for (let row = startRow; row < startRow + tunnelRows; row += 1) {
        for (let column = startColumn; column < startColumn + tunnelColumns; column += 1) {
          if (floor[row]?.[column] !== undefined) floor[row]![column] = 3;
        }
      }
    }

    // One culled Phaser tile layer keeps the full-size floor on a single atlas and avoids
    // allocating a giant offscreen canvas for every repeating zone texture.
    const map = this.scene.make.tilemap({ data: floor, tileWidth: 16, tileHeight: 16 });
    const tileset = map.addTilesetImage("tiny-factory", "tiny-factory", 16, 16, 0, 0);
    if (!tileset) throw new Error("Could not load the Tiny Factory warehouse tileset.");
    const layer = map.createLayer(0, tileset, 0, 0);
    if (!layer) throw new Error("Could not create the warehouse floor tile layer.");
    layer.setScale(3).setDepth(-12).setCullPadding(2, 2);
  }

  private drawBase(base: { x: number; y: number; width: number; height: number }, color: number, name: string, propFrame: number): void {
    const graphic = this.scene.add.graphics().setDepth(-8);
    graphic.fillStyle(0x382f3b, 0.3).fillRect(base.x + 24, base.y + 24, base.width, base.height);
    graphic.fillStyle(color, 0.23).fillRect(base.x, base.y, base.width, base.height);
    graphic.lineStyle(24, color, 0.88).strokeRect(base.x, base.y, base.width, base.height);
    graphic.lineStyle(10, 0xfff5dc, 0.82).strokeRect(base.x + 32, base.y + 32, base.width - 64, base.height - 64);
    graphic.fillStyle(color, 0.3).fillCircle(base.x + base.width / 2, base.y + base.height / 2, 144);
    graphic.lineStyle(18, 0xfff5dc, 0.88).strokeCircle(base.x + base.width / 2, base.y + base.height / 2, 144);
    this.scene.add.image(base.x + 96, base.y + 96, "tiny-factory", propFrame).setDisplaySize(144, 144).setDepth(4);
    this.scene.add
      .text(base.x + base.width / 2, base.y + base.height / 2, name, {
        color: "#ffffff",
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "72px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(-7);
  }

  private drawHqPole(point: Point, color: number): void {
    const art = this.scene.add.graphics().setDepth(9);
    art.fillStyle(0x382f3b, 0.22).fillEllipse(point.x + 5, point.y + 12, 78, 28);
    art.lineStyle(10, 0xfff5dc, 1).lineBetween(point.x, point.y + 6, point.x, point.y - 112);
    art.lineStyle(5, 0x665642, 1).lineBetween(point.x, point.y + 5, point.x, point.y - 112);
    art.fillStyle(0xfff5dc, 1).fillRoundedRect(point.x + 3, point.y - 106, 86, 50, 12);
    art.fillStyle(color, 1).fillRoundedRect(point.x + 9, point.y - 100, 74, 38, 9);
    art.fillStyle(0xfff5dc, 1).fillCircle(point.x + 46, point.y - 81, 8);
    art.fillStyle(0xf5bf60, 1).fillCircle(point.x, point.y - 114, 10);
    art.lineStyle(4, 0xfff5dc, 1).strokeCircle(point.x, point.y - 114, 10);
  }

  private drawWarehouseObstacles(): void {
    const cellSize = 48;
    const columns = ARENA_CONFIG.width / cellSize;
    const rows = ARENA_CONFIG.height / cellSize;
    const wallTiles = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
    const obstacleTiles = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
    const obstacleShadows = this.scene.add.graphics().setDepth(4);
    const wallDetails = this.scene.add.graphics().setDepth(6);

    for (const obstacle of ARENA_OBSTACLES) {
      const isWall = obstacle.id.startsWith("wall-");
      const frame = isWall ? 3 : obstacle.id.startsWith("rack-") ? 84
        : obstacle.id.includes("conveyor") || obstacle.id.includes("sorter") || obstacle.id.includes("line") ? 55
          : obstacle.id.includes("cabinet") || obstacle.id.includes("generator") ? 86 : 73;
      const tiles = isWall ? wallTiles : obstacleTiles;
      const startColumn = Math.floor(obstacle.x / cellSize);
      const startRow = Math.floor(obstacle.y / cellSize);
      const tileColumns = Math.ceil(obstacle.width / cellSize);
      const tileRows = Math.ceil(obstacle.height / cellSize);
      for (let row = startRow; row < startRow + tileRows; row += 1) {
        for (let column = startColumn; column < startColumn + tileColumns; column += 1) {
          if (tiles[row]?.[column] !== undefined) tiles[row]![column] = frame + 1;
        }
      }

      if (isWall) {
        wallDetails.fillStyle(0x352d3b, 0.24).fillRect(obstacle.x + 12, obstacle.y + 12, obstacle.width, obstacle.height);
        wallDetails.lineStyle(9, 0x342c3c, 0.96).strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        wallDetails.lineStyle(5, 0xe7cf91, 0.92);
        if (obstacle.width > obstacle.height) {
          wallDetails.lineBetween(obstacle.x + 8, obstacle.y + 15, obstacle.x + obstacle.width - 8, obstacle.y + 15);
          for (let x = obstacle.x + 192; x < obstacle.x + obstacle.width; x += 192) {
            wallDetails.lineBetween(x, obstacle.y + 8, x, obstacle.y + obstacle.height - 8);
          }
        } else {
          wallDetails.lineBetween(obstacle.x + 15, obstacle.y + 8, obstacle.x + 15, obstacle.y + obstacle.height - 8);
          for (let y = obstacle.y + 192; y < obstacle.y + obstacle.height; y += 192) {
            wallDetails.lineBetween(obstacle.x + 8, y, obstacle.x + obstacle.width - 8, y);
          }
        }
      } else {
        obstacleShadows.fillStyle(0x271f31, 0.2)
          .fillRect(obstacle.x + 18, obstacle.y + 18, obstacle.width, obstacle.height)
          .lineStyle(8, 0x2b2636, 0.3)
          .strokeRect(obstacle.x + 18, obstacle.y + 18, obstacle.width, obstacle.height);
      }
    }

    const createLayer = (data: number[][], depth: number, name: string): void => {
      const map = this.scene.make.tilemap({ data, tileWidth: 16, tileHeight: 16 });
      const tileset = map.addTilesetImage("tiny-factory", "tiny-factory", 16, 16, 0, 0);
      if (!tileset) throw new Error(`Could not create the ${name} tile set.`);
      const layer = map.createLayer(0, tileset, 0, 0);
      if (!layer) throw new Error(`Could not create the ${name} tile layer.`);
      layer.setScale(3).setDepth(depth).setCullPadding(2, 2);
    };
    createLayer(wallTiles, 5, "warehouse wall");
    createLayer(obstacleTiles, 5, "warehouse obstacle");
  }

  private drawWarehouseProp(prop: (typeof WAREHOUSE_PROPS)[number]): void {
    const sprite = this.scene.add.image(prop.x + prop.width / 2, prop.y + prop.height / 2, "tiny-factory", prop.frame)
      .setDisplaySize(prop.width, prop.height).setDepth(6);
    if (prop.rotation !== undefined) sprite.setAngle(prop.rotation);
    if (prop.tint !== undefined) sprite.setTint(prop.tint);
  }

  private drawGlassBarrier(barrier: (typeof TRANSPARENT_BARRIERS)[number]): void {
    const glass = this.scene.add.rectangle(barrier.x + barrier.width / 2, barrier.y + barrier.height / 2,
      barrier.width, barrier.height, 0x8ce5ee, 0.38).setDepth(7);
    glass.setStrokeStyle(10, 0xe7ffff, 0.88);
    const rails = this.scene.add.graphics().setDepth(8).lineStyle(5, 0xe7ffff, 0.6);
    if (barrier.width < barrier.height) {
      for (let y = barrier.y + 64; y < barrier.y + barrier.height; y += 96) rails.lineBetween(barrier.x, y, barrier.x + barrier.width, y);
    } else {
      for (let x = barrier.x + 64; x < barrier.x + barrier.width; x += 96) rails.lineBetween(x, barrier.y, x, barrier.y + barrier.height);
    }
  }

}
