import Phaser from "phaser";
import type { RoomSnapshot } from "@osmosis/shared";

interface Position {
  x: number;
  y: number;
}

export interface HelpPingMarkerDebugState {
  playerId: string;
  x: number;
  y: number;
  visible: boolean;
}

export class HelpPingRenderer {
  private readonly markers = new Map<string, Phaser.GameObjects.Container>();

  constructor(private readonly scene: Phaser.Scene) {}

  update(snapshot: RoomSnapshot, positions: ReadonlyMap<string, Position>, time: number): void {
    const activeIds = new Set(snapshot.helpPings.map((ping) => ping.playerId));
    for (const [playerId, marker] of this.markers) {
      if (activeIds.has(playerId)) continue;
      marker.destroy(true);
      this.markers.delete(playerId);
    }

    for (const ping of snapshot.helpPings) {
      const position = positions.get(ping.playerId);
      if (!position) continue;
      let marker = this.markers.get(ping.playerId);
      if (!marker) {
        marker = this.createMarker(ping.playerId);
        this.markers.set(ping.playerId, marker);
      }
      marker.setPosition(position.x, position.y - 88);
      marker.setScale(1 + Math.sin(time / 110) * 0.045);
      marker.setAlpha(Math.min(1, ping.remainingMs / 250));
    }
  }

  debugState(): HelpPingMarkerDebugState[] {
    return [...this.markers].map(([playerId, marker]) => ({
      playerId,
      x: marker.x,
      y: marker.y,
      visible: marker.visible && marker.alpha > 0,
    }));
  }

  destroy(): void {
    for (const marker of this.markers.values()) marker.destroy(true);
    this.markers.clear();
  }

  private createMarker(playerId: string): Phaser.GameObjects.Container {
    const bubble = this.scene.add.graphics();
    bubble.fillStyle(0xd97c56, 1);
    bubble.fillRoundedRect(-38, -15, 76, 30, 13);
    bubble.lineStyle(3, 0xfff5d8, 1);
    bubble.strokeRoundedRect(-38, -15, 76, 30, 13);
    bubble.fillStyle(0xd97c56, 1);
    bubble.fillTriangle(-8, 12, 8, 12, 0, 22);
    bubble.lineStyle(2, 0xfff5d8, 1);
    bubble.lineBetween(-7, 13, 0, 21);
    bubble.lineBetween(7, 13, 0, 21);
    const text = this.scene.add.text(0, -1, "HELP!", {
      color: "#fffaf0",
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#91523f",
      strokeThickness: 2,
    }).setOrigin(0.5);
    return this.scene.add.container(0, 0, [bubble, text])
      .setDepth(45)
      .setData("helpPingerId", playerId);
  }
}
