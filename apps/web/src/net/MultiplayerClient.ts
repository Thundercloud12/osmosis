import { Client, type Room } from "@colyseus/sdk";
import {
  lobbySnapshotSchema,
  roomSnapshotSchema,
  type GameCommand,
  type LobbyCommand,
  type LobbySnapshot,
  type RoomSnapshot,
} from "@osmosis/shared";

export type NetworkStatus = {
  state: "connecting" | "connected" | "disconnected" | "error";
  connectedPlayerCount: number;
  teamId?: "BLUE" | "RED";
};

export class MultiplayerClient {
  private room: Room | undefined;
  private readonly snapshotListeners = new Set<(snapshot: RoomSnapshot) => void>();
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
    if (this.latestRoomSnapshot) listener(this.latestRoomSnapshot);
    return () => this.snapshotListeners.delete(listener);
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

  async createRoom(nickname: string): Promise<void> {
    await this.connectRoom((client) => client.create("arena", { nickname }));
  }

  async joinRoom(roomCode: string, nickname: string): Promise<void> {
    const code = roomCode.toUpperCase();
    const savedToken = sessionStorage.getItem(this.reconnectKey(code));
    await this.connectRoom(async (client) => {
      if (savedToken) {
        try { return await client.reconnect(savedToken); }
        catch { sessionStorage.removeItem(this.reconnectKey(code)); }
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
    const saveReconnectToken = () => sessionStorage.setItem(this.reconnectKey(code), room.reconnectionToken);
    saveReconnectToken();
    room.onDrop(() => this.setStatus({ state: "connecting", connectedPlayerCount: this.status.connectedPlayerCount, ...(this.status.teamId ? { teamId: this.status.teamId } : {}) }));
    room.onReconnect(() => {
      saveReconnectToken();
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
      for (const listener of this.snapshotListeners) listener(snapshot);
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
      }
    });
    this.setStatus({ state: "connected", connectedPlayerCount: 1 });
  }

  sendCommand(command: LobbyCommand | GameCommand): void {
    this.room?.send("command", command);
  }

  sendMove(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    this.room?.send("move", { type: "move", seq: this.sequence++, dx, dy });
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.connectionGeneration += 1;
    const room = this.room;
    if (room) sessionStorage.removeItem(this.reconnectKey(room.roomId.toUpperCase()));
    this.room = undefined;
    this.latestRoomSnapshot = undefined;
    if (room) await room.leave();
  }

  private reconnectKey(roomCode: string): string { return `osmosis:reconnect:${roomCode}`; }

  private setStatus(status: NetworkStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
