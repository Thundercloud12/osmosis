import Phaser from "phaser";

import { ArenaScene } from "./scenes/ArenaScene";
import type { MultiplayerClient } from "../net/MultiplayerClient";

export function createArenaGame(parent: HTMLElement, network: MultiplayerClient): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#315d68",
    pixelArt: true,
    render: {
      antialias: true,
      roundPixels: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: "100%",
      height: "100%",
    },
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
        gravity: { x: 0, y: 0 },
      },
    },
    scene: [new ArenaScene(network)],
  });
}
