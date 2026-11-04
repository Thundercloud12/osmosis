import Phaser from "phaser";
import type { TeamId, RoomSnapshot } from "@osmosis/shared";

export class CrewmateRenderer {
  constructor(private readonly scene: Phaser.Scene) {}

  createAstronaut(x: number, y: number, teamId: TeamId, depth: number): Phaser.GameObjects.Container {
    const teamColor = teamId === "BLUE" ? 0x348ede : 0xf36572;
    const shadow = this.scene.add.ellipse(0, 18, 54, 18, 0x345d62, 0.32);
    const ring = this.scene.add.ellipse(0, 14, 65, 31, teamColor, 0.75).setStrokeStyle(3, 0xffffff, 0.8);
    const avatar = this.scene.add.image(0, -8, "astronaut").setScale(0.56);
    const badge = this.scene.add.circle(22, 8, 9, teamColor).setStrokeStyle(2, 0xffffff);
    const poleIndicator = this.scene.add.text(0, -63, "⚑ POLE", {
      color: "#fff5d8", fontFamily: "Trebuchet MS, sans-serif", fontSize: "16px", fontStyle: "bold",
      stroke: "#315d68", strokeThickness: 5,
    }).setOrigin(0.5).setVisible(false);
    return this.scene.add.container(x, y, [shadow, ring, avatar, badge, poleIndicator]).setDepth(depth);
  }

  addPlayerLabel(x: number, y: number, name: string, teamId: TeamId): Phaser.GameObjects.Container {
    return this.createNameTag(name, teamId).setPosition(x, y - 45).setDepth(21);
  }

  createNameTag(name: string, teamId: TeamId): Phaser.GameObjects.Container {
    const color = teamId === "BLUE" ? 0x2a8ed2 : 0xea6b73;
    const text = this.scene.add.text(0, 0, name, {
      color: "#ffffff", fontFamily: "Trebuchet MS, sans-serif", fontSize: "12px", fontStyle: "bold",
    }).setOrigin(0.5);
    const background = this.scene.add.rectangle(0, 0, text.width + 20, 24, color, 1);
    background.setStrokeStyle(2, 0xffffff, 0.9);
    return this.scene.add.container(0, 0, [background, text]);
  }

  updatePickups(sprites: Map<string, Phaser.GameObjects.Container>, pickups: RoomSnapshot["pickups"]): void {
    const remainingIds = new Set(pickups.map((pickup) => pickup.id));
    for (const [id, sprite] of sprites) {
      if (remainingIds.has(id)) continue;
      sprite.destroy(true);
      sprites.delete(id);
    }
    for (const pickup of pickups) {
      if (sprites.has(pickup.id)) continue;
      const shadow = this.scene.add.ellipse(0, 10, 30, 11, 0x315d68, 0.24);
      const star = this.scene.add.star(0, 0, 5, 10, 19, 0xf5bf60).setStrokeStyle(3, 0xfff5d8, 1);
      const center = this.scene.add.circle(0, 0, 5, 0xfff5d8);
      sprites.set(pickup.id, this.scene.add.container(pickup.x, pickup.y, [shadow, star, center]).setDepth(8));
    }
  }
}
