import Phaser from "phaser";

import {
  ARENA_CONFIG,
  ARENA_OBSTACLES,
  MOVEMENT_CONFIG,
  PROTOTYPE_SPAWN,
  TEAM_BASES,
  hasLineOfSight,
  type Point,
  type PlayerSnapshot,
  type RoomSnapshot,
  type TeamId,
} from "@osmosis/shared";
import type { MultiplayerClient } from "../../net/MultiplayerClient";

interface RemotePlayer {
  root: Phaser.GameObjects.Container;
  avatar: Phaser.GameObjects.Image;
  target: Point;
  status: "ACTIVE" | "INACTIVE" | "DISCONNECTED";
}

interface FogTile {
  cover: Phaser.GameObjects.Rectangle;
  sample: Point;
}

export class ArenaScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerArt!: Phaser.GameObjects.Container;
  private playerAvatar!: Phaser.GameObjects.Image;
  private playerLabel!: Phaser.GameObjects.Container;
  private linkGraphics!: Phaser.GameObjects.Graphics;
  private cursors!: Record<"up" | "left" | "down" | "right", Phaser.Input.Keyboard.Key>;
  private fogTiles: FogTile[] = [];
  private lastFogPosition: Point = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  private readonly pickupSprites = new Map<string, Phaser.GameObjects.Container>();
  private currentSnapshot: RoomSnapshot | undefined;
  private authoritativePosition: Point | undefined;
  private selfTeamId: TeamId = "BLUE";
  private lastInputSentAt = 0;
  private inputSequence = 0;
  private readonly network: MultiplayerClient;

  constructor(network: MultiplayerClient) {
    super("arena");
    this.network = network;
  }

  preload(): void {
    this.load.image("astronaut", "/assets/characters/astronaut.png");
  }

  create(): void {
    this.physics.world.setBounds(0, 0, ARENA_CONFIG.width, ARENA_CONFIG.height);
    this.cameras.main.setBounds(0, 0, ARENA_CONFIG.width, ARENA_CONFIG.height);
    this.createTextures();
    this.drawArena();

    const walls = this.physics.add.staticGroup();
    for (const obstacle of ARENA_OBSTACLES) {
      const wall = walls
        .create(
          obstacle.x + obstacle.width / 2,
          obstacle.y + obstacle.height / 2,
          "container-wall",
        )
        .setDisplaySize(obstacle.width, obstacle.height)
        .refreshBody();
      wall.setData("obstacleId", obstacle.id);
      wall.setVisible(false);
      this.drawContainer(obstacle);
    }

    this.player = this.physics.add.sprite(PROTOTYPE_SPAWN.x, PROTOTYPE_SPAWN.y, "player-blue");
    this.player.setCircle(MOVEMENT_CONFIG.playerRadius, 6, 6);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(20);
    this.player.setVisible(false);
    this.physics.add.collider(this.player, walls);

    this.playerArt = this.createAstronaut(this.player.x, this.player.y, "BLUE", 20);
    this.playerAvatar = this.playerArt.getAt(2) as Phaser.GameObjects.Image;
    this.playerLabel = this.addPlayerLabel(this.player.x, this.player.y, "CONNECTING", "BLUE")
      .setData("followsPlayer", true);
    this.linkGraphics = this.add.graphics().setDepth(18);
    this.createFog();
    const unsubscribe = this.network.onSnapshot((snapshot) => this.applySnapshot(snapshot));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    this.cursors = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<"up" | "left" | "down" | "right", Phaser.Input.Keyboard.Key>;

    const keyboard = this.input.keyboard!;
    const startRaid = (event: KeyboardEvent) => {
      if (!event.repeat) this.network.sendCommand({ type: "interact", targetId: "enemy-base", active: true });
    };
    const stopRaid = () => this.network.sendCommand({ type: "interact", targetId: "enemy-base", active: false });
    const startLink = (event: KeyboardEvent) => {
      if (event.repeat || !this.currentSnapshot) return;
      const self = this.currentSnapshot.players.find((candidate) => candidate.id === this.currentSnapshot?.selfPlayerId);
      if (!self || self.status !== "ACTIVE") return;
      const teammate = this.currentSnapshot.players
        .filter((candidate) => candidate.teamId === self.teamId && candidate.id !== self.id && candidate.status === "ACTIVE")
        .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - self.x, candidate.y - self.y) }))
        .filter(({ distance, candidate }) => distance <= MOVEMENT_CONFIG.linkRadius && hasLineOfSight(self, candidate))
        .sort((left, right) => left.distance - right.distance)[0]?.candidate;
      if (teammate) this.network.sendCommand({ type: "linkStart", teammateId: teammate.id });
    };
    const stopLink = () => this.network.sendCommand({ type: "linkStop" });
    keyboard.on("keydown-E", startRaid);
    keyboard.on("keyup-E", stopRaid);
    keyboard.on("keydown-F", startLink);
    keyboard.on("keyup-F", stopLink);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.off("keydown-E", startRaid);
      keyboard.off("keyup-E", stopRaid);
      keyboard.off("keydown-F", startLink);
      keyboard.off("keyup-F", stopLink);
    });

    this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
    this.cameras.main.setDeadzone(90, 70);
    this.cameras.main.setZoom(1);
    this.cameras.main.fadeIn(350, 5, 11, 17);
  }

  override update(time: number, delta: number): void {
    const dx = (Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown)) as -1 | 0 | 1;
    const dy = (Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown)) as -1 | 0 | 1;
    const direction = new Phaser.Math.Vector2(
      dx,
      dy,
    ).normalize();

    this.player.setVelocity(
      direction.x * MOVEMENT_CONFIG.speed,
      direction.y * MOVEMENT_CONFIG.speed,
    );

    if (time - this.lastInputSentAt >= 50) {
      this.network.sendMove(dx, dy);
      this.lastInputSentAt = time;
    }

    if (this.authoritativePosition) {
      const correction = Math.min(1, delta / 110);
      this.player.x = Phaser.Math.Linear(this.player.x, this.authoritativePosition.x, correction);
      this.player.y = Phaser.Math.Linear(this.player.y, this.authoritativePosition.y, correction);
    }

    this.playerArt.setPosition(this.player.x, this.player.y);
    const moving = direction.lengthSq() > 0;
    this.playerAvatar.y = -8 + (moving ? Math.sin(time / 95) * 3 : Math.sin(time / 420) * 1.5);
    this.playerAvatar.setAngle(moving ? direction.x * 5 : 0);
    this.playerAvatar.setScale(moving ? 0.56 + Math.sin(time / 95) * 0.012 : 0.56);
    for (const remote of this.remotePlayers.values()) {
      const interpolation = Math.min(1, delta / 65);
      remote.root.x = Phaser.Math.Linear(remote.root.x, remote.target.x, interpolation);
      remote.root.y = Phaser.Math.Linear(remote.root.y, remote.target.y, interpolation);
      remote.avatar.y = -8 + Math.sin(time / 420 + remote.root.x / 120) * 1.5;
    }
    for (const [index, pickup] of [...this.pickupSprites.values()].entries()) {
      pickup.setScale(1 + Math.sin(time / 250 + index) * 0.08);
    }
    this.drawLinks();

    this.playerLabel.setPosition(this.player.x, this.player.y - 45);

    this.updateFog();
  }

  private applySnapshot(snapshot: RoomSnapshot): void {
    this.currentSnapshot = snapshot;
    const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
    if (!self) return;

    this.authoritativePosition = { x: self.x, y: self.y };
    this.playerArt.setAlpha(self.status === "DISCONNECTED" ? 0.35 : self.status === "INACTIVE" ? 0.6 : 1);
    this.playerLabel.setAlpha(self.status === "INACTIVE" ? 0.7 : 1);
    if (this.selfTeamId !== self.teamId) {
      this.selfTeamId = self.teamId;
      this.playerArt.destroy();
      this.playerArt = this.createAstronaut(this.player.x, this.player.y, self.teamId, 20);
      this.playerAvatar = this.playerArt.getAt(2) as Phaser.GameObjects.Image;
      this.playerLabel.destroy();
      this.playerLabel = this.addPlayerLabel(this.player.x, this.player.y, self.nickname, self.teamId);
    } else {
      const labelText = this.playerLabel.getAt(1);
      if (labelText instanceof Phaser.GameObjects.Text && labelText.text !== self.nickname) {
        this.playerLabel.destroy();
        this.playerLabel = this.addPlayerLabel(this.player.x, this.player.y, self.nickname, self.teamId);
      }
    }
    this.playerLabel.setData("followsPlayer", true);

    const visibleIds = new Set<string>([snapshot.selfPlayerId]);
    for (const player of snapshot.players) {
      if (player.id === snapshot.selfPlayerId) continue;
      visibleIds.add(player.id);
      this.updateRemotePlayer(player);
    }

    for (const [id, remote] of this.remotePlayers) {
      if (!visibleIds.has(id)) {
        remote.root.destroy(true);
        this.remotePlayers.delete(id);
      }
    }
    this.updatePickups(snapshot.pickups);
  }

  private updateRemotePlayer(player: PlayerSnapshot): void {
    let remote = this.remotePlayers.get(player.id);
    if (!remote) {
      const art = this.createAstronaut(0, 0, player.teamId, 0);
      const label = this.createNameTag(player.nickname, player.teamId).setPosition(0, -45);
      const root = this.add.container(player.x, player.y, [art, label]).setDepth(19);
      remote = { root, avatar: art.getAt(2) as Phaser.GameObjects.Image, target: { x: player.x, y: player.y }, status: player.status };
      this.remotePlayers.set(player.id, remote);
    }
    remote.target = { x: player.x, y: player.y };
    remote.status = player.status;
    remote.root.setAlpha(player.status === "DISCONNECTED" ? 0.35 : player.status === "INACTIVE" ? 0.6 : 1);
  }

  private updatePickups(pickups: RoomSnapshot["pickups"]): void {
    const remainingIds = new Set(pickups.map((pickup) => pickup.id));
    for (const [id, sprite] of this.pickupSprites) {
      if (remainingIds.has(id)) continue;
      sprite.destroy(true);
      this.pickupSprites.delete(id);
    }
    for (const pickup of pickups) {
      if (this.pickupSprites.has(pickup.id)) continue;
      const shadow = this.add.ellipse(0, 10, 30, 11, 0x315d68, 0.24);
      const star = this.add.star(0, 0, 5, 10, 19, 0xf5bf60).setStrokeStyle(3, 0xfff5d8, 1);
      const center = this.add.circle(0, 0, 5, 0xfff5d8);
      this.pickupSprites.set(pickup.id, this.add.container(pickup.x, pickup.y, [shadow, star, center]).setDepth(8));
    }
  }

  private drawLinks(): void {
    this.linkGraphics.clear();
    if (!this.currentSnapshot) return;
    this.linkGraphics.lineStyle(9, 0xffd783, 0.28);
    for (const player of this.currentSnapshot.players) {
      if (!player.linkedPlayerId || player.id > player.linkedPlayerId) continue;
      const teammate = this.currentSnapshot.players.find((candidate) => candidate.id === player.linkedPlayerId);
      if (teammate) this.linkGraphics.lineBetween(player.x, player.y, teammate.x, teammate.y);
    }
    this.linkGraphics.lineStyle(3, 0xfff5d8, 0.92);
    for (const player of this.currentSnapshot.players) {
      if (!player.linkedPlayerId || player.id > player.linkedPlayerId) continue;
      const teammate = this.currentSnapshot.players.find((candidate) => candidate.id === player.linkedPlayerId);
      if (teammate) this.linkGraphics.lineBetween(player.x, player.y, teammate.x, teammate.y);
    }
  }

  private createTextures(): void {
    const playerGraphics = this.make.graphics({ x: 0, y: 0 });
    playerGraphics.fillStyle(0xffffff).fillCircle(28, 28, 25);
    playerGraphics.generateTexture("player-blue", 56, 56);
    playerGraphics.destroy();

    const wallGraphics = this.make.graphics({ x: 0, y: 0 });
    wallGraphics.fillStyle(0xffffff).fillRect(0, 0, 64, 64);
    wallGraphics.generateTexture("container-wall", 64, 64);
    wallGraphics.destroy();
  }

  private drawArena(): void {
    const floor = this.add.graphics().setDepth(-10);
    floor.fillStyle(0xc9e2df).fillRect(0, 0, ARENA_CONFIG.width, ARENA_CONFIG.height);
    floor.lineStyle(2, 0xffffff, 0.27);
    for (let x = 0; x <= ARENA_CONFIG.width; x += 96) floor.lineBetween(x, 0, x, ARENA_CONFIG.height);
    for (let y = 0; y <= ARENA_CONFIG.height; y += 96) floor.lineBetween(0, y, ARENA_CONFIG.width, y);

    const floorDetails = this.add.graphics().setDepth(-9);
    floorDetails.lineStyle(8, 0x8fbab8, 0.3).strokeRoundedRect(320, 180, 2_160, 1_240, 50);
    floorDetails.lineStyle(3, 0xffffff, 0.42).strokeRoundedRect(338, 198, 2_124, 1_204, 42);
    floorDetails.lineStyle(4, 0xffffff, 0.42).lineBetween(1_400, 0, 1_400, ARENA_CONFIG.height);
    for (let y = 70; y < ARENA_CONFIG.height; y += 96) {
      floorDetails.fillStyle(0xffffff, 0.33).fillCircle(1_400, y, 5);
    }

    const zones = this.add.graphics().setDepth(-9);
    for (const zone of [
      { x: 390, y: 410, width: 520, height: 150, color: 0x71b8c5 },
      { x: 1_890, y: 410, width: 520, height: 150, color: 0xeaa17e },
      { x: 390, y: 1_040, width: 520, height: 150, color: 0xeaa17e },
      { x: 1_890, y: 1_040, width: 520, height: 150, color: 0x71b8c5 },
      { x: 1_080, y: 540, width: 640, height: 520, color: 0xf0cf86 },
    ]) {
      zones.fillStyle(zone.color, 0.14).fillRoundedRect(zone.x, zone.y, zone.width, zone.height, 34);
      zones.lineStyle(4, 0xffffff, 0.34).strokeRoundedRect(zone.x, zone.y, zone.width, zone.height, 34);
    }
    const lanes = this.add.graphics().setDepth(-9);
    lanes.lineStyle(7, 0xf8f2d7, 0.82);
    lanes.strokeRoundedRect(1_070, 535, 660, 530, 42);
    lanes.lineStyle(3, 0xffffff, 0.72);
    lanes.lineBetween(950, 800, 1_070, 800);
    lanes.lineBetween(1_730, 800, 1_850, 800);
    this.add.text(650, 485, "NORTH CARGO BAY", { color: "#f8fff0", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.68).setDepth(-7);
    this.add.text(2_150, 485, "NORTH CARGO BAY", { color: "#f8fff0", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.68).setDepth(-7);
    this.add.text(1_400, 585, "CROSSDOCK", { color: "#fff9e8", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.78).setDepth(-7);
    this.add.text(650, 1_115, "SOUTH SORTING BAY", { color: "#f8fff0", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.68).setDepth(-7);
    this.add.text(2_150, 1_115, "SOUTH SORTING BAY", { color: "#f8fff0", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setAlpha(0.68).setDepth(-7);

    this.drawBase(TEAM_BASES.BLUE, 0x428fd4, "BLUE HQ");
    this.drawBase(TEAM_BASES.RED, 0xee6e70, "RED HQ");

    const border = this.add.graphics().setDepth(30);
    border.lineStyle(14, 0x537e81, 1).strokeRect(7, 7, ARENA_CONFIG.width - 14, ARENA_CONFIG.height - 14);
    border.lineStyle(4, 0xf9f5df, 0.8).strokeRect(20, 20, ARENA_CONFIG.width - 40, ARENA_CONFIG.height - 40);
  }

  private drawBase(base: { x: number; y: number; width: number; height: number }, color: number, name: string): void {
    const graphic = this.add.graphics().setDepth(-8);
    graphic.fillStyle(0x568689, 0.22).fillRoundedRect(base.x + 8, base.y + 12, base.width, base.height, 34);
    graphic.fillStyle(color, 0.24).fillRoundedRect(base.x, base.y, base.width, base.height, 34);
    graphic.lineStyle(6, color, 0.85).strokeRoundedRect(base.x, base.y, base.width, base.height, 34);
    graphic.lineStyle(3, 0xffffff, 0.72).strokeRoundedRect(base.x + 13, base.y + 13, base.width - 26, base.height - 26, 24);
    graphic.fillStyle(color, 0.38).fillCircle(base.x + base.width / 2, base.y + base.height / 2, 69);
    graphic.lineStyle(6, 0xffffff, 0.8).strokeCircle(base.x + base.width / 2, base.y + base.height / 2, 69);
    this.add
      .text(base.x + base.width / 2, base.y + base.height / 2, name, {
        color: "#ffffff",
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(-7);
  }

  private drawContainer(obstacle: { id: string; x: number; y: number; width: number; height: number }): void {
    const { x, y, width, height } = obstacle;
    const blue = obstacle.id.includes("west") || obstacle.id === "center-south";
    const body = blue ? 0x4c98b9 : 0xe88770;
    const light = blue ? 0x83c7d1 : 0xf4b29a;
    const dark = blue ? 0x276783 : 0xa64c50;
    const graphic = this.add.graphics().setDepth(5);
    graphic.fillStyle(0x3e696e, 0.22).fillRoundedRect(x + 10, y + 13, width, height, 18);
    graphic.fillStyle(dark).fillRoundedRect(x, y, width, height, 18);
    graphic.fillStyle(body).fillRoundedRect(x + 5, y + 5, width - 10, height - 13, 14);
    graphic.fillStyle(light, 0.82).fillRoundedRect(x + 13, y + 10, width - 26, 16, 6);
    graphic.lineStyle(4, 0x315768, 0.7).strokeRoundedRect(x + 2, y + 2, width - 4, height - 4, 16);
    const horizontal = width > height;
    const length = horizontal ? width : height;
    const cross = horizontal ? height : width;
    const start = horizontal ? x : y;
    for (let distance = 31; distance < length - 24; distance += 30) {
      const at = start + distance;
      graphic.lineStyle(3, dark, 0.55);
      if (horizontal) graphic.lineBetween(at, y + 32, at, y + cross - 20);
      else graphic.lineBetween(x + 18, at, x + cross - 18, at);
    }
    for (const cornerX of [x + 18, x + width - 18]) {
      for (const cornerY of [y + 18, y + height - 18]) {
        graphic.fillStyle(0xffe5a5).fillCircle(cornerX, cornerY, 5);
      }
    }
    this.add.text(x + width / 2, y + height / 2, `OS-${obstacle.id.toUpperCase().replaceAll("-", "")}`, {
      color: "#fef9e8", fontFamily: "Trebuchet MS, sans-serif", fontSize: "13px", fontStyle: "bold",
    }).setOrigin(0.5).setAlpha(0.7).setDepth(6);
  }

  private createAstronaut(x: number, y: number, teamId: TeamId, depth: number): Phaser.GameObjects.Container {
    const teamColor = teamId === "BLUE" ? 0x348ede : 0xf36572;
    const shadow = this.add.ellipse(0, 18, 54, 18, 0x345d62, 0.32);
    const ring = this.add.ellipse(0, 14, 65, 31, teamColor, 0.75).setStrokeStyle(3, 0xffffff, 0.8);
    const avatar = this.add.image(0, -8, "astronaut").setScale(0.56);
    const badge = this.add.circle(22, 8, 9, teamColor).setStrokeStyle(2, 0xffffff);
    return this.add.container(x, y, [shadow, ring, avatar, badge]).setDepth(depth);
  }

  private addPlayerLabel(x: number, y: number, name: string, teamId: TeamId): Phaser.GameObjects.Container {
    return this.createNameTag(name, teamId).setPosition(x, y - 45).setDepth(21);
  }

  private createNameTag(name: string, teamId: TeamId): Phaser.GameObjects.Container {
    const color = teamId === "BLUE" ? 0x2a8ed2 : 0xea6b73;
    const text = this.add
      .text(0, 0, name, {
        color: "#ffffff",
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "12px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const background = this.add.rectangle(0, 0, text.width + 20, 24, color, 1);
    background.setStrokeStyle(2, 0xffffff, 0.9);
    return this.add.container(0, 0, [background, text]);
  }

  private createFog(): void {
    const tileSize = 64;
    for (let y = 0; y < ARENA_CONFIG.height; y += tileSize) {
      for (let x = 0; x < ARENA_CONFIG.width; x += tileSize) {
        this.fogTiles.push({
          cover: this.add
            .rectangle(
              x + tileSize / 2,
              y + tileSize / 2,
              tileSize + 1,
              tileSize + 1,
              0x315d68,
              0.88,
            )
            .setDepth(40),
          sample: {
            x: Math.min(x + tileSize / 2, ARENA_CONFIG.width),
            y: Math.min(y + tileSize / 2, ARENA_CONFIG.height),
          },
        });
      }
    }
    this.updateFog(true);
  }

  private updateFog(force = false): void {
    const playerPosition = { x: this.player.x, y: this.player.y };
    if (
      !force &&
      Math.hypot(
        playerPosition.x - this.lastFogPosition.x,
        playerPosition.y - this.lastFogPosition.y,
      ) < 4
    ) {
      return;
    }

    this.lastFogPosition = playerPosition;
    for (const { cover, sample } of this.fogTiles) {
      const distance = Math.hypot(sample.x - playerPosition.x, sample.y - playerPosition.y);
      const isVisible =
        distance <= MOVEMENT_CONFIG.viewRadius && hasLineOfSight(playerPosition, sample);
      cover.setVisible(!isVisible);
    }
  }

}
