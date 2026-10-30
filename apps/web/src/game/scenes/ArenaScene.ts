import Phaser from "phaser";

import {
  ARENA_CONFIG,
  GAME_RULES,
  MOVEMENT_CONFIG,
  PROTOTYPE_SPAWN,
  TEAM_HQ_POLES,
  type GameEvent,
  hasLineOfSight,
  type PlayerSnapshot,
  type RoomSnapshot,
  type TeamId,
} from "@osmosis/shared";
import type { MultiplayerClient } from "../../net/MultiplayerClient";
import { MovementPredictor } from "../net/MovementPredictor";
import { PositionBuffer } from "../net/PositionBuffer";
import { WarehouseRenderer } from "../render/WarehouseRenderer";
import { FogOfWarRenderer } from "../render/FogOfWarRenderer";
import { CrewmateRenderer } from "../render/CrewmateRenderer";
import { MovementTrace } from "../net/MovementTrace";
import { FeedbackRenderer } from "../render/FeedbackRenderer";
import { HelpPingRenderer, type HelpPingMarkerDebugState } from "../render/HelpPingRenderer";

interface RemotePlayer {
  root: Phaser.GameObjects.Container;
  avatar: Phaser.GameObjects.Image;
  poleIndicator: Phaser.GameObjects.Text;
  positions: PositionBuffer;
  status: "ACTIVE" | "INACTIVE" | "ELIMINATED" | "DISCONNECTED";
}

interface SpectatorDebugProbe {
  status: PlayerSnapshot["status"] | undefined;
  targetId: string | undefined;
  followsTarget: boolean;
  eliminatedAvatarVisible: boolean;
  targetAvatarVisible: boolean;
  target: { x: number; y: number } | undefined;
  cameraCenter: { x: number; y: number };
}

interface HelpPingDebugProbe {
  snapshotPlayerIds: string[];
  markers: HelpPingMarkerDebugState[];
  serverTime: number | undefined;
}

declare global {
  interface Window {
    __osmosisSpectatorDebug?: () => SpectatorDebugProbe;
    __osmosisHelpPingDebug?: () => HelpPingDebugProbe;
  }
}

