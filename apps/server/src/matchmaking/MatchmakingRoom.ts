import {
  matchmakingCommandSchema,
  type QuickPlaySettings,
} from "@osmosis/shared";
import { Room, ServerError, matchMaker, type Client } from "@colyseus/core";

import { WindowRateLimiter } from "../security/WindowRateLimiter";
import { MatchmakingCoordinator, type QueueTicket } from "./MatchmakingCoordinator";
import { issueHandoffCredential, issueQuickPlayRoomCredential } from "./HandoffCredential";

const quickPlayConnectionLimiter = new WindowRateLimiter();
const commandLimiter = new WindowRateLimiter();
const HANDOFF_GRACE_SECONDS = 120;
const MAX_PARTY_ACTIONS_PER_MINUTE = 8;

interface QuickPlaySeat {
  sessionId: string;
  playerId: string;
  nickname: string;
  teamId: "BLUE" | "RED";
}

export let activeMatchmakingRoom: MatchmakingRoom | undefined;

export class MatchmakingRoom extends Room {
  readonly coordinator = new MatchmakingCoordinator();
  private readonly clientsBySession = new Map<string, Client>();
  private readonly playerIdsBySession = new Map<string, string>();
  private readonly handoffTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private formingMatch = false;
  private enabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_QUICK_PLAY === "true";

  override onCreate(): void {
    activeMatchmakingRoom = this;
    this.autoDispose = false;
    this.maxMessagesPerSecond = 12;
    this.setSimulationInterval(() => {
      void this.formNextMatch();
      this.broadcastQueuedSnapshots();
    }, 500);
    this.onMessage("matchmakingCommand", (client, payload: unknown) => this.receiveCommand(client, payload));
    this.onMessage("requestSnapshot", (client) => {
      this.sendSnapshot(client);
      this.sendPendingHandoff(client);
    });
    this.onMessage("handoffClientReady", (client, payload: unknown) => {
      if (typeof payload !== "object" || payload === null || !("matchId" in payload)
        || typeof payload.matchId !== "string" || payload.matchId.length > 128) return;
      const playerId = this.playerIdsBySession.get(client.sessionId);
      if (!playerId) return;
      const result = this.coordinator.markClientReady(payload.matchId, playerId);
      if (result?.complete) this.completeHandoff(payload.matchId);
    });
  }

  override onAuth(_client: Client, options: unknown, context: { ip: string | undefined }): boolean {
    if (!this.enabled) throw new ServerError(503, "Quick Play is not enabled on this server yet.");
    const nickname = requireNickname(options);
    const address = context.ip ?? "unknown";
    if (!quickPlayConnectionLimiter.allow(`join:${address}`, 30, 60_000)) {
      throw new ServerError(429, "Too many Quick Play connections from this network. Try again shortly.");
    }
    return Boolean(nickname);
  }

  override onJoin(client: Client, options: unknown): void {
    const nickname = requireNickname(options);
    const player = this.coordinator.registerPlayer(client.sessionId, nickname);
    this.clientsBySession.set(client.sessionId, client);
    this.playerIdsBySession.set(client.sessionId, player.id);
    this.sendSnapshot(client);
  }

  override async onDrop(client: Client): Promise<void> {
    this.coordinator.setConnected(client.sessionId, false);
    this.sendSnapshots();
    try {
      await this.allowReconnection(client, HANDOFF_GRACE_SECONDS);
    } catch {
      // onLeave handles the expired queue or party member.
    }
  }

  override onReconnect(client: Client): void {
    const player = this.coordinator.setConnected(client.sessionId, true);
    this.clientsBySession.set(client.sessionId, client);
    if (!player) return;
    this.sendSnapshot(client);
    const handoff = this.coordinator.handoffForPlayer(player.id);
    if (!handoff || handoff.joinedPlayerIds.has(player.id)) return;
    this.sendPendingHandoff(client);
  }

