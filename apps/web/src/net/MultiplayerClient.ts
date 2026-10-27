import { Client, MatchMakeError, type Room } from "@colyseus/sdk";
import {
  lobbySnapshotSchema,
  gameEventSchema,
  roomSnapshotSchema,
  type GameCommand,
  type GameEvent,
  type LobbyCommand,
  type LobbySnapshot,
  type RoomSnapshot,
  type RoomMode,
} from "@osmosis/shared";
import { dispatchSnapshotListeners, type SnapshotListener } from "./snapshotDispatch";
import { clearReconnectToken, readReconnectToken, saveReconnectToken } from "./ReconnectTokenStorage";

export type NetworkStatus = {
  state: "connecting" | "connected" | "disconnected" | "error";
  connectedPlayerCount: number;
  teamId?: "BLUE" | "RED";
};

export class MultiplayerClient {
  private room: Room | undefined;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly gameEventListeners = new Set<(event: GameEvent) => void>();
  private readonly lobbyListeners = new Set<(snapshot: LobbySnapshot) => void>();
  private readonly statusListeners = new Set<(status: NetworkStatus) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private latestRoomSnapshot: RoomSnapshot | undefined;
  private status: NetworkStatus = { state: "disconnected", connectedPlayerCount: 0 };
  private sequence = 0;
  private disposed = false;
  private connectionGeneration = 0;

  onSnapshot(listener: (snapshot: RoomSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    if (this.latestRoomSnapshot) {
      try {
        listener(this.latestRoomSnapshot);
      } catch (error) {
        this.snapshotListeners.delete(listener);
        console.error("Snapshot listener failed during subscription and was removed", error);
      }
    }
    return () => this.snapshotListeners.delete(listener);
  }

  onGameEvent(listener: (event: GameEvent) => void): () => void {
    this.gameEventListeners.add(listener);
    return () => this.gameEventListeners.delete(listener);
  }

  onStatus(listener: (status: NetworkStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onLobbySnapshot(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.lobbyListeners.add(listener);
    return () => this.lobbyListeners.delete(listener);
  }

  onCommandError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async createRoom(nickname: string, roomMode: RoomMode = "STANDARD"): Promise<void> {
    await this.connectRoom((client) => client.create("arena", { nickname, roomMode }));
  }

  async joinRoom(roomCode: string, nickname: string): Promise<void> {
    const code = roomCode.toUpperCase();
    const savedToken = readReconnectToken(code);
    await this.connectRoom(async (client) => {
      if (savedToken) {
        try { return await client.reconnect(savedToken); }
        catch (error) {
          if (error instanceof MatchMakeError) {
            clearReconnectToken(code);
            throw new Error("Your reconnect reservation has expired or is no longer available. Join the room again to request an open seat.");
          }
          throw new Error("Could not reach your room to reconnect. Check your connection and retry before the 120-second reservation ends.");
        }
      }
      return client.joinById(code, { nickname });
    }, code);
  }

  private async connectRoom(join: (client: Client) => Promise<Room>, roomCode?: string): Promise<void> {
    this.disposed = false;
    const generation = ++this.connectionGeneration;
    this.setStatus({ state: "connecting", connectedPlayerCount: 0 });
    const client = new Client(import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567");
    let room: Room;
    try {
      room = await join(client);
    } catch (error) {
      if (generation === this.connectionGeneration && !this.disposed) {
        this.setStatus({ state: "error", connectedPlayerCount: 0 });
      }
      throw error;
    }
    if (this.disposed || generation !== this.connectionGeneration) {
      await room.leave();
      return;
    }
    this.room = room;
    const code = roomCode ?? room.roomId.toUpperCase();
    const saveCurrentReconnectToken = () => saveReconnectToken(code, room.reconnectionToken);
    saveCurrentReconnectToken();
    room.onDrop(() => this.setStatus({ state: "connecting", connectedPlayerCount: this.status.connectedPlayerCount, ...(this.status.teamId ? { teamId: this.status.teamId } : {}) }));
    room.onReconnect(() => {
      saveCurrentReconnectToken();
      this.setStatus({ state: "connected", connectedPlayerCount: this.status.connectedPlayerCount, ...(this.status.teamId ? { teamId: this.status.teamId } : {}) });
    });
    this.sequence = 0;
    this.latestRoomSnapshot = undefined;
    room.onMessage("lobbySnapshot", (payload: unknown) => {
      const parsed = lobbySnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      const snapshot = parsed.data;
      const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
      this.setStatus({
        state: "connected",
        connectedPlayerCount: snapshot.connectedPlayerCount,
        ...(self ? { teamId: self.teamId } : {}),
      });
      for (const listener of this.lobbyListeners) listener(snapshot);
    });
    room.onMessage("snapshot", (payload: unknown) => {
      const parsed = roomSnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        this.setStatus({ state: "error", connectedPlayerCount: 0 });
        return;
      }

      const snapshot = parsed.data;
      this.latestRoomSnapshot = snapshot;
      const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
      this.setStatus({
        state: "connected",
        connectedPlayerCount: snapshot.connectedPlayerCount,
        ...(self ? { teamId: self.teamId } : {}),
      });
      dispatchSnapshotListeners(this.snapshotListeners, snapshot, (error) => {
        console.error("Snapshot listener failed and was removed", error);
      });
    });
    room.onMessage("gameEvent", (payload: unknown) => {
      const parsed = gameEventSchema.safeParse(payload);
      if (!parsed.success) return;
      for (const listener of this.gameEventListeners) {
        try { listener(parsed.data); }
        catch (error) {
          this.gameEventListeners.delete(listener);
          console.error("Game event listener failed and was removed", error);
        }
      }
    });
    room.onMessage("commandError", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("message" in payload)) return;
      const message = payload.message;
      if (typeof message === "string") {
        for (const listener of this.errorListeners) listener(message);
      }
    });
    room.onLeave(() => {
      if (this.room === room) {
        this.room = undefined;
        this.setStatus({ state: "disconnected", connectedPlayerCount: 0 });
        if (!this.disposed) {
          for (const listener of this.errorListeners) {
            listener("Connection ended. Your seat is reserved for up to 120 seconds; reload or rejoin the room to reconnect.");
          }
        }
      }
    });
    this.setStatus({ state: "connected", connectedPlayerCount: 1 });
  }

  sendCommand(command: LobbyCommand | GameCommand): void {
    this.room?.send("command", command);
  }

  sendMove(dx: -1 | 0 | 1, dy: -1 | 0 | 1): number {
    const seq = this.sequence++;
    this.room?.send("move", { type: "move", seq, dx, dy });
    return seq;
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.connectionGeneration += 1;
    const room = this.room;
    const wasConnected = room?.connection?.isOpen === true;
    if (room) clearReconnectToken(room.roomId);
    this.room = undefined;
    this.latestRoomSnapshot = undefined;
    if (room && wasConnected) await room.leave();
    else if (room) {
      room.reconnection.enabled = false;
      void room.leave(false);
    }
  }

  private setStatus(status: NetworkStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
