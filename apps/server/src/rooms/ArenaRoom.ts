import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { Room, ServerError, matchMaker, type Client } from "colyseus";
import {
  GAME_RULES,
  MOVEMENT_CONFIG,
  TEAM_BASES,
  TEAM_SPAWNS,
  TEAM_SPAWN_SPACING,
  clientCommandSchema,
  generatePickupLocations,
  gameEventSchema,
  lobbySnapshotSchema,
  remainingSeconds,
  roomSnapshotSchema,
  roomModeSchema,
  type LobbyPlayer,
  type PlayerStatus,
  type GameEvent,
  type TeamId,
  type RoomMode,
} from "@osmosis/shared";
import { movePlayer, releasePole, touchesHomePole, type PoleHolders } from "../systems/MovementSystem";
import { collectPickups } from "../systems/PickupSystem";
import { opponentTeam, resolveContact, settleGroups } from "../systems/BattleSystem";
import { breakLink as breakLinkSystem, startLink as startLinkSystem, validateLinks, withinLinkRange } from "../systems/LinkSystem";
import { advanceRaids as advanceRaidsSystem, cancelRaid, setRaid, type ActiveRaid } from "../systems/RaidSystem";
import { eliminatePlayer as eliminatePlayerSystem, eliminatedTeamWinner, freezeMovement as freezeMovementSystem, makeInactive as makeInactiveSystem, rearmPlayers as rearmPlayersSystem, reconcilePoleHolders as reconcilePoleHoldersSystem } from "../systems/PlayerStatusSystem";
import { projectSnapshot } from "../security/SnapshotProjector";
import { connectedPlayerCount as countConnectedPlayers, disconnectPlayer, oldestConnectedPlayerId, purgeDisconnectedPlayersForRematch, reconnectPlayer } from "../systems/PresenceSystem";
import { roomModeAllowed } from "./RoomModePolicy";
import type { Pickup, ServerPlayer } from "./Player";

const PLAYER_RADIUS = MOVEMENT_CONFIG.playerRadius;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
type RoomPhase = "LOBBY" | "ALLOCATION" | "COUNTDOWN" | "PLAYING" | "RESULTS";
const VOICE_CREDENTIAL_SECRET = process.env.RECONNECT_SECRET ?? randomBytes(32).toString("base64url");
const VOICE_CREDENTIAL_TTL_SECONDS = 16 * 60;

export interface VoiceIdentity {
  playerId: string;
  nickname: string;
  teamId: TeamId;
  roomName: string;
}

export type VoiceChannel = "TEAM" | "GLOBAL";

export const activeArenaRooms = new Map<string, ArenaRoom>();

export class ArenaRoom extends Room {
  private roomMode: RoomMode = "STANDARD";
  private playersPerTeam: number = GAME_RULES.teamSize;
  private readonly players = new Map<string, ServerPlayer>();
  private phase: RoomPhase = "LOBBY";
  private hostPlayerId: string | undefined;
  private readonly captainIds: Record<TeamId, string | undefined> = { BLUE: undefined, RED: undefined };
  private readonly allocationLocked: Record<TeamId, boolean> = { BLUE: false, RED: false };
  private allocationComplete = false;
  private joinOrder = 0;
  private countdownDeadline: number | undefined;
  private matchDeadline: number | undefined;
  private readonly activeContactPairs = new Set<string>();
  private readonly poleHolders: PoleHolders = { BLUE: undefined, RED: undefined };
  private readonly activeRaids: Record<TeamId, ActiveRaid | undefined> = { BLUE: undefined, RED: undefined };
  private readonly raidCooldownUntil: Record<TeamId, number> = { BLUE: 0, RED: 0 };
  private pickups: Pickup[] = [];
  private roundNumber = 0;
  private gameEventSequence = 0;
  private resultWinnerOverride: TeamId | null = null;
  private readonly captainReassignTimers: Record<TeamId, ReturnType<typeof setTimeout> | undefined> = { BLUE: undefined, RED: undefined };

  override async onCreate(options: unknown): Promise<void> {
    const requestedMode = typeof options === "object" && options !== null && "roomMode" in options
      ? options.roomMode
      : undefined;
    const parsedRoomMode = roomModeSchema.safeParse(requestedMode);
    this.roomMode = parsedRoomMode.success ? parsedRoomMode.data : "STANDARD";
    if (!roomModeAllowed(this.roomMode)) throw new ServerError(400, "Test room modes are disabled on this server.");
    this.playersPerTeam = this.roomMode === "TEST_1V1" ? 1
      : this.roomMode === "TEST_2V2" ? 2
        : GAME_RULES.teamSize;
    this.roomId = await this.generateRoomCode();
    activeArenaRooms.set(this.roomId, this);
    this.maxClients = this.playersPerTeam * 2;
    this.maxMessagesPerSecond = 30;
    await this.setPrivate();
    this.setFixedTimestep((context) => this.step(context.dt), GAME_RULES.simulationHz);
    this.onMessage("move", (client, payload: unknown) => this.receiveMove(client, payload));
    this.onMessage("command", (client, payload: unknown) => this.receiveCommand(client, payload));
  }