  override onLeave(client: Client): void {
    const player = this.coordinator.getPlayerBySession(client.sessionId);
    if (!player) {
      this.clientsBySession.delete(client.sessionId);
      this.playerIdsBySession.delete(client.sessionId);
      return;
    }
    const removal = this.coordinator.removePlayer(client.sessionId);
    this.clientsBySession.delete(client.sessionId);
    this.playerIdsBySession.delete(client.sessionId);
    if (removal.handoffId) this.cancelMatch(removal.handoffId, "A player left before everyone reached the lobby.");
    for (const affectedId of removal.affectedPlayerIds) {
      const member = this.coordinator.getPlayerById(affectedId);
      if (member) this.sendSnapshot(this.clientsBySession.get(member.sessionId));
    }
    this.sendSnapshots();
  }

  metricsSnapshot() { return this.coordinator.metricsSnapshot(); }

  markArenaPlayerJoined(handoffId: string, playerId: string): void {
    if (!this.coordinator.markArenaJoined(handoffId, playerId)) return;
    const handoff = this.coordinator.getHandoff(handoffId);
    if (handoff && handoff.joinedPlayerIds.size === handoff.blue.concat(handoff.red)
      .reduce((sum, ticket) => sum + ticket.members.length, 0)
      && handoff.clientReadyPlayerIds.size === handoff.joinedPlayerIds.size) {
      this.completeHandoff(handoffId);
    }
  }

  private completeHandoff(handoffId: string): void {
    const handoff = this.coordinator.getHandoff(handoffId);
    if (!handoff) return;
    const sessionIds = new Map(
      [...(handoff?.blue ?? []), ...(handoff?.red ?? [])]
        .flatMap((ticket) => ticket.members.map((member) => [member.id, member.sessionId] as const)),
    );
    const playerIds = this.coordinator.completeHandoff(handoffId);
    this.clearHandoffTimeout(handoffId);
    for (const id of playerIds) {
      const client = this.clientsBySession.get(sessionIds.get(id) ?? "");
      client?.send("handoffComplete", { matchId: handoffId });
    }
    this.sendSnapshots();
  }

  cancelQuickPlayMatch(handoffId: string, reason: string): void {
    this.cancelMatch(handoffId, reason);
  }

  private receiveCommand(client: Client, payload: unknown): void {
    const playerId = this.playerIdsBySession.get(client.sessionId);
    if (!playerId) return;
    const parsed = matchmakingCommandSchema.safeParse(payload);
    if (!parsed.success) {
      client.send("matchmakingError", { message: "That Quick Play action could not be understood." });
      return;
    }
    const actionKey = `${client.sessionId}:${parsed.data.type}`;
    if (!commandLimiter.allow(actionKey, MAX_PARTY_ACTIONS_PER_MINUTE, 60_000)) {
      client.send("matchmakingError", { message: "You’re doing that too quickly. Wait a moment and try again." });
      return;
    }

    try {
      switch (parsed.data.type) {
        case "createParty": this.coordinator.createParty(playerId, parsed.data.settings); break;
        case "joinParty": this.coordinator.joinParty(playerId, parsed.data.code); break;
        case "leaveParty": this.coordinator.leaveParty(playerId); break;
        case "updatePartySettings": this.coordinator.updatePartySettings(playerId, parsed.data.settings); break;
        case "queueSolo": this.coordinator.queueSolo(playerId, parsed.data.settings); break;
        case "queueParty": this.coordinator.queueParty(playerId); break;
        case "cancelQueue": {
          const removal = this.coordinator.cancelQueue(playerId);
          if (removal.handoffId) this.cancelMatch(removal.handoffId, "Your crew cancelled this match search.");
          break;
        }
      }
      this.sendSnapshots();
      void this.formNextMatch();
    } catch (error) {
      client.send("matchmakingError", { message: error instanceof Error ? error.message : "Quick Play is temporarily unavailable." });
    }
  }

