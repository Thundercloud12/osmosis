import { useEffect, useRef } from "react";

import { createArenaGame } from "./createArenaGame";
import { type MultiplayerClient, type NetworkStatus } from "../net/MultiplayerClient";
import { GameHud } from "./GameHud";
import type { RoomSnapshot } from "@osmosis/shared";

interface ArenaCanvasProps {
  network: MultiplayerClient;
  snapshot: RoomSnapshot | null;
  error: string | undefined;
  onLeave: () => void;
  onNetworkStatus(status: NetworkStatus): void;
}

export function ArenaCanvas({ network, snapshot, error, onLeave, onNetworkStatus }: ArenaCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const unsubscribeStatus = network.onStatus(onNetworkStatus);
    const game = createArenaGame(mountRef.current, network);
    return () => {
      unsubscribeStatus();
      game.destroy(true);
    };
  }, [onNetworkStatus]);

  return <div className="arena-screen">
    <div ref={mountRef} className="absolute inset-0" aria-label="Osmosis arena" />
    <GameHud snapshot={snapshot} error={error} onLeave={onLeave} />
  </div>;
}