  override onAuth(_client: Client, _options: unknown): boolean {
    if (this.phase !== "LOBBY") throw new ServerError(400, "This room is no longer accepting players.");
    if (this.players.size >= this.maxClients) throw new ServerError(400, "This room is full.");
    return true;
  }

  override async onDrop(client: Client): Promise<void> {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    disconnectPlayer(player, performance.now() + GAME_RULES.reconnectGraceSeconds * 1_000);
    this.breakLink(player);
    this.cancelRaidFor(player.id);
    releasePole(player, this.poleHolders);
    if (this.phase === "COUNTDOWN") {
      this.phase = "LOBBY";
      this.countdownDeadline = undefined;
      this.resetReadyState();
      this.unlock();
    }
    if (this.hostPlayerId === player.id) this.hostPlayerId = oldestConnectedPlayerId(this.players.values());
    if (this.captainIds[player.teamId] === player.id) this.scheduleCaptainReassignment(player);
    if (this.phase === "PLAYING" || this.phase === "RESULTS") this.sendSnapshots();
    else this.sendLobbySnapshots();
    try {
      await this.allowReconnection(client, GAME_RULES.reconnectGraceSeconds);
    } catch {
      // Colyseus calls onLeave after a dropped client's reconnection window expires.
    }
  }

  override onReconnect(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    reconnectPlayer(player, performance.now(), (candidate) => this.isInsideBase(candidate, TEAM_BASES[candidate.teamId]));
    if (player.status === "ACTIVE" && touchesHomePole(player) && !this.poleHolders[player.teamId]) this.poleHolders[player.teamId] = player.id;
    player.ready = false;
    const timer = this.captainReassignTimers[player.teamId];
    if (timer) clearTimeout(timer);
    this.captainReassignTimers[player.teamId] = undefined;
    if (!this.hostPlayerId) {
      this.hostPlayerId = [...this.players.values()].filter((candidate) => candidate.connected)
        .sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;
    }
    if (this.phase === "PLAYING" || this.phase === "RESULTS") this.sendSnapshots();
    else this.sendLobbySnapshots();
  }

  override onDispose(): void {
    activeArenaRooms.delete(this.roomId);
    for (const timer of Object.values(this.captainReassignTimers)) if (timer) clearTimeout(timer);
  }