  private async formNextMatch(): Promise<void> {
    if (this.formingMatch || !this.enabled) return;
    const selected = this.coordinator.nextMatch();
    if (!selected) return;
    this.formingMatch = true;
    let room: Awaited<ReturnType<typeof matchMaker.createRoom>> | undefined;
    try {
      const seats = this.assignmentFor(selected.blue, "BLUE").concat(this.assignmentFor(selected.red, "RED"));
      room = await matchMaker.createRoom("arena", {
        roomMode: "STANDARD",
        matchSettings: selected.settings,
        quickPlay: {
          matchmakingRoomId: this.roomId,
          handoffId: selected.handoffId,
          seats,
          credential: issueQuickPlayRoomCredential({
            version: 1,
            handoffId: selected.handoffId,
            queueRoomId: this.roomId,
            seats,
            expiresAt: Date.now() + HANDOFF_GRACE_SECONDS * 1_000,
          }),
        },
      });
      if (!this.coordinator.isFormationActive(selected.handoffId)) {
        this.disposeArenaRoom(room.roomId);
        return;
      }

      const joinOptions = seats.map((seat) => ({
        nickname: seat.nickname,
        quickPlayHandoff: issueHandoffCredential({
          version: 1,
          handoffId: selected.handoffId,
          roomId: room!.roomId,
          queueRoomId: this.roomId,
          sessionId: seat.sessionId,
          playerId: seat.playerId,
          nickname: seat.nickname,
          teamId: seat.teamId,
          expiresAt: Date.now() + HANDOFF_GRACE_SECONDS * 1_000,
        }),
      }));
      const reservationResults = await matchMaker.reserveMultipleSeatsFor(room, seats.map((seat, index) => ({
        sessionId: seat.sessionId,
        options: joinOptions[index],
        auth: undefined,
      })));
      if (reservationResults.some((success) => !success)) throw new Error("A match seat could not be reserved.");
      if (!this.coordinator.isFormationActive(selected.handoffId)) {
        this.disposeArenaRoom(room.roomId);
        return;
      }

      const reservations = new Map<string, unknown>();
      seats.forEach((seat) => reservations.set(seat.playerId, matchMaker.buildSeatReservation(room!, seat.sessionId)));
      this.coordinator.createHandoff({
        id: selected.handoffId,
        roomId: room.roomId,
        settings: selected.settings,
        blue: selected.blue,
        red: selected.red,
        reservations,
      });
      this.scheduleHandoffTimeout(selected.handoffId);
      for (const seat of seats) {
        const player = this.coordinator.getPlayerById(seat.playerId);
        const reservation = reservations.get(seat.playerId);
        if (player && reservation) this.clientsBySession.get(player.sessionId)?.send("matchFound", { matchId: selected.handoffId, reservation });
      }
      this.sendSnapshots();
    } catch (error) {
      const affected = this.coordinator.releaseFormation(selected.handoffId);
      if (room) this.disposeArenaRoom(room.roomId);
      for (const playerId of affected) {
        const player = this.coordinator.getPlayerById(playerId);
        if (player) this.clientsBySession.get(player.sessionId)?.send("matchmakingError", {
          message: error instanceof Error ? "We couldn’t reserve every seat. Your crew is back in the queue." : "Quick Play is temporarily unavailable.",
        });
      }
      this.sendSnapshots();
    } finally {
      this.formingMatch = false;
    }
  }

  private assignmentFor(tickets: QueueTicket[], teamId: "BLUE" | "RED"): QuickPlaySeat[] {
    return tickets.flatMap((ticket) => ticket.members.map((member) => ({
      sessionId: member.sessionId,
      playerId: member.id,
      nickname: member.nickname,
      teamId,
    })));
  }

