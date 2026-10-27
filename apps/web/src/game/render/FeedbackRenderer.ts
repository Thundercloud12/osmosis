import Phaser from "phaser";
import { TEAM_BASES, type GameEvent } from "@osmosis/shared";

type AvatarLookup = (playerId: string) => Phaser.GameObjects.Container | undefined;

/** Renders confirmed, recipient-filtered server events. It never changes game state. */
export class FeedbackRenderer {
  private raidAura: Phaser.GameObjects.Container | undefined;

  constructor(private readonly scene: Phaser.Scene, private readonly findAvatar: AvatarLookup) {}

  render(event: GameEvent): void {
    switch (event.type) {
      case "battleResolved":
        for (const participant of event.participants) {
          const color = participant.outcome === "WIN" ? 0xffd36f
            : participant.outcome === "TIE" ? 0x9ad9d1
              : participant.outcome === "ELIMINATED" ? 0xf36e72 : 0xf5a081;
          const label = participant.outcome === "WIN" ? "TAG WIN"
            : participant.outcome === "TIE" ? "TIE"
              : participant.outcome === "ELIMINATED" ? "ELIMINATED" : "TAGGED";
          this.impact(participant.playerId, participant.x, participant.y, color, label, participant.outcome === "ELIMINATED");
        }
        break;
      case "poleElimination":
        this.impact(event.attacker.playerId, event.attacker.x, event.attacker.y, 0xf36e72, "ELIMINATED", true, -110);
        this.impact(event.holder.playerId, event.holder.x, event.holder.y, 0xffd36f, "POLE HELD", false, 110);
        break;
      case "raidFeedback":
        this.renderRaid(event);
        break;
    }
  }

  destroy(): void {
    if (this.raidAura) {
      this.scene.tweens.killTweensOf(this.raidAura);
      this.raidAura.destroy(true);
      this.raidAura = undefined;
    }
  }

  private impact(playerId: string, x: number, y: number, color: number, label: string, eliminated: boolean, labelOffsetX = 0): void {
    const avatar = this.findAvatar(playerId);
    if (avatar) {
      this.scene.tweens.killTweensOf(avatar);
      avatar.setScale(1);
      this.scene.tweens.add({
        targets: avatar,
        scaleX: eliminated ? 0.82 : 1.12,
        scaleY: eliminated ? 0.82 : 1.12,
        duration: 95,
        yoyo: true,
        ease: "Back.Out",
      });
    }

    const ring = this.scene.add.ellipse(x, y + 8, 54, 27, color, 0.12).setStrokeStyle(4, color, 0.96).setDepth(22);
    this.scene.tweens.add({
      targets: ring,
      scaleX: eliminated ? 2.1 : 1.7,
      scaleY: eliminated ? 2.1 : 1.7,
      alpha: 0,
      duration: eliminated ? 520 : 340,
      ease: "Quad.Out",
      onComplete: () => ring.destroy(),
    });
    this.burst(x, y, eliminated ? "vfx-smoke" : "vfx-star", color, eliminated ? 8 : 6);
    this.floatLabel(x + labelOffsetX, y - 45, label, color);
  }

  private renderRaid(event: Extract<GameEvent, { type: "raidFeedback" }>): void {
    const base = TEAM_BASES[event.baseTeamId];
    const x = base.x + base.width / 2;
    const y = base.y + base.height / 2;
    const teamColor = event.teamId === "BLUE" ? 0x64c6ff : 0xff8588;

    if (event.stage === "STARTED") {
      this.destroyRaidAura();
      const glow = this.scene.add.ellipse(0, 0, base.width * 0.82, base.height * 0.78, teamColor, 0.08);
      const ring = this.scene.add.ellipse(0, 0, base.width * 0.86, base.height * 0.82, 0x000000, 0)
        .setStrokeStyle(7, teamColor, 0.78);
      const innerRing = this.scene.add.ellipse(0, 0, base.width * 0.72, base.height * 0.68, 0x000000, 0)
        .setStrokeStyle(2, teamColor, 0.36);
      const flare = this.scene.add.image(0, 0, "vfx-flare").setDisplaySize(112, 112)
        .setTint(teamColor).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.25);
      this.raidAura = this.scene.add.container(x, y, [glow, ring, innerRing, flare]).setDepth(18);
      this.scene.tweens.add({ targets: this.raidAura, scale: 1.035, alpha: 0.88, duration: 620, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.floatLabel(x, y - base.height * 0.38, "BASE RAID", teamColor);
      return;
    }

    this.destroyRaidAura();
    if (event.stage === "COMPLETED") {
      this.burst(x, y, "vfx-flare", 0xffd36f, 12);
      this.floatLabel(x, y - base.height * 0.38, "+2,000 RAID", 0xffd36f);
    } else {
      this.burst(x, y, "vfx-smoke", 0xb3c8c4, 7);
      this.floatLabel(x, y - base.height * 0.38, "RAID INTERRUPTED", 0xf0a17f);
    }
  }

  private destroyRaidAura(): void {
    const aura = this.raidAura;
    if (!aura) return;
    this.raidAura = undefined;
    this.scene.tweens.killTweensOf(aura);
    this.scene.tweens.add({
      targets: aura,
      alpha: 0,
      scale: 0.9,
      duration: 180,
      onComplete: () => aura.destroy(true),
    });
  }

  private burst(x: number, y: number, texture: string, tint: number, quantity: number): void {
    const emitter = this.scene.add.particles(0, 0, texture, {
      angle: { min: 0, max: 360 },
      speed: { min: 65, max: 170 },
      lifespan: 420,
      scale: { start: 0.14, end: 0 },
      alpha: { start: 0.92, end: 0 },
      rotate: { min: 0, max: 360 },
      tint,
      emitting: false,
      maxParticles: quantity,
    }).setDepth(22);
    emitter.explode(quantity, x, y);
    this.scene.time.delayedCall(520, () => emitter.destroy());
  }

  private floatLabel(x: number, y: number, label: string, color: number): void {
    const text = this.scene.add.text(x, y, label, {
      color: "#fff8e5",
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "18px",
      fontStyle: "bold",
      stroke: `#${color.toString(16).padStart(6, "0")}`,
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(23);
    this.scene.tweens.add({
      targets: text,
      y: y - 48,
      alpha: 0,
      scale: 1.12,
      delay: 320,
      duration: 460,
      ease: "Sine.Out",
      onComplete: () => text.destroy(),
    });
  }
}