  authorizeVoiceCredential(credential: string, channel: VoiceChannel = "TEAM"): VoiceIdentity | undefined {
    const [payload, signature, extra] = credential.split(".");
    if (!payload || !signature || extra !== undefined) return undefined;
    const expected = createHmac("sha256", VOICE_CREDENTIAL_SECRET).update(payload).digest();
    let received: Buffer;
    try { received = Buffer.from(signature, "base64url"); } catch { return undefined; }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
    let claims: { roomCode?: string; playerId?: string; roundNumber?: number; expiresAt?: number };
    try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof claims; } catch { return undefined; }
    if (claims.roomCode !== this.roomId || claims.roundNumber !== this.roundNumber || !claims.playerId || !claims.expiresAt || claims.expiresAt < Date.now()) return undefined;
    const player = this.findById(claims.playerId);
    if (!player || !player.connected || player.status === "DISCONNECTED") return undefined;
    return {
      playerId: player.id,
      nickname: player.nickname,
      teamId: player.teamId,
      roomName: channel === "TEAM"
        ? `${this.roomId}:round-${this.roundNumber}:${player.teamId}`
        : `${this.roomId}:round-${this.roundNumber}:GLOBAL`,
    };
  }

  override onJoin(client: Client, options: unknown): void {
    const optionsRecord = typeof options === "object" && options !== null ? options : {};
    const requestedName = "nickname" in optionsRecord ? optionsRecord.nickname : undefined;
    const nickname = typeof requestedName === "string" && /^[\p{L}\p{N}_ -]{1,24}$/u.test(requestedName.trim())
      ? requestedName.trim()
      : `Crew ${String(this.players.size + 1).padStart(2, "0")}`;
    const blueCount = this.countTeam("BLUE");
    const redCount = this.countTeam("RED");
    const teamId: TeamId = blueCount <= redCount ? "BLUE" : "RED";
    const player: ServerPlayer = {
      id: crypto.randomUUID(), nickname, teamId,
      x: TEAM_SPAWNS[teamId].x, y: TEAM_SPAWNS[teamId].y + Math.min(blueCount, redCount) * TEAM_SPAWN_SPACING,
      dx: 0, dy: 0, lastSequence: -1, ready: false, joinOrder: this.joinOrder++,
      startingPoints: undefined, points: 0, status: "ACTIVE", inactiveUntil: 0, frozenUntil: 0,
      lastAppliedSequence: -1, pendingMoves: [], linkedPlayerId: undefined,
      connected: true, statusBeforeDisconnect: undefined, voiceCredential: undefined, voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined,
      reconnectUntil: undefined,
      pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
    };
    this.players.set(client.sessionId, player);
    this.hostPlayerId ??= player.id;
    this.sendLobbySnapshots();
  }

  override onLeave(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    disconnectPlayer(player, undefined);
    this.breakLink(player);
    this.cancelRaidFor(player.id);
    releasePole(player, this.poleHolders);
    if (this.phase === "PLAYING" || this.phase === "RESULTS") {
      if (this.hostPlayerId === player.id) this.hostPlayerId = oldestConnectedPlayerId(this.players.values());
      if (this.captainIds[player.teamId] === player.id) this.scheduleCaptainReassignment(player);
      this.sendSnapshots();
      return;
    }

    this.players.delete(client.sessionId);
    if (this.captainIds[player.teamId] === player.id) this.captainIds[player.teamId] = undefined;
    if (this.hostPlayerId === player.id) {
      this.hostPlayerId = oldestConnectedPlayerId(this.players.values());
    }
    if (this.phase === "COUNTDOWN") {
      this.phase = "LOBBY";
      this.countdownDeadline = undefined;
      this.unlock();
    }
    if (this.phase === "ALLOCATION" || this.allocationComplete) {
      this.resetAllocation();
      this.phase = "LOBBY";
    }
    this.resetReadyState();
    this.sendLobbySnapshots();
  }

  private async generateRoomCode(): Promise<string> {
    for (;;) {
      const code = Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join("");
      const existing = await matchMaker.findRoomsByIds([code]);
      if (!existing.has(code)) return code;
    }
  }

  private receiveMove(client: Client, payload: unknown): void {
    if (this.phase !== "PLAYING") return;
    const player = this.players.get(client.sessionId);
    const parsed = clientCommandSchema.safeParse(payload);
    if (!player || (player.status !== "ACTIVE" && player.status !== "INACTIVE") || !parsed.success || parsed.data.type !== "move") return;
    if (parsed.data.seq <= player.lastSequence) return;
    if (player.pendingMoves.length >= 12) return;
    player.lastSequence = parsed.data.seq;
    player.pendingMoves.push(parsed.data);
  }

  private receiveCommand(client: Client, payload: unknown): void {
    const player = this.players.get(client.sessionId);
    if (!player || !player.connected || player.status === "DISCONNECTED") return;
    const parsed = clientCommandSchema.safeParse(payload);
    if (!parsed.success) {
      client.send("commandError", { message: "That action could not be understood." });
      return;
    }
    try {
      if (this.phase === "PLAYING") {
        if (player.status === "ELIMINATED") throw new Error("Eliminated players are spectators for the rest of this round.");
        switch (parsed.data.type) {
          case "interact": this.setInteraction(player, parsed.data.active !== false); break;
          case "linkStart": this.startLink(player, parsed.data.teammateId); break;
          case "linkStop": this.breakLink(player); break;
          case "ping": break;
          default: throw new Error("That action is not available during the match.");
        }
        this.sendSnapshots();
        return;
      }
      if (this.phase === "RESULTS") {
        if (parsed.data.type !== "rematch") throw new Error("Only the host can request a rematch.");
        this.rematch(player);
        return;
      }
      switch (parsed.data.type) {
        case "chooseTeam": this.chooseTeam(player, parsed.data.teamId); break;
        case "captain": this.updateCaptain(player, parsed.data.action); break;
        case "beginAllocation": this.beginAllocation(player); break;
        case "allocate": this.allocatePoints(player, parsed.data.pointsByPlayerId); break;
        case "lockAllocation": this.lockTeamAllocation(player); break;
        case "ready": this.setReady(player, parsed.data.ready); break;
        case "startCountdown": this.startCountdown(player); break;
        case "cancelCountdown": this.cancelCountdown(player); break;
        case "move": client.send("commandError", { message: "Movement must use the movement channel." }); break;
        default: throw new Error("That action is not available before a match.");
      }
    } catch (error) {
      client.send("commandError", { message: error instanceof Error ? error.message : "That action was rejected." });
    }
    this.sendLobbySnapshots();
  }

  private chooseTeam(player: ServerPlayer, teamId: TeamId): void {
    if (this.phase !== "LOBBY" || this.allocationComplete) throw new Error("Teams are locked after allocation begins.");
    if (player.teamId === teamId) return;
    if (this.countTeam(teamId) >= this.playersPerTeam) throw new Error("That crew is full.");
    if (this.captainIds[player.teamId] === player.id) this.captainIds[player.teamId] = undefined;
    player.teamId = teamId;
    const slot = this.countTeam(teamId) - 1;
    player.x = TEAM_SPAWNS[teamId].x;
    player.y = TEAM_SPAWNS[teamId].y + Math.max(0, slot) * TEAM_SPAWN_SPACING;
    this.resetReadyState();
  }

  private updateCaptain(player: ServerPlayer, action: "claim" | "release"): void {
    if (this.phase !== "LOBBY" || this.allocationComplete) throw new Error("Captain selection is closed.");
    const currentCaptain = this.captainIds[player.teamId];
    if (action === "claim") {
      if (currentCaptain && currentCaptain !== player.id) throw new Error("Your crew already has a captain.");
      this.captainIds[player.teamId] = player.id;
    } else if (currentCaptain === player.id) this.captainIds[player.teamId] = undefined;
    this.resetReadyState();
  }

  private beginAllocation(player: ServerPlayer): void {
    if (player.id !== this.hostPlayerId) throw new Error("Only the host can open point allocation.");
    if (this.phase !== "LOBBY" || this.allocationComplete) throw new Error("Point allocation cannot start right now.");
    if (this.countTeam("BLUE") !== this.playersPerTeam || this.countTeam("RED") !== this.playersPerTeam) {
      throw new Error(`Both crews need ${this.playersPerTeam} player${this.playersPerTeam === 1 ? "" : "s"} before allocation can begin.`);
    }
    if (!this.captainIds.BLUE || !this.captainIds.RED) throw new Error("Choose one captain for each crew first.");
    this.phase = "ALLOCATION";
    this.allocationLocked.BLUE = false;
    this.allocationLocked.RED = false;
    for (const teammate of this.players.values()) teammate.startingPoints = GAME_RULES.startingTeamPoints / this.playersPerTeam;
  }

  private allocatePoints(player: ServerPlayer, pointsByPlayerId: Record<string, number>): void {
    if (this.phase !== "ALLOCATION") throw new Error("Point allocation is not open.");
    if (this.captainIds[player.teamId] !== player.id) throw new Error("Only your crew captain can edit these points.");
    if (this.allocationLocked[player.teamId]) throw new Error("Your crew's allocation is locked.");
    const teammates = [...this.players.values()].filter((candidate) => candidate.teamId === player.teamId);
    const playerIds = new Set(teammates.map((teammate) => teammate.id));
    const entries = Object.entries(pointsByPlayerId);
    const shapeValid = entries.length === this.playersPerTeam && entries.every(([id]) => playerIds.has(id));
    const total = entries.reduce((sum, [, points]) => sum + points, 0);
    const valuesValid = entries.every(([, points]) => Number.isInteger(points) && points >= GAME_RULES.minimumStartingPointsPerPlayer && points % GAME_RULES.allocationIncrement === 0);
    if (!shapeValid || !valuesValid || total !== GAME_RULES.startingTeamPoints) {
      throw new Error(`Allocate exactly 10,000 points in 100 point increments, with at least 500 per player.`);
    }
    for (const teammate of teammates) teammate.startingPoints = pointsByPlayerId[teammate.id]!;
  }

  private lockTeamAllocation(player: ServerPlayer): void {
    if (this.phase !== "ALLOCATION") throw new Error("Point allocation is not open.");
    if (this.captainIds[player.teamId] !== player.id) throw new Error("Only your crew captain can lock the allocation.");
    if (this.allocationLocked[player.teamId]) return;
    const teammates = [...this.players.values()].filter((candidate) => candidate.teamId === player.teamId);
    const values = teammates.map((teammate) => teammate.startingPoints);
    if (values.some((points) => points === undefined || points < GAME_RULES.minimumStartingPointsPerPlayer) || values.reduce<number>((sum, points) => sum + (points ?? 0), 0) !== GAME_RULES.startingTeamPoints) {
      throw new Error("Your allocation must total exactly 10,000 points, with at least 500 per player, before locking.");
    }
    this.allocationLocked[player.teamId] = true;
    if (this.allocationLocked.BLUE && this.allocationLocked.RED) {
      this.allocationComplete = true;
      this.phase = "LOBBY";
      this.resetReadyState();
    }
  }

  private setReady(player: ServerPlayer, ready: boolean): void {
    if (this.phase !== "LOBBY" || !this.allocationComplete) throw new Error("Both captains must lock their allocation before readying up.");
    player.ready = ready;
  }

  private startCountdown(player: ServerPlayer): void {
    if (player.id !== this.hostPlayerId) throw new Error("Only the host can start the match.");
    if (this.phase !== "LOBBY" || !this.allocationComplete) throw new Error("Both allocations must be locked first.");
    if (this.clients.length !== this.playersPerTeam * 2) throw new Error(`All ${this.playersPerTeam * 2} players must be connected to start.`);
    if (this.countTeam("BLUE") !== this.playersPerTeam || this.countTeam("RED") !== this.playersPerTeam) throw new Error(`Each crew needs exactly ${this.playersPerTeam} player${this.playersPerTeam === 1 ? "" : "s"} to start.`);
    if (!this.captainIds.BLUE || !this.captainIds.RED) throw new Error("Both crews need a captain to start.");
    if ([...this.players.values()].some((candidate) => !candidate.ready)) throw new Error("Every player must be ready before the host can start.");
    if ([...this.players.values()].some((candidate) => candidate.startingPoints === undefined || candidate.startingPoints < GAME_RULES.minimumStartingPointsPerPlayer)) {
      throw new Error("Every player must start with at least 500 points.");
    }
    this.phase = "COUNTDOWN";
    this.countdownDeadline = performance.now() + GAME_RULES.countdownSeconds * 1_000;
    this.lock();
  }

  private cancelCountdown(player: ServerPlayer): void {
    if (player.id !== this.hostPlayerId) throw new Error("Only the host can cancel the countdown.");
    if (this.phase !== "COUNTDOWN") throw new Error("There is no countdown to cancel.");
    this.phase = "LOBBY";
    this.countdownDeadline = undefined;
    this.resetReadyState();
    this.unlock();
  }

  private resetReadyState(): void { for (const player of this.players.values()) player.ready = false; }

  private scheduleCaptainReassignment(disconnected: ServerPlayer): void {
    const prior = this.captainReassignTimers[disconnected.teamId];
    if (prior) clearTimeout(prior);
    this.captainReassignTimers[disconnected.teamId] = setTimeout(() => {
      if (this.captainIds[disconnected.teamId] !== disconnected.id || disconnected.connected) return;
      this.captainIds[disconnected.teamId] = [...this.players.values()]
        .filter((candidate) => candidate.connected && candidate.teamId === disconnected.teamId)
        .sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;
      this.captainReassignTimers[disconnected.teamId] = undefined;
      this.sendLobbySnapshots();
    }, 15_000);
  }

  private voiceCredentialFor(player: ServerPlayer): string {
    const roomName = `${this.roomId}:round-${this.roundNumber}:${player.teamId}`;
    if (player.voiceCredential && player.voiceCredentialExpiresAt > Date.now() + 30_000 && player.voiceCredentialRoomName === roomName) return player.voiceCredential;
    const expiresAt = Date.now() + VOICE_CREDENTIAL_TTL_SECONDS * 1_000;
    const payload = Buffer.from(JSON.stringify({ roomCode: this.roomId, playerId: player.id, roundNumber: this.roundNumber, expiresAt })).toString("base64url");
    const signature = createHmac("sha256", VOICE_CREDENTIAL_SECRET).update(payload).digest("base64url");
    player.voiceCredential = `${payload}.${signature}`;
    player.voiceCredentialExpiresAt = expiresAt;
    player.voiceCredentialRoomName = roomName;
    return player.voiceCredential;
  }
  private resetAllocation(): void {
    this.allocationComplete = false;
    this.allocationLocked.BLUE = false;
    this.allocationLocked.RED = false;
    for (const player of this.players.values()) player.startingPoints = undefined;
  }
  private countTeam(teamId: TeamId): number { return [...this.players.values()].filter((player) => player.teamId === teamId).length; }

  private step(dt: number): void {
    if (this.phase === "COUNTDOWN") {
      if (this.countdownDeadline !== undefined && performance.now() >= this.countdownDeadline) {
        this.startMatch();
        return;
      }
      this.sendLobbySnapshots();
      return;
    }
    if (this.phase === "PLAYING") this.simulate(dt);
    else if (this.phase !== "RESULTS") this.sendLobbySnapshots();
  }

  private startMatch(): void {
    this.roundNumber += 1;
    this.gameEventSequence = 0;
    this.phase = "PLAYING";
    this.countdownDeadline = undefined;
    const now = performance.now();
    this.matchDeadline = now + GAME_RULES.matchDurationSeconds * 1_000;
    this.pickups = generatePickupLocations(this.roomId.split("").reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619), 2166136261));
    this.activeContactPairs.clear();
    this.poleHolders.BLUE = undefined;
    this.poleHolders.RED = undefined;
    this.resultWinnerOverride = null;
    this.activeRaids.BLUE = undefined;
    this.activeRaids.RED = undefined;
    this.raidCooldownUntil.BLUE = 0;
    this.raidCooldownUntil.RED = 0;
    this.resetPositions();
    for (const player of this.players.values()) {
      player.points = player.startingPoints ?? 0;
      player.status = "ACTIVE";
      player.inactiveUntil = 0;
      player.frozenUntil = 0;
      player.dx = 0; player.dy = 0; player.lastSequence = -1; player.lastAppliedSequence = -1;
      player.pendingMoves.length = 0; player.linkedPlayerId = undefined;
      player.pickupsCollected = 0; player.battlesWon = 0; player.raidsCompleted = 0;
    }
    this.sendLobbySnapshots(true);
    this.sendSnapshots();
  }

  private simulate(dt: number): void {
    const now = performance.now();
    if (this.matchDeadline !== undefined && now >= this.matchDeadline) {
      this.finishMatch();
      return;
    }
    for (const player of [...this.players.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      movePlayer(player, dt, this.poleHolders, now);
    }
    this.validateLinks();
    this.rearmPlayers(now);
    this.reconcilePoleHolders();
    this.collectPickups();
    this.advanceRaids(now);
    this.resolveContacts();
    this.finishIfTeamEliminated();
    this.sendSnapshots();
  }

  private resetPositions(): void {
    for (const teamId of ["BLUE", "RED"] as const) {
      const teammates = [...this.players.values()].filter((player) => player.teamId === teamId).sort((a, b) => a.joinOrder - b.joinOrder);
      teammates.forEach((player, index) => {
        player.x = TEAM_SPAWNS[teamId].x;
        player.y = TEAM_SPAWNS[teamId].y + index * TEAM_SPAWN_SPACING;
      });
    }
  }

  private startLink(player: ServerPlayer, teammateId: string): void {
    startLinkSystem(player, this.findById(teammateId), (first, second) => this.withinLinkRange(first, second));
  }

  private breakLink(player: ServerPlayer): void {
    breakLinkSystem(player, (id) => this.findById(id));
  }

  private validateLinks(): void {
    validateLinks(this.players.values(), (id) => this.findById(id), (first, second) => this.withinLinkRange(first, second));
  }

  private withinLinkRange(first: ServerPlayer, second: ServerPlayer): boolean {
    return withinLinkRange(first, second);
  }

  private setInteraction(player: ServerPlayer, active: boolean): void {
    const existing = this.activeRaids[player.teamId];
    setRaid(player, active, this.activeRaids, this.raidCooldownUntil, performance.now(),
      (candidate, teamId) => this.isInsideBase(candidate, TEAM_BASES[teamId]));
    const current = this.activeRaids[player.teamId];
    if (!existing && current?.playerId === player.id) this.emitRaidFeedback(player, "STARTED");
    if (!active && existing?.playerId === player.id && !current) this.emitRaidFeedback(player, "INTERRUPTED");
  }

  private advanceRaids(now: number): void {
    const resolutions = advanceRaidsSystem(this.activeRaids, this.raidCooldownUntil, now, (id) => this.findById(id),
      (candidate, teamId) => this.isInsideBase(candidate, TEAM_BASES[teamId]));
    for (const resolution of resolutions) {
      const raider = this.findById(resolution.playerId);
      if (raider) this.emitRaidFeedback(raider, resolution.stage);
    }
  }

  private cancelRaidFor(playerId: string): void {
    const raid = (["BLUE", "RED"] as const).map((teamId) => ({ teamId, raid: this.activeRaids[teamId] }))
      .find(({ raid: active }) => active?.playerId === playerId);
    const raider = raid ? this.findById(playerId) : undefined;
    if (raid && raider) this.emitRaidFeedback(raider, "INTERRUPTED");
    cancelRaid(playerId, this.activeRaids);
  }

  private collectPickups(): void {
    const result = collectPickups(this.players.values(), this.pickups);
    this.pickups = result.remainingPickups;
    for (const event of result.collections) {
      const player = this.findById(event.playerId);
      if (!player) continue;
      player.points += event.points;
      player.pickupsCollected += 1;
    }
  }

  private rearmPlayers(now = performance.now()): void {
    rearmPlayersSystem(this.players.values(), now);
  }

  private reconcilePoleHolders(): void {
    reconcilePoleHoldersSystem(this.players.values(), this.poleHolders, (id) => this.findById(id));
  }

  private resolveContacts(): void {
    const players = [...this.players.values()].filter((player) => player.status !== "DISCONNECTED").sort((a, b) => a.id.localeCompare(b.id));
    const currentContacts = new Set<string>();
    const resolvedGroupPairs = new Set<string>();
    for (let firstIndex = 0; firstIndex < players.length; firstIndex += 1) {
      const first = players[firstIndex]!;
      for (let secondIndex = firstIndex + 1; secondIndex < players.length; secondIndex += 1) {
        const second = players[secondIndex]!;
        if (first.teamId === second.teamId || Math.hypot(first.x - second.x, first.y - second.y) > PLAYER_RADIUS * 2) continue;
        const contactKey = this.pairKey(first.id, second.id);
        currentContacts.add(contactKey);
        if (this.activeContactPairs.has(contactKey)) continue;
        const resolution = resolveContact(first, second, this.poleHolders, (id) => this.findById(id));
        if (resolution.kind === "ELIMINATE_ATTACKER") {
          const attacker = resolution.attacker;
          const holder = resolution.holder;
          this.eliminatePlayer(resolution.attacker);
          this.sendGameEvent({
            type: "poleElimination",
            eventId: this.nextGameEventId(),
            attacker: { playerId: attacker.id, teamId: attacker.teamId, x: attacker.x, y: attacker.y },
            holder: { playerId: holder.id, teamId: holder.teamId, x: holder.x, y: holder.y },
          }, [attacker.id, holder.id]);
          continue;
        }
        if (resolution.kind === "FREEZE_PLAYER") {
          freezeMovementSystem(resolution.frozenPlayer, performance.now());
          continue;
        }
        if (resolution.kind !== "BATTLE") continue;
        const { firstGroup, secondGroup } = resolution;
        const matchupKey = [firstGroup.map((p) => p.id).sort().join(","), secondGroup.map((p) => p.id).sort().join(",")].sort().join("|");
        if (resolvedGroupPairs.has(matchupKey)) continue;
        resolvedGroupPairs.add(matchupKey);
        this.resolveBattle(firstGroup, secondGroup);
      }
    }
    this.activeContactPairs.clear();
    for (const key of currentContacts) this.activeContactPairs.add(key);
  }

  private resolveBattle(firstGroup: ServerPlayer[], secondGroup: ServerPlayer[]): void {
    const now = performance.now();
    const settlement = settleGroups(firstGroup, secondGroup, GAME_RULES.battleTransfer);
    for (const [id, points] of Object.entries(settlement.winnerPoints)) this.findById(id)!.points += points;
    for (const [id, points] of Object.entries(settlement.loserPoints)) this.findById(id)!.points -= points;
    if (!settlement.tied) for (const id of settlement.winnerIds) this.findById(id)!.battlesWon += 1;
    const winners = new Set(settlement.winnerIds);
    const participants = [...firstGroup, ...secondGroup];
    const eventParticipants: Extract<GameEvent, { type: "battleResolved" }> ["participants"] = [];
    for (const participant of participants) {
      if (participant.points <= 0) {
        this.eliminatePlayer(participant);
      } else {
        this.makeInactive(participant, now);
      }
      eventParticipants.push({
        playerId: participant.id,
        teamId: participant.teamId,
        x: participant.x,
        y: participant.y,
        outcome: participant.status === "ELIMINATED" ? "ELIMINATED" : settlement.tied ? "TIE" : winners.has(participant.id) ? "WIN" : "LOSS",
      });
    }
    this.sendGameEvent({ type: "battleResolved", eventId: this.nextGameEventId(), participants: eventParticipants }, participants.map(({ id }) => id));
  }

  private makeInactive(player: ServerPlayer, now: number): void {
    this.cancelRaidFor(player.id);
    makeInactiveSystem(player, now, (id) => this.findById(id), this.activeRaids, this.poleHolders);
  }

  private eliminatePlayer(player: ServerPlayer): void {
    this.cancelRaidFor(player.id);
    eliminatePlayerSystem(player, (id) => this.findById(id), this.activeRaids, this.poleHolders);
  }

  private emitRaidFeedback(player: ServerPlayer, stage: "STARTED" | "INTERRUPTED" | "COMPLETED"): void {
    this.sendGameEvent({
      type: "raidFeedback",
      eventId: this.nextGameEventId(),
      stage,
      raiderPlayerId: player.id,
      teamId: player.teamId,
      baseTeamId: opponentTeam(player.teamId),
    }, [player.id]);
  }

  private sendGameEvent(event: GameEvent, recipientIds: readonly string[]): void {
    const payload = gameEventSchema.parse(event);
    const recipients = new Set(recipientIds);
    for (const client of this.clients) {
      const player = this.players.get(client.sessionId);
      if (player && recipients.has(player.id)) client.send("gameEvent", payload);
    }
  }

  private nextGameEventId(): string {
    this.gameEventSequence += 1;
    return `${this.roundNumber}:${this.gameEventSequence}`;
  }

  private finishIfTeamEliminated(): void {
    const winner = eliminatedTeamWinner(this.players.values());
    if (winner) this.finishMatch(winner);
  }

  private finishMatch(winnerOverride: TeamId | null = null): void {
    this.phase = "RESULTS";
    this.resultWinnerOverride = winnerOverride;
    this.matchDeadline = undefined;
    for (const teamId of ["BLUE", "RED"] as const) {
      const raid = this.activeRaids[teamId];
      const raider = raid ? this.findById(raid.playerId) : undefined;
      if (raider) this.emitRaidFeedback(raider, "INTERRUPTED");
      this.activeRaids[teamId] = undefined;
    }
    for (const player of this.players.values()) { player.dx = 0; player.dy = 0; }
    this.sendSnapshots();
  }

  private rematch(player: ServerPlayer): void {
    if (player.id !== this.hostPlayerId) throw new Error("Only the host can start a rematch.");
    this.phase = "LOBBY";
    this.matchDeadline = undefined;
    this.pickups = [];
    this.activeContactPairs.clear();
    this.poleHolders.BLUE = undefined;
    this.poleHolders.RED = undefined;
    this.resultWinnerOverride = null;
    this.activeRaids.BLUE = undefined; this.activeRaids.RED = undefined;
    this.raidCooldownUntil.BLUE = 0; this.raidCooldownUntil.RED = 0;
    this.allocationComplete = false;
    this.allocationLocked.BLUE = false; this.allocationLocked.RED = false;
    purgeDisconnectedPlayersForRematch(this.players, performance.now());
    for (const teamId of ["BLUE", "RED"] as const) {
      const captain = this.findById(this.captainIds[teamId] ?? "");
      if (!captain?.connected) this.captainIds[teamId] = undefined;
    }
    if (!this.findById(this.hostPlayerId ?? "")?.connected) this.hostPlayerId = oldestConnectedPlayerId(this.players.values());
    this.resetPositions();
    for (const member of this.players.values()) {
      if (member.connected) member.status = "ACTIVE";
      else {
        member.status = "DISCONNECTED";
        member.statusBeforeDisconnect = "ACTIVE";
      }
      member.points = 0; member.startingPoints = undefined;
      member.inactiveUntil = 0; member.frozenUntil = 0; member.lastSequence = -1; member.lastAppliedSequence = -1; member.pendingMoves.length = 0;
      member.linkedPlayerId = undefined; member.ready = false; member.dx = 0; member.dy = 0;
      member.pickupsCollected = 0; member.battlesWon = 0; member.raidsCompleted = 0;
    }
    this.sendLobbySnapshots();
  }

  private isInsideBase(player: ServerPlayer, base: { x: number; y: number; width: number; height: number }): boolean {
    return player.x >= base.x && player.x <= base.x + base.width && player.y >= base.y && player.y <= base.y + base.height;
  }

  private findById(id: string): ServerPlayer | undefined { return [...this.players.values()].find((player) => player.id === id); }
  private pairKey(first: string, second: string): string { return [first, second].sort().join("|"); }

  private sendLobbySnapshots(force = false): void {
    if (!force && (this.phase === "PLAYING" || this.phase === "RESULTS")) return;
    const connectedPlayerCount = countConnectedPlayers(this.players.values());
    for (const client of this.clients) {
      const self = this.players.get(client.sessionId);
      if (!self || !this.hostPlayerId) continue;
      const teammates = [...this.players.values()].filter((candidate) => candidate.teamId === self.teamId);
      const players: LobbyPlayer[] = [...this.players.values()].map((candidate) => ({
        id: candidate.id, nickname: candidate.nickname, teamId: candidate.teamId, ready: candidate.ready, connected: candidate.connected,
        isHost: candidate.id === this.hostPlayerId, isCaptain: this.captainIds[candidate.teamId] === candidate.id,
        ...(candidate.teamId === self.teamId && candidate.startingPoints !== undefined ? { startingPoints: candidate.startingPoints } : {}),
      }));
      client.send("lobbySnapshot", lobbySnapshotSchema.parse({
        roomCode: this.roomId, roomMode: this.roomMode, teamSize: this.playersPerTeam, phase: this.phase, selfPlayerId: self.id, voiceCredential: this.voiceCredentialFor(self), voiceRoomName: `${this.roomId}:round-${this.roundNumber}:${self.teamId}`, hostPlayerId: this.hostPlayerId,
        connectedPlayerCount, players,
        captainIds: { BLUE: this.captainIds.BLUE ?? null, RED: this.captainIds.RED ?? null },
        ownTeamAllocation: teammates.map((teammate) => ({ playerId: teammate.id, points: teammate.startingPoints ?? null })),
        ownTeamLocked: this.allocationLocked[self.teamId], allocationComplete: this.allocationComplete,
        countdownSecondsRemaining: this.countdownDeadline === undefined ? null : remainingSeconds(this.countdownDeadline, performance.now()),
      }));
    }
  }

  private sendSnapshots(): void {
    const now = performance.now();
    const connectedPlayerCount = countConnectedPlayers(this.players.values());
    for (const client of this.clients) {
      const self = this.players.get(client.sessionId);
      if (!self) continue;
      const ownRaid = this.activeRaids[self.teamId];
      const snapshot = projectSnapshot({
        phase: this.phase === "RESULTS" ? "RESULTS" : "PLAYING",
        teamSize: this.playersPerTeam,
        ...(this.hostPlayerId ? { hostPlayerId: this.hostPlayerId } : {}),
        self,
        players: [...this.players.values()],
        connectedPlayerCount,
        serverTime: Date.now(),
        now,
        remainingSeconds: this.phase === "RESULTS" || this.matchDeadline === undefined ? 0 : remainingSeconds(this.matchDeadline, now),
        pickups: this.pickups,
        raidStartedAt: ownRaid?.playerId === self.id ? ownRaid.startedAt : undefined,
        raidCooldownUntil: this.raidCooldownUntil[self.teamId],
        poleHolders: this.poleHolders,
        winnerOverride: this.resultWinnerOverride,
      });
      client.send("snapshot", roomSnapshotSchema.parse(snapshot));
    }
  }
}
