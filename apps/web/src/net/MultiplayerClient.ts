import { Client, MatchMakeError, type Room, type SeatReservation } from "@colyseus/sdk";
import {
  matchmakingSnapshotSchema,
  lobbySnapshotSchema,
  gameEventSchema,
  roomSnapshotSchema,
  type GameCommand,
  type GameEvent,
  type LobbyCommand,
  type LobbySnapshot,
  type MatchSettings,
  type RoomSnapshot,
  type RoomMode,
  type MatchmakingCommand,
  type MatchmakingSnapshot,
  type QuickPlaySettings,
} from "@osmosis/shared";
import { dispatchSnapshotListeners, type SnapshotListener } from "./snapshotDispatch";
import { clearReconnectToken, readReconnectToken, saveReconnectToken } from "./ReconnectTokenStorage";
import { clearMatchmakingResume, readMatchmakingResume, saveMatchmakingResume } from "./MatchmakingResumeStorage";

export type NetworkStatus = {
  state: "connecting" | "connected" | "disconnected" | "error";
  connectedPlayerCount: number;
  teamId?: "BLUE" | "RED";
  latencyMs?: number;
  pingTimedOut?: boolean;
};

export class MultiplayerClient {
  private room: Room | undefined;
  private matchmakingRoom: Room | undefined;
  private matchmakingClient: Client | undefined;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly gameEventListeners = new Set<(event: GameEvent) => void>();
  private readonly lobbyListeners = new Set<(snapshot: LobbySnapshot) => void>();
  private readonly statusListeners = new Set<(status: NetworkStatus) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly matchmakingListeners = new Set<(snapshot: MatchmakingSnapshot) => void>();
  private readonly matchmakingClosedListeners = new Set<() => void>();
  private readonly reportListeners = new Set<(message: string) => void>();
  private readonly handoffsInProgress = new Set<string>();
  private readonly cancelledHandoffs = new Set<string>();
  private latestRoomSnapshot: RoomSnapshot | undefined;
  private status: NetworkStatus = { state: "disconnected", connectedPlayerCount: 0 };
  private sequence = 0;
  private disposed = false;
  private connectionGeneration = 0;
  private latencyInterval: number | undefined;
  private latencyTimeout: number | undefined;
  private latencyGeneration = 0;
  private latencyMs: number | undefined;
  private pingTimedOut = false;

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

  onMatchmakingSnapshot(listener: (snapshot: MatchmakingSnapshot) => void): () => void {
    this.matchmakingListeners.add(listener);
    return () => this.matchmakingListeners.delete(listener);
  }

  onMatchmakingClosed(listener: () => void): () => void {
    this.matchmakingClosedListeners.add(listener);
    return () => this.matchmakingClosedListeners.delete(listener);
  }