  private cancelMatch(handoffId: string, reason: string): void {
    this.clearHandoffTimeout(handoffId);
    const formingPlayers = this.coordinator.cancelFormation(handoffId);
    const handoff = this.coordinator.getHandoff(handoffId);
    const canceled = handoff ? this.coordinator.cancelHandoff(handoffId) : undefined;
    const playerIds = canceled?.playerIds ?? formingPlayers;
    const roomId = canceled?.roomId;
    for (const id of playerIds) {
      const player = this.coordinator.getPlayerById(id);
      if (player) this.clientsBySession.get(player.sessionId)?.send("handoffCancelled", { matchId: handoffId, message: reason });
    }
    if (roomId) this.abortArenaRoom(roomId, reason);
    this.sendSnapshots();
  }

  private abortArenaRoom(roomId: string, reason: string): void {
    const room = matchMaker.getLocalRoomById(roomId) as { cancelQuickPlayHandoff?: (message: string) => void } | undefined;
    room?.cancelQuickPlayHandoff?.(reason);
    if (!room?.cancelQuickPlayHandoff) this.disposeArenaRoom(roomId);
  }

  private disposeArenaRoom(roomId: string): void {
    const room = matchMaker.getLocalRoomById(roomId) as { disconnect?: () => Promise<unknown> } | undefined;
    if (room?.disconnect) void room.disconnect();
  }

  private sendSnapshots(): void {
    for (const client of this.clients) this.sendSnapshot(client);
  }

  private broadcastQueuedSnapshots(): void {
    for (const client of this.clients) {
      const snapshot = this.coordinator.snapshotFor(client.sessionId);
      if (snapshot?.queue) client.send("matchmakingSnapshot", snapshot);
    }
  }

  private sendSnapshot(client: Client | undefined): void {
    if (!client) return;
    const snapshot = this.coordinator.snapshotFor(client.sessionId);
    if (snapshot) client.send("matchmakingSnapshot", snapshot);
  }

  private sendPendingHandoff(client: Client): void {
    const player = this.coordinator.getPlayerBySession(client.sessionId);
    if (!player) return;
    const handoff = this.coordinator.handoffForPlayer(player.id);
    if (!handoff || handoff.joinedPlayerIds.has(player.id)) return;
    const reservation = handoff.reservations.get(player.id);
    if (reservation) client.send("matchFound", { matchId: handoff.id, reservation });
  }

  override onDispose(): void {
    for (const timer of this.handoffTimeouts.values()) clearTimeout(timer);
    this.handoffTimeouts.clear();
    if (activeMatchmakingRoom === this) activeMatchmakingRoom = undefined;
  }

  private scheduleHandoffTimeout(handoffId: string): void {
    this.clearHandoffTimeout(handoffId);
    const timer = setTimeout(() => {
      this.handoffTimeouts.delete(handoffId);
      const handoff = this.coordinator.getHandoff(handoffId);
      if (!handoff) return;
      const expectedPlayers = handoff.blue.concat(handoff.red)
        .reduce((sum, ticket) => sum + ticket.members.length, 0);
      if (handoff.joinedPlayerIds.size === expectedPlayers) {
        // ArenaRoom has accepted every reserved seat. Finish the queue handoff even
        // if a client acknowledgement was lost, so the in-memory queue cannot leak.
        this.completeHandoff(handoffId);
      } else {
        this.cancelMatch(handoffId, "The match lobby handoff timed out. Please search again.");
      }
    }, HANDOFF_GRACE_SECONDS * 1_000);
    timer.unref?.();
    this.handoffTimeouts.set(handoffId, timer);
  }

  private clearHandoffTimeout(handoffId: string): void {
    const timer = this.handoffTimeouts.get(handoffId);
    if (timer) clearTimeout(timer);
    this.handoffTimeouts.delete(handoffId);
  }
}

function requireNickname(options: unknown): string {
  const nickname = typeof options === "object" && options !== null && "nickname" in options ? options.nickname : undefined;
  if (typeof nickname !== "string" || !/^[\p{L}\p{N}_ -]{1,24}$/u.test(nickname.trim())) {
    throw new ServerError(400, "Enter a valid crewmate name before joining Quick Play.");
  }
  return nickname.trim();
}