export class ArenaScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private readonly movement = new MovementPredictor(PROTOTYPE_SPAWN);
  private readonly warehouseRenderer = new WarehouseRenderer(this);
  private readonly fogRenderer = new FogOfWarRenderer(this);
  private readonly crewmateRenderer = new CrewmateRenderer(this);
  private readonly movementTrace = new MovementTrace();
  private readonly helpPingRenderer = new HelpPingRenderer(this);
  private feedbackRenderer!: FeedbackRenderer;
  private playerArt!: Phaser.GameObjects.Container;
  private playerAvatar!: Phaser.GameObjects.Image;
  private playerLabel!: Phaser.GameObjects.Container;
  private linkGraphics!: Phaser.GameObjects.Graphics;
  private cursors!: Record<"up" | "left" | "down" | "right", Phaser.Input.Keyboard.Key>;
  private linkKey!: Phaser.Input.Keyboard.Key;
  private lastLinkAttemptAt = Number.NEGATIVE_INFINITY;
  private pendingLinkTargetId: string | undefined;
  private pendingLinkAt = Number.NEGATIVE_INFINITY;
  private linkHoldStartedAt: number | undefined;
  private didShowNoTeammateToast = false;
  private pendingManualUnlink = false;
  private linkToast!: Phaser.GameObjects.Container;
  private linkToastBackground!: Phaser.GameObjects.Rectangle;
  private linkToastText!: Phaser.GameObjects.Text;
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  private readonly pickupSprites = new Map<string, Phaser.GameObjects.Container>();
  private readonly seenGameEventIds = new Set<string>();
  private readonly gameEventOrder: string[] = [];
  private currentSnapshot: RoomSnapshot | undefined;
  private selfTeamId: TeamId = "BLUE";
  private cameraFollowTarget: Phaser.GameObjects.GameObject | undefined;
  private readonly network: MultiplayerClient;

  constructor(network: MultiplayerClient) {
    super("arena");
    this.network = network;
  }

  preload(): void {
    this.load.image("astronaut", "/assets/characters/astronaut.png");
    this.load.image("vfx-star", "/assets/vfx/kenney-particle-pack/star_01.png");
    this.load.image("vfx-flare", "/assets/vfx/kenney-particle-pack/flare_01.png");
    this.load.image("vfx-smoke", "/assets/vfx/kenney-particle-pack/smoke_03.png");
    this.load.spritesheet("tiny-factory", "/assets/warehouse/kenney-tiny-factory/Tilemap/tilemap_packed.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, ARENA_CONFIG.width, ARENA_CONFIG.height);
    this.warehouseRenderer.draw();

    this.player = this.add.sprite(PROTOTYPE_SPAWN.x, PROTOTYPE_SPAWN.y, "astronaut")
      .setDepth(20).setVisible(false);

    this.playerArt = this.crewmateRenderer.createAstronaut(this.player.x, this.player.y, "BLUE", 20);
    this.playerAvatar = this.playerArt.getAt(2) as Phaser.GameObjects.Image;
    this.playerLabel = this.crewmateRenderer.addPlayerLabel(this.player.x, this.player.y, "CONNECTING", "BLUE")
      .setData("followsPlayer", true);
    this.linkGraphics = this.add.graphics().setDepth(18);
    this.feedbackRenderer = new FeedbackRenderer(this, (playerId) => this.avatarFor(playerId));
    this.createLinkToast();
    this.fogRenderer.create(PROTOTYPE_SPAWN);
    const unsubscribe = this.network.onSnapshot((snapshot) => this.applySnapshot(snapshot));
    this.onShutdownOrDestroy(unsubscribe);
    const unsubscribeEvents = this.network.onGameEvent((event) => this.applyGameEvent(event));
    this.onShutdownOrDestroy(() => {
      unsubscribeEvents();
      this.feedbackRenderer.destroy();
      this.helpPingRenderer.destroy();
      this.seenGameEventIds.clear();
      this.gameEventOrder.length = 0;
    });

    this.cursors = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<"up" | "left" | "down" | "right", Phaser.Input.Keyboard.Key>;

    const keyboard = this.input.keyboard!;
    this.linkKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    const startRaid = (event: KeyboardEvent) => {
      if (!event.repeat) this.network.sendCommand({ type: "interact", targetId: "enemy-base", active: true });
    };
    const stopRaid = () => this.network.sendCommand({ type: "interact", targetId: "enemy-base", active: false });
    const sendHelpPing = (event: KeyboardEvent) => {
      if (!event.repeat) this.network.sendCommand({ type: "ping" });
    };
    const stopLink = () => {
      this.linkHoldStartedAt = undefined;
      this.didShowNoTeammateToast = false;
      const self = this.currentSnapshot?.players.find((player) => player.id === this.currentSnapshot?.selfPlayerId);
      this.pendingManualUnlink = Boolean(self?.linkedPlayerId);
      this.pendingLinkTargetId = undefined;
      this.network.sendCommand({ type: "linkStop" });
    };
    keyboard.on("keydown-E", startRaid);
    keyboard.on("keyup-E", stopRaid);
    keyboard.on("keyup-F", stopLink);
    keyboard.on("keydown-G", sendHelpPing);
    this.onShutdownOrDestroy(() => {
      keyboard.off("keydown-E", startRaid);
      keyboard.off("keyup-E", stopRaid);
      keyboard.off("keyup-F", stopLink);
      keyboard.off("keydown-G", sendHelpPing);
      keyboard.removeKey(this.linkKey);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.positionLinkToast, this);
    });

    this.cameras.main.startFollow(this.player, true, 0.16, 0.16);
    this.cameraFollowTarget = this.player;
    this.cameras.main.setDeadzone(90, 70);
    this.cameras.main.setZoom(1);

    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("spectatorDebug") === "1") {
      const probe = (): SpectatorDebugProbe => {
        const self = this.currentSnapshot?.players.find((candidate) => candidate.id === this.currentSnapshot?.selfPlayerId);
        const targetId = this.currentSnapshot?.spectatorTargetId;
        const target = targetId ? this.remotePlayers.get(targetId) : undefined;
        return {
          status: self?.status,
          targetId,
          followsTarget: Boolean(target && this.cameraFollowTarget === target.root),
          eliminatedAvatarVisible: this.playerArt.visible,
          targetAvatarVisible: Boolean(target?.root.visible),
          target: target ? { x: target.root.x, y: target.root.y } : undefined,
          cameraCenter: { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y },
        };
      };
      window.__osmosisSpectatorDebug = probe;
      this.onShutdownOrDestroy(() => {
        if (window.__osmosisSpectatorDebug === probe) delete window.__osmosisSpectatorDebug;
      });
    }

    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("helpPingDebug") === "1") {
      const probe = (): HelpPingDebugProbe => ({
        snapshotPlayerIds: this.currentSnapshot?.helpPings.map((ping) => ping.playerId) ?? [],
        markers: this.helpPingRenderer.debugState(),
        serverTime: this.currentSnapshot?.serverTime,
      });
      window.__osmosisHelpPingDebug = probe;
      this.onShutdownOrDestroy(() => {
        if (window.__osmosisHelpPingDebug === probe) delete window.__osmosisHelpPingDebug;
      });
    }
  }

  override update(time: number, delta: number): void {
    const self = this.currentSnapshot?.players.find((player) => player.id === this.currentSnapshot?.selfPlayerId);
    const active = self?.status === "ACTIVE";
    const canMove = (active || self?.status === "INACTIVE") && !(self?.frozenSecondsRemaining && self.frozenSecondsRemaining > 0);
    const dx = canMove ? (Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown)) as -1 | 0 | 1 : 0;
    const dy = canMove ? (Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown)) as -1 | 0 | 1 : 0;
    const direction = new Phaser.Math.Vector2(dx, dy).normalize();
    if (canMove) {
      this.movement.advance(delta, { dx, dy }, (input) => {
        const sequence = this.network.sendMove(input.dx, input.dy);
        this.movementTrace.input(sequence, input);
        return sequence;
      }, this.poleBlockers(self));
    } else if (self) {
      this.movement.snap({ x: self.x, y: self.y });
      this.player.setPosition(self.x, self.y);
    }

    if (active && this.linkKey.isDown && time - this.lastLinkAttemptAt >= 100) {
      this.lastLinkAttemptAt = time;
      this.tryStartLink(time);
    }
    if (active && this.linkKey.isDown) {
      this.linkHoldStartedAt ??= time;
      if (!self?.linkedPlayerId && !this.pendingLinkTargetId && !this.didShowNoTeammateToast &&
        time - this.linkHoldStartedAt >= 2_000) {
        const message = this.currentSnapshot?.matchSettings.teamSize === 1
          ? "No teammate available in this 1v1 match"
          : "No available teammate in sight";
        this.showLinkToast(message, "warning");
        this.didShowNoTeammateToast = true;
      }
    }

    const renderPosition = this.movement.render(delta);
    if (canMove) this.player.setPosition(renderPosition.x, renderPosition.y);
    this.movementTrace.frame(delta, self, this.currentSnapshot, this.movement.simulationPosition, renderPosition);
    this.playerArt.setPosition(this.player.x, this.player.y);
    this.playerArt.setVisible(self?.status !== "ELIMINATED");
    this.playerLabel.setVisible(self?.status !== "ELIMINATED");
    const moving = Boolean(canMove) && direction.lengthSq() > 0;
    this.playerAvatar.y = -8 + (moving ? Math.sin(time / 95) * 3 : Math.sin(time / 420) * 1.5);
    this.playerAvatar.setAngle(moving ? direction.x * 5 : 0);
    this.playerAvatar.setScale(moving ? 0.56 + Math.sin(time / 95) * 0.012 : 0.56);
    for (const remote of this.remotePlayers.values()) {
      const interpolated = remote.positions.sample(performance.now());
      if (interpolated) remote.root.setPosition(interpolated.x, interpolated.y);
      remote.avatar.y = -8 + Math.sin(time / 420 + remote.root.x / 120) * 1.5;
    }
    for (const [index, pickup] of [...this.pickupSprites.values()].entries()) {
      pickup.setScale(1 + Math.sin(time / 250 + index) * 0.08);
    }
    this.drawLinks();

    if (this.currentSnapshot) {
      const positions = new Map<string, { x: number; y: number }>();
      if (self) positions.set(self.id, { x: this.player.x, y: this.player.y });
      for (const [playerId, remote] of this.remotePlayers) {
        positions.set(playerId, { x: remote.root.x, y: remote.root.y });
      }
      this.helpPingRenderer.update(this.currentSnapshot, positions, time);
    }

    this.playerLabel.setPosition(this.player.x, this.player.y - 45);

    const spectatorTarget = this.currentSnapshot?.spectatorTargetId
      ? this.remotePlayers.get(this.currentSnapshot.spectatorTargetId)
      : undefined;
    const viewPosition = spectatorTarget?.root ?? this.player;
    this.fogRenderer.update(time, viewPosition);
  }

  private poleBlockers(self: NonNullable<RoomSnapshot["players"][number]> | undefined): Array<{ x: number; y: number; radius: number }> {
    if (!self) return [];
    const holder = this.currentSnapshot?.players.find((player) => player.teamId === self.teamId && player.poleHolder && player.id !== self.id);
    return holder ? [{ ...TEAM_HQ_POLES[self.teamId], radius: GAME_RULES.hqPoleTouchRadius }] : [];
  }

  private applySnapshot(snapshot: RoomSnapshot): void {
    const previousSelf = this.currentSnapshot?.players.find((player) => player.id === this.currentSnapshot?.selfPlayerId);
    this.currentSnapshot = snapshot;
    const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
    if (!self) return;
    if (!previousSelf?.linkedPlayerId && self.linkedPlayerId) {
      const teammate = snapshot.players.find((player) => player.id === self.linkedPlayerId);
      this.pendingLinkTargetId = undefined;
      this.didShowNoTeammateToast = false;
      this.showLinkToast(teammate ? `Linked with ${teammate.nickname}` : "Linked successfully", "success");
    } else if (previousSelf?.linkedPlayerId && !self.linkedPlayerId) {
      this.pendingLinkTargetId = undefined;
      this.showLinkToast(this.pendingManualUnlink ? "Unlinked successfully" : "Link ended", this.pendingManualUnlink ? "success" : "warning");
      this.pendingManualUnlink = false;
    }
    if (self.linkedPlayerId) this.pendingLinkTargetId = undefined;

    this.movementTrace.snapshot(snapshot, self, this.movement.simulationPosition);
    const canMove = (self.status === "ACTIVE" || self.status === "INACTIVE") && !(self.frozenSecondsRemaining && self.frozenSecondsRemaining > 0);
    if (canMove) {
      this.movement.reconcile({ x: self.x, y: self.y }, self.acknowledgedInputSeq ?? -1, this.poleBlockers(self));
      const renderPosition = this.movement.render(0);
      this.player.setPosition(renderPosition.x, renderPosition.y);
    } else {
      this.movement.snap({ x: self.x, y: self.y });
      this.player.setPosition(self.x, self.y);
    }
    this.playerArt.setAlpha(self.status === "INACTIVE" ? 0.6 : 1);
    this.playerLabel.setAlpha(self.status === "INACTIVE" ? 0.7 : 1);
    if (this.selfTeamId !== self.teamId) {
      this.selfTeamId = self.teamId;
      this.playerArt.destroy();
      this.playerArt = this.crewmateRenderer.createAstronaut(this.player.x, this.player.y, self.teamId, 20);
      this.playerAvatar = this.playerArt.getAt(2) as Phaser.GameObjects.Image;
      this.playerLabel.destroy();
      this.playerLabel = this.crewmateRenderer.addPlayerLabel(this.player.x, this.player.y, self.nickname, self.teamId);
    } else {
      const labelText = this.playerLabel.getAt(1);
      if (labelText instanceof Phaser.GameObjects.Text && labelText.text !== self.nickname) {
        this.playerLabel.destroy();
        this.playerLabel = this.crewmateRenderer.addPlayerLabel(this.player.x, this.player.y, self.nickname, self.teamId);
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
    this.crewmateRenderer.updatePickups(this.pickupSprites, snapshot.pickups);
    this.playerArt.setVisible(self.status !== "ELIMINATED");
    this.playerLabel.setVisible(self.status !== "ELIMINATED");
    const localPoleIndicator = this.playerArt.getAt(4);
    if (localPoleIndicator instanceof Phaser.GameObjects.Text) localPoleIndicator.setVisible(self.poleHolder ?? false);
    const target = snapshot.spectatorTargetId ? this.remotePlayers.get(snapshot.spectatorTargetId)?.root : undefined;
    const nextFollowTarget = self.status === "ELIMINATED" ? target ?? this.player : this.player;
    if (this.cameraFollowTarget !== nextFollowTarget) {
      this.cameraFollowTarget = nextFollowTarget;
      this.cameras.main.startFollow(nextFollowTarget, true, 0.16, 0.16);
    }
  }

  private applyGameEvent(event: GameEvent): void {
    if (this.seenGameEventIds.has(event.eventId)) return;
    this.seenGameEventIds.add(event.eventId);
    this.gameEventOrder.push(event.eventId);
    if (this.gameEventOrder.length > 256) {
      const oldest = this.gameEventOrder.shift();
      if (oldest) this.seenGameEventIds.delete(oldest);
    }
    this.feedbackRenderer.render(event);
  }

  private avatarFor(playerId: string): Phaser.GameObjects.Container | undefined {
    if (this.currentSnapshot?.selfPlayerId === playerId) return this.playerArt;
    return this.remotePlayers.get(playerId)?.root;
  }

  private updateRemotePlayer(player: PlayerSnapshot): void {
    let remote = this.remotePlayers.get(player.id);
    if (!remote) {
      const art = this.crewmateRenderer.createAstronaut(0, 0, player.teamId, 0);
      const label = this.crewmateRenderer.createNameTag(player.nickname, player.teamId).setPosition(0, -45);
      const poleIndicator = art.getAt(4) as Phaser.GameObjects.Text;
      const root = this.add.container(player.x, player.y, [art, label]).setDepth(19);
      remote = { root, avatar: art.getAt(2) as Phaser.GameObjects.Image, poleIndicator, positions: new PositionBuffer(), status: player.status };
      this.remotePlayers.set(player.id, remote);
    }
    if (remote.status !== player.status) remote.positions.clear();
    remote.positions.push({ x: player.x, y: player.y }, performance.now());
    remote.status = player.status;
    remote.poleIndicator.setVisible(player.poleHolder ?? false);
    remote.root.setAlpha(player.status === "DISCONNECTED" ? 0.35 : player.status === "INACTIVE" ? 0.6 : player.status === "ELIMINATED" ? 0.42 : 1);
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

  private tryStartLink(time: number): void {
    const snapshot = this.currentSnapshot;
    if (!snapshot) return;
    const self = snapshot.players.find((candidate) => candidate.id === snapshot.selfPlayerId);
    if (!self || self.status !== "ACTIVE" || self.linkedPlayerId) return;
    if (this.pendingLinkTargetId && time - this.pendingLinkAt < 500) return;
    this.pendingLinkTargetId = undefined;

    const teammate = snapshot.players
      .filter((candidate) => candidate.teamId === self.teamId && candidate.id !== self.id && candidate.status === "ACTIVE" && !candidate.linkedPlayerId)
      .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - self.x, candidate.y - self.y) }))
      .filter(({ distance, candidate }) => distance <= MOVEMENT_CONFIG.linkRadius && hasLineOfSight(self, candidate))
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    if (!teammate) return;
    this.pendingLinkTargetId = teammate.id;
    this.pendingLinkAt = time;
    this.network.sendCommand({ type: "linkStart", teammateId: teammate.id });
  }

  private createLinkToast(): void {
    this.linkToastBackground = this.add.rectangle(0, 0, 260, 48, 0xfff7e8, 1).setStrokeStyle(3, 0x58b995);
    this.linkToastText = this.add.text(0, 0, "", {
      color: "#315d68",
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "16px",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.linkToast = this.add.container(0, 0, [this.linkToastBackground, this.linkToastText])
      .setScrollFactor(0).setDepth(100).setVisible(false);
    this.positionLinkToast();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.positionLinkToast, this);
  }

  private positionLinkToast(): void {
    this.linkToast?.setPosition(this.scale.width / 2, 150);
  }

  private onShutdownOrDestroy(cleanup: () => void): void {
    let cleaned = false;
    const dispose = () => {
      if (cleaned) return;
      cleaned = true;
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, dispose);
      this.events.off(Phaser.Scenes.Events.DESTROY, dispose);
      cleanup();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, dispose);
    this.events.once(Phaser.Scenes.Events.DESTROY, dispose);
  }

  private showLinkToast(message: string, tone: "success" | "warning"): void {
    this.linkToastText.setText(message);
    this.linkToastBackground.setSize(Math.max(260, this.linkToastText.width + 40), 48);
    this.linkToastBackground.setStrokeStyle(3, tone === "success" ? 0x58b995 : 0xe99a57);
    this.linkToast.setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.linkToast);
    this.tweens.add({
      targets: this.linkToast,
      alpha: 0,
      delay: 1_850,
      duration: 250,
      onComplete: () => this.linkToast.setVisible(false),
    });
  }

}