  onReportAccepted(listener: (message: string) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  async createRoom(nickname: string, roomMode: RoomMode = "STANDARD", matchSettings?: Partial<MatchSettings>): Promise<void> {
    await this.connectRoom((client) => client.create("arena", { nickname, roomMode, ...(matchSettings ? { matchSettings } : {}) }));
  }

  async createParty(nickname: string, settings: QuickPlaySettings): Promise<void> {
    await this.connectMatchmaking(nickname);
    this.sendMatchmakingCommand({ type: "createParty", settings });
  }

  async joinParty(nickname: string, code: string): Promise<void> {
    await this.connectMatchmaking(nickname);
    this.sendMatchmakingCommand({ type: "joinParty", code: code.toUpperCase() });
  }

  async queueSolo(nickname: string, settings: QuickPlaySettings): Promise<void> {
    await this.connectMatchmaking(nickname);
    this.sendMatchmakingCommand({ type: "queueSolo", settings });
  }

  async resumeMatchmaking(): Promise<boolean> {
    const saved = readMatchmakingResume();
    if (!saved || this.matchmakingRoom) return Boolean(this.matchmakingRoom);
    this.disposed = false;
    const client = new Client(import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567");
    this.setStatus({ state: "connecting", connectedPlayerCount: 0 });
    try {
      const room = await client.reconnect(saved.token);
      this.attachMatchmakingRoom(client, room);
      return true;
    } catch {
      clearMatchmakingResume();
      return false;
    }
  }

  sendMatchmakingCommand(command: MatchmakingCommand): void {
    this.matchmakingRoom?.send("matchmakingCommand", command);
  }

  async leaveMatchmaking(): Promise<void> {
    const room = this.matchmakingRoom;
    this.matchmakingRoom = undefined;
    this.matchmakingClient = undefined;
    clearMatchmakingResume();
    if (room?.connection?.isOpen) await room.leave();
    else if (room) {
      room.reconnection.enabled = false;
      void room.leave(false);
    }
    for (const listener of this.matchmakingClosedListeners) listener();
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
    this.stopLatencyMonitor();
    this.resetLatency();
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
    this.attachRoom(room, roomCode);
  }

  private attachRoom(room: Room, roomCode?: string): void {
    this.room = room;
    const code = roomCode ?? room.roomId.toUpperCase();
    const saveCurrentReconnectToken = () => saveReconnectToken(code, room.reconnectionToken);
    saveCurrentReconnectToken();
    room.onDrop(() => {
      if (this.room !== room) return;
      this.stopLatencyMonitor();
      this.resetLatency();
      this.setStatus({ state: "connecting", connectedPlayerCount: this.status.connectedPlayerCount, ...(this.status.teamId ? { teamId: this.status.teamId } : {}) });
    });
    room.onReconnect(() => {
      if (this.room !== room) return;
      saveCurrentReconnectToken();
      this.resetLatency();
      this.setStatus(this.connectedStatus(this.status.connectedPlayerCount, this.status.teamId));
      this.startLatencyMonitor(room);
    });
    this.sequence = 0;
    this.latestRoomSnapshot = undefined;
    room.onMessage("lobbySnapshot", (payload: unknown) => {
      const parsed = lobbySnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      const snapshot = parsed.data;
      const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
      this.setStatus(this.connectedStatus(snapshot.connectedPlayerCount, self?.teamId));
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
      this.setStatus(this.connectedStatus(snapshot.connectedPlayerCount, self?.teamId));
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
    room.onMessage("reportAccepted", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("message" in payload) || typeof payload.message !== "string") return;
      for (const listener of this.reportListeners) listener(payload.message);
    });
    room.onMessage("quickPlayCancelled", (payload: unknown) => {
      const message = typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "Quick Play was cancelled because a player did not reach the lobby.";
      if (this.room !== room) return;
      this.room = undefined;
      this.latestRoomSnapshot = undefined;
      this.stopLatencyMonitor();
      this.resetLatency();
      clearReconnectToken(room.roomId);
      this.setStatus(this.matchmakingRoom
        ? { state: "connected", connectedPlayerCount: 0 }
        : { state: "disconnected", connectedPlayerCount: 0 });
      for (const listener of this.errorListeners) listener(message);
      void room.leave();
    });
    room.onLeave(() => {
      if (this.room === room) {
        this.room = undefined;
        this.stopLatencyMonitor();
        this.resetLatency();
        this.setStatus({ state: "disconnected", connectedPlayerCount: 0 });
        if (!this.disposed) {
          for (const listener of this.errorListeners) {
            listener("Connection ended. Your seat is reserved for up to 120 seconds; reload or rejoin the room to reconnect.");
          }
        }
      }
    });
    this.setStatus(this.connectedStatus(1));
    this.startLatencyMonitor(room);
  }

  private async connectMatchmaking(nickname: string): Promise<void> {
    if (this.matchmakingRoom) return;
    this.disposed = false;
    const generation = ++this.connectionGeneration;
    this.setStatus({ state: "connecting", connectedPlayerCount: 0 });
    const client = new Client(import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567");
    const saved = readMatchmakingResume();
    let room: Room;
    try {
      if (saved) {
        try { room = await client.reconnect(saved.token); }
        catch {
          clearMatchmakingResume();
          room = await client.joinOrCreate("matchmaking", { nickname });
        }
      } else room = await client.joinOrCreate("matchmaking", { nickname });
    } catch (error) {
      if (generation === this.connectionGeneration && !this.disposed) this.setStatus({ state: "error", connectedPlayerCount: 0 });
      throw error;
    }
    if (this.disposed || generation !== this.connectionGeneration) {
      await room.leave();
      return;
    }
    this.attachMatchmakingRoom(client, room);
  }

  private attachMatchmakingRoom(client: Client, room: Room): void {
    this.matchmakingClient = client;
    this.matchmakingRoom = room;
    const saveToken = () => saveMatchmakingResume({ roomId: room.roomId, token: room.reconnectionToken });
    saveToken();
    room.onMessage("matchmakingSnapshot", (payload: unknown) => {
      const parsed = matchmakingSnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      for (const listener of this.matchmakingListeners) listener(parsed.data);
    });
    room.onMessage("matchmakingError", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("message" in payload) || typeof payload.message !== "string") return;
      for (const listener of this.errorListeners) listener(payload.message);
    });
    room.onMessage("matchFound", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("matchId" in payload) || typeof payload.matchId !== "string"
        || !("reservation" in payload) || typeof payload.reservation !== "object" || payload.reservation === null) return;
      void this.consumeQuickPlaySeat(client, room, payload.matchId, payload.reservation as SeatReservation);
    });
    room.onMessage("handoffComplete", (payload: unknown) => {
      const matchId = typeof payload === "object" && payload !== null && "matchId" in payload && typeof payload.matchId === "string"
        ? payload.matchId
        : undefined;
      this.finishMatchmakingConnection(room, matchId);
    });
    room.onMessage("handoffCancelled", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("message" in payload) || typeof payload.message !== "string") return;
      if ("matchId" in payload && typeof payload.matchId === "string") this.cancelledHandoffs.add(payload.matchId);
      for (const listener of this.errorListeners) listener(payload.message);
    });
    room.onDrop(() => {
      if (this.matchmakingRoom === room && !this.room) this.setStatus({ state: "connecting", connectedPlayerCount: 0 });
    });
    room.onReconnect(() => {
      if (this.matchmakingRoom !== room) return;
      saveToken();
      if (!this.room) this.setStatus({ state: "connected", connectedPlayerCount: 0 });
      room.send("requestSnapshot");
    });
    room.onLeave(() => {
      if (this.matchmakingRoom !== room) return;
      this.matchmakingRoom = undefined;
      this.matchmakingClient = undefined;
      clearMatchmakingResume();
      if (!this.room) this.setStatus({ state: "error", connectedPlayerCount: 0 });
      for (const listener of this.matchmakingClosedListeners) listener();
    });
    this.setStatus({ state: "connected", connectedPlayerCount: 0 });
    room.send("requestSnapshot");
  }

  private async consumeQuickPlaySeat(client: Client, queueRoom: Room, matchId: string, reservation: SeatReservation): Promise<void> {
    if (this.handoffsInProgress.has(matchId) || this.matchmakingRoom !== queueRoom || !reservation.roomId) return;
    this.handoffsInProgress.add(matchId);
    try {
      const room = await client.consumeSeatReservation(reservation);
      if (this.cancelledHandoffs.has(matchId) || this.disposed) {
        await room.leave();
        return;
      }
      this.attachRoom(room, reservation.roomId.toUpperCase());
      const url = new URL(window.location.href);
      url.searchParams.set("room", reservation.roomId.toUpperCase());
      window.history.replaceState(null, "", url);
      queueRoom.send("handoffClientReady", { matchId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enter the match lobby. Retrying your reserved seat…";
      for (const listener of this.errorListeners) listener(message);
      queueRoom.send("requestSnapshot");
    } finally {
      this.handoffsInProgress.delete(matchId);
    }
  }

  private finishMatchmakingConnection(room: Room, matchId?: string): void {
    if (this.matchmakingRoom !== room) return;
    if (matchId) this.cancelledHandoffs.delete(matchId);
    this.matchmakingRoom = undefined;
    this.matchmakingClient = undefined;
    clearMatchmakingResume();
    void room.leave();
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
    this.stopLatencyMonitor();
    this.resetLatency();
    const room = this.room;
    const matchmakingRoom = this.matchmakingRoom;
    const wasConnected = room?.connection?.isOpen === true;
    if (room) clearReconnectToken(room.roomId);
    this.room = undefined;
    this.matchmakingRoom = undefined;
    this.matchmakingClient = undefined;
    clearMatchmakingResume();
    this.latestRoomSnapshot = undefined;
    if (room && wasConnected) await room.leave();
    else if (room) {
      room.reconnection.enabled = false;
      void room.leave(false);
    }
    if (matchmakingRoom?.connection?.isOpen) await matchmakingRoom.leave();
    else if (matchmakingRoom) {
      matchmakingRoom.reconnection.enabled = false;
      void matchmakingRoom.leave(false);
    }
  }

  private setStatus(status: NetworkStatus): void {
    if (status.state === this.status.state
      && status.connectedPlayerCount === this.status.connectedPlayerCount
      && status.teamId === this.status.teamId
      && status.latencyMs === this.status.latencyMs
      && status.pingTimedOut === this.status.pingTimedOut) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private connectedStatus(connectedPlayerCount: number, teamId?: "BLUE" | "RED"): NetworkStatus {
    return {
      state: "connected",
      connectedPlayerCount,
      ...(teamId ? { teamId } : {}),
      ...(this.latencyMs === undefined ? {} : { latencyMs: this.latencyMs }),
      pingTimedOut: this.pingTimedOut,
    };
  }

  private startLatencyMonitor(room: Room): void {
    this.stopLatencyMonitor();
    this.resetLatency();
    const generation = this.latencyGeneration;
    const scheduleResponseTimeout = () => {
      if (this.latencyTimeout !== undefined) window.clearTimeout(this.latencyTimeout);
      this.latencyTimeout = window.setTimeout(() => {
        if (generation !== this.latencyGeneration || this.room !== room) return;
        this.latencyTimeout = undefined;
        this.pingTimedOut = true;
        this.publishLatency();
      }, 5_000);
    };
    const measure = () => {
      if (generation !== this.latencyGeneration || this.room !== room || !room.connection?.isOpen) return;
      room.ping((latencyMs) => {
        if (generation !== this.latencyGeneration || this.room !== room) return;
        this.latencyMs = latencyMs;
        this.pingTimedOut = false;
        this.publishLatency();
        scheduleResponseTimeout();
      });
    };

    measure();
    scheduleResponseTimeout();
    this.latencyInterval = window.setInterval(measure, 3_000);
  }

  private stopLatencyMonitor(): void {
    this.latencyGeneration += 1;
    if (this.latencyInterval !== undefined) window.clearInterval(this.latencyInterval);
    if (this.latencyTimeout !== undefined) window.clearTimeout(this.latencyTimeout);
    this.latencyInterval = undefined;
    this.latencyTimeout = undefined;
  }

  private resetLatency(): void {
    this.latencyMs = undefined;
    this.pingTimedOut = false;
  }

  private publishLatency(): void {
    if (this.status.state === "connected") {
      this.setStatus(this.connectedStatus(this.status.connectedPlayerCount, this.status.teamId));
    }
  }
}
