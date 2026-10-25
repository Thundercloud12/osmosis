import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { Room, ServerError, matchMaker, type Client } from "colyseus";
import {
  ARENA_CONFIG,
  ARENA_OBSTACLES,
  GAME_RULES,
  MOVEMENT_CONFIG,
  TEAM_BASES,
  clientCommandSchema,
  generatePickupLocations,
  hasLineOfSight,
  lobbySnapshotSchema,
  remainingSeconds,
  roomSnapshotSchema,
  settleBattle,
  type LobbyPlayer,
  type PlayerSnapshot,
  type TeamId,
} from "@osmosis/shared";

type PlayerStatus = "ACTIVE" | "INACTIVE" | "DISCONNECTED";
interface ServerPlayer {
  id: string;
  nickname: string;
  teamId: TeamId;
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  lastSequence: number;
  ready: boolean;
  joinOrder: number;
  startingPoints: number | undefined;
  points: number;
  status: PlayerStatus;
  connected: boolean;
  statusBeforeDisconnect: PlayerStatus | undefined;
  linkedPlayerId: string | undefined;
  voiceCredential: string | undefined;
  voiceCredentialExpiresAt: number;
  voiceCredentialRoomName: string | undefined;
  pickupsCollected: number;
  battlesWon: number;
  raidsCompleted: number;
}
interface Pickup { id: string; x: number; y: number }
interface ActiveRaid { playerId: string; startedAt: number }

const PLAYER_RADIUS = MOVEMENT_CONFIG.playerRadius;
const PICKUP_RADIUS = 16;
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

export const activeArenaRooms = new Map<string, ArenaRoom>();

export class ArenaRoom extends Room {
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
  private readonly activeRaids: Record<TeamId, ActiveRaid | undefined> = { BLUE: undefined, RED: undefined };
  private readonly raidCooldownUntil: Record<TeamId, number> = { BLUE: 0, RED: 0 };
  private pickups: Pickup[] = [];
  private roundNumber = 0;
  private readonly captainReassignTimers: Record<TeamId, ReturnType<typeof setTimeout> | undefined> = { BLUE: undefined, RED: undefined };

  override async onCreate(): Promise<void> {
    this.roomId = await this.generateRoomCode();
    activeArenaRooms.set(this.roomId, this);
    this.maxClients = 10;
    this.maxMessagesPerSecond = 30;
    await this.setPrivate();
    this.setFixedTimestep((context) => this.step(context.dt), GAME_RULES.simulationHz);
    this.onMessage("move", (client, payload: unknown) => this.receiveMove(client, payload));
    this.onMessage("command", (client, payload: unknown) => this.receiveCommand(client, payload));
  }

  override onAuth(_client: Client, _options: unknown): boolean {
    if (this.phase !== "LOBBY") throw new ServerError(400, "This room is no longer accepting players.");
    return true;
  }

  override async onDrop(client: Client): Promise<void> {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    player.statusBeforeDisconnect = player.status;
    player.status = "DISCONNECTED";
    player.dx = 0;
    player.dy = 0;
    player.ready = false;
    this.breakLink(player);
    this.cancelRaidFor(player.id);
    if (this.phase === "COUNTDOWN") {
      this.phase = "LOBBY";
      this.countdownDeadline = undefined;
      this.resetReadyState();
      this.unlock();
    }
    if (this.hostPlayerId === player.id) {
      this.hostPlayerId = [...this.players.values()]
        .filter((candidate) => candidate.connected && candidate.id !== player.id)
        .sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;
    }
    if (this.captainIds[player.teamId] === player.id && this.phase !== "PLAYING" && this.phase !== "RESULTS") {
      this.scheduleCaptainReassignment(player);
    }
    if (this.phase === "PLAYING" || this.phase === "RESULTS") this.sendSnapshots();
    else this.sendLobbySnapshots();
    try {
      await this.allowReconnection(client, GAME_RULES.reconnectGraceSeconds);
    } catch {
      if (this.players.has(client.sessionId)) this.onLeave(client);
    }
  }

  override onReconnect(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.connected = true;
    player.status = player.statusBeforeDisconnect ?? "ACTIVE";
    player.statusBeforeDisconnect = undefined;
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

  authorizeVoiceCredential(credential: string): VoiceIdentity | undefined {
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
      roomName: `${this.roomId}:round-${this.roundNumber}:${player.teamId}`,
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
    const base = TEAM_BASES[teamId];
    const player: ServerPlayer = {
      id: crypto.randomUUID(), nickname, teamId,
      x: base.x + base.width / 2, y: base.y + 65 + Math.min(blueCount, redCount) * 65,
      dx: 0, dy: 0, lastSequence: -1, ready: false, joinOrder: this.joinOrder++,
      startingPoints: undefined, points: 0, status: "ACTIVE", linkedPlayerId: undefined,
      connected: true, statusBeforeDisconnect: undefined, voiceCredential: undefined, voiceCredentialExpiresAt: 0, voiceCredentialRoomName: undefined,
      pickupsCollected: 0, battlesWon: 0, raidsCompleted: 0,
    };
    this.players.set(client.sessionId, player);
    this.hostPlayerId ??= player.id;
    this.sendLobbySnapshots();
  }

  override onLeave(client: Client): void {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    if (this.phase === "PLAYING" || this.phase === "RESULTS") {
      player.status = "DISCONNECTED";
      player.dx = 0;
      player.dy = 0;
      this.breakLink(player);
      this.cancelRaidFor(player.id);
      if (this.phase === "PLAYING") this.sendSnapshots();
      return;
    }

    this.players.delete(client.sessionId);
    if (this.captainIds[player.teamId] === player.id) this.captainIds[player.teamId] = undefined;
    if (this.hostPlayerId === player.id) {
      this.hostPlayerId = [...this.players.values()].sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;
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
    if (!player || player.status === "DISCONNECTED" || !parsed.success || parsed.data.type !== "move") return;
    if (parsed.data.seq <= player.lastSequence) return;
    player.lastSequence = parsed.data.seq;
    player.dx = parsed.data.dx;
    player.dy = parsed.data.dy;
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
    if (this.countTeam(teamId) >= GAME_RULES.teamSize) throw new Error("That crew is full.");
    if (this.captainIds[player.teamId] === player.id) this.captainIds[player.teamId] = undefined;
    player.teamId = teamId;
    const base = TEAM_BASES[teamId];
    const slot = this.countTeam(teamId) - 1;
    player.x = base.x + base.width / 2;
    player.y = base.y + 65 + Math.max(0, slot) * 65;
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
    if (this.countTeam("BLUE") !== GAME_RULES.teamSize || this.countTeam("RED") !== GAME_RULES.teamSize) {
      throw new Error("Both crews need five players before allocation can begin.");
    }
    if (!this.captainIds.BLUE || !this.captainIds.RED) throw new Error("Choose one captain for each crew first.");
    this.phase = "ALLOCATION";
    this.allocationLocked.BLUE = false;
    this.allocationLocked.RED = false;
    for (const teammate of this.players.values()) teammate.startingPoints = GAME_RULES.startingTeamPoints / GAME_RULES.teamSize;
  }

  private allocatePoints(player: ServerPlayer, pointsByPlayerId: Record<string, number>): void {
    if (this.phase !== "ALLOCATION") throw new Error("Point allocation is not open.");
    if (this.captainIds[player.teamId] !== player.id) throw new Error("Only your crew captain can edit these points.");
    if (this.allocationLocked[player.teamId]) throw new Error("Your crew's allocation is locked.");
    const teammates = [...this.players.values()].filter((candidate) => candidate.teamId === player.teamId);
    const playerIds = new Set(teammates.map((teammate) => teammate.id));
    const entries = Object.entries(pointsByPlayerId);
    const shapeValid = entries.length === GAME_RULES.teamSize && entries.every(([id]) => playerIds.has(id));
    const total = entries.reduce((sum, [, points]) => sum + points, 0);
    const valuesValid = entries.every(([, points]) => Number.isInteger(points) && points >= 0 && points % GAME_RULES.allocationIncrement === 0);
    if (!shapeValid || !valuesValid || total !== GAME_RULES.startingTeamPoints) {
      throw new Error("Allocate exactly 10,000 points in 100 point increments across your five players.");
    }
    for (const teammate of teammates) teammate.startingPoints = pointsByPlayerId[teammate.id]!;
  }

  private lockTeamAllocation(player: ServerPlayer): void {
    if (this.phase !== "ALLOCATION") throw new Error("Point allocation is not open.");
    if (this.captainIds[player.teamId] !== player.id) throw new Error("Only your crew captain can lock the allocation.");
    if (this.allocationLocked[player.teamId]) return;
    const teammates = [...this.players.values()].filter((candidate) => candidate.teamId === player.teamId);
    const values = teammates.map((teammate) => teammate.startingPoints);
    if (values.some((points) => points === undefined) || values.reduce<number>((sum, points) => sum + (points ?? 0), 0) !== GAME_RULES.startingTeamPoints) {
      throw new Error("Your allocation must total exactly 10,000 points before locking.");
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
    if (this.clients.length !== GAME_RULES.teamSize * 2) throw new Error("All ten players must be connected to start.");
    if (this.countTeam("BLUE") !== GAME_RULES.teamSize || this.countTeam("RED") !== GAME_RULES.teamSize) throw new Error("Each crew needs exactly five players to start.");
    if (!this.captainIds.BLUE || !this.captainIds.RED) throw new Error("Both crews need a captain to start.");
    if ([...this.players.values()].some((candidate) => !candidate.ready)) throw new Error("Every player must be ready before the host can start.");
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
    this.phase = "PLAYING";
    this.countdownDeadline = undefined;
    const now = performance.now();
    this.matchDeadline = now + GAME_RULES.matchDurationSeconds * 1_000;
    this.pickups = generatePickupLocations(this.roomId.split("").reduce((seed, char) => Math.imul(seed ^ char.charCodeAt(0), 16777619), 2166136261));
    this.activeContactPairs.clear();
    this.activeRaids.BLUE = undefined;
    this.activeRaids.RED = undefined;
    this.raidCooldownUntil.BLUE = 0;
    this.raidCooldownUntil.RED = 0;
    this.resetPositions();
    for (const player of this.players.values()) {
      player.points = player.startingPoints ?? 0;
      player.status = "ACTIVE";
      player.dx = 0; player.dy = 0; player.linkedPlayerId = undefined;
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
    for (const player of this.players.values()) {
      if (player.status === "DISCONNECTED") continue;
      const magnitude = Math.hypot(player.dx, player.dy);
      if (magnitude > 0) {
        const distance = (MOVEMENT_CONFIG.speed * dt) / magnitude;
        const nextX = player.x + player.dx * distance;
        if (this.isPositionFree(nextX, player.y)) player.x = nextX;
        const nextY = player.y + player.dy * distance;
        if (this.isPositionFree(player.x, nextY)) player.y = nextY;
      }
    }
    this.validateLinks();
    this.rearmPlayers();
    this.collectPickups();
    this.advanceRaids(now);
    this.resolveContacts();
    this.sendSnapshots();
  }

  private resetPositions(): void {
    for (const teamId of ["BLUE", "RED"] as const) {
      const base = TEAM_BASES[teamId];
      const teammates = [...this.players.values()].filter((player) => player.teamId === teamId).sort((a, b) => a.joinOrder - b.joinOrder);
      teammates.forEach((player, index) => { player.x = base.x + base.width / 2; player.y = base.y + 65 + index * 65; });
    }
  }

  private startLink(player: ServerPlayer, teammateId: string): void {
    const teammate = this.findById(teammateId);
    if (!teammate || teammate.id === player.id || player.status !== "ACTIVE" || teammate.status !== "ACTIVE") throw new Error("Both crewmates must be active to link.");
    if (teammate.teamId !== player.teamId) throw new Error("You can only link with your own crew.");
    if (player.linkedPlayerId || teammate.linkedPlayerId) throw new Error("A linked crewmate can only have one link.");
    if (!this.withinLinkRange(player, teammate)) throw new Error("Move closer and keep a clear line of sight to link.");
    player.linkedPlayerId = teammate.id;
    teammate.linkedPlayerId = player.id;
  }

  private breakLink(player: ServerPlayer): void {
    const linked = player.linkedPlayerId ? this.findById(player.linkedPlayerId) : undefined;
    player.linkedPlayerId = undefined;
    if (linked?.linkedPlayerId === player.id) linked.linkedPlayerId = undefined;
  }

  private validateLinks(): void {
    for (const player of this.players.values()) {
      if (!player.linkedPlayerId) continue;
      const linked = this.findById(player.linkedPlayerId);
      if (!linked || player.id > linked.id || player.status !== "ACTIVE" || linked.status !== "ACTIVE" || !this.withinLinkRange(player, linked)) this.breakLink(player);
    }
  }

  private withinLinkRange(first: ServerPlayer, second: ServerPlayer): boolean {
    return Math.hypot(first.x - second.x, first.y - second.y) <= MOVEMENT_CONFIG.linkRadius && hasLineOfSight(first, second);
  }

  private setInteraction(player: ServerPlayer, active: boolean): void {
    const enemyTeam: TeamId = player.teamId === "BLUE" ? "RED" : "BLUE";
    const raid = this.activeRaids[player.teamId];
    if (!active) {
      if (raid?.playerId === player.id) this.activeRaids[player.teamId] = undefined;
      return;
    }
    if (player.status !== "ACTIVE") throw new Error("Only active players can start a base raid.");
    if (this.activeRaids[player.teamId]) throw new Error("Your crew already has an active raid.");
    if (performance.now() < this.raidCooldownUntil[player.teamId]) throw new Error("Your crew's raid is cooling down.");
    if (!this.isInsideBase(player, TEAM_BASES[enemyTeam])) throw new Error("Move inside the enemy base to start a raid.");
    this.activeRaids[player.teamId] = { playerId: player.id, startedAt: performance.now() };
  }

  private advanceRaids(now: number): void {
    for (const teamId of ["BLUE", "RED"] as const) {
      const raid = this.activeRaids[teamId];
      if (!raid) continue;
      const raider = this.findById(raid.playerId);
      const enemyTeam: TeamId = teamId === "BLUE" ? "RED" : "BLUE";
      if (!raider || raider.status !== "ACTIVE" || !this.isInsideBase(raider, TEAM_BASES[enemyTeam])) {
        this.activeRaids[teamId] = undefined;
        continue;
      }
      if (now - raid.startedAt >= GAME_RULES.raidChannelSeconds * 1_000) {
        raider.points += GAME_RULES.raidReward;
        raider.raidsCompleted += 1;
        this.raidCooldownUntil[teamId] = now + GAME_RULES.raidCooldownSeconds * 1_000;
        this.activeRaids[teamId] = undefined;
      }
    }
  }

  private cancelRaidFor(playerId: string): void {
    for (const teamId of ["BLUE", "RED"] as const) if (this.activeRaids[teamId]?.playerId === playerId) this.activeRaids[teamId] = undefined;
  }

  private collectPickups(): void {
    for (const player of [...this.players.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (player.status !== "ACTIVE") continue;
      const index = this.pickups.findIndex((pickup) => Math.hypot(player.x - pickup.x, player.y - pickup.y) <= PLAYER_RADIUS + PICKUP_RADIUS);
      if (index < 0) continue;
      this.pickups.splice(index, 1);
      player.points += GAME_RULES.pickupReward;
      player.pickupsCollected += 1;
    }
  }

  private rearmPlayers(): void {
    for (const player of this.players.values()) {
      if (player.status === "INACTIVE" && this.isInsideBase(player, TEAM_BASES[player.teamId])) player.status = "ACTIVE";
    }
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
        if (this.activeContactPairs.has(contactKey) || first.status !== "ACTIVE" || second.status !== "ACTIVE") continue;
        const firstGroup = this.combatGroup(first);
        const secondGroup = this.combatGroup(second);
        const matchupKey = [firstGroup.map((p) => p.id).sort().join(","), secondGroup.map((p) => p.id).sort().join(",")].sort().join("|");
        if (resolvedGroupPairs.has(matchupKey)) continue;
        resolvedGroupPairs.add(matchupKey);
        this.resolveBattle(first, second, firstGroup, secondGroup);
      }
    }
    this.activeContactPairs.clear();
    for (const key of currentContacts) this.activeContactPairs.add(key);
  }

  private resolveBattle(first: ServerPlayer, second: ServerPlayer, firstGroup: ServerPlayer[], secondGroup: ServerPlayer[]): void {
    const protectedDefender = [first, second].find((player) => this.isInsideBase(player, TEAM_BASES[player.teamId]));
    if (protectedDefender) {
      const attackerGroup = protectedDefender === first ? secondGroup : firstGroup;
      for (const attacker of attackerGroup) {
        attacker.status = "INACTIVE";
        attacker.dx = 0; attacker.dy = 0;
        this.breakLink(attacker);
        this.cancelRaidFor(attacker.id);
      }
      return;
    }
    const settlement = settleBattle(
      firstGroup.map((player) => ({ id: player.id, points: player.points })),
      secondGroup.map((player) => ({ id: player.id, points: player.points })),
      GAME_RULES.battleTransfer,
    );
    for (const [id, points] of Object.entries(settlement.winnerPoints)) this.findById(id)!.points += points;
    for (const [id, points] of Object.entries(settlement.loserPoints)) this.findById(id)!.points -= points;
    if (!settlement.tied) for (const id of settlement.winnerIds) this.findById(id)!.battlesWon += 1;
    for (const participant of [...firstGroup, ...secondGroup]) {
      participant.status = "INACTIVE";
      participant.dx = 0; participant.dy = 0;
      this.breakLink(participant);
      this.cancelRaidFor(participant.id);
    }
  }

  private combatGroup(player: ServerPlayer): ServerPlayer[] {
    const linked = player.linkedPlayerId ? this.findById(player.linkedPlayerId) : undefined;
    return linked?.status === "ACTIVE" ? [player, linked].sort((a, b) => a.id.localeCompare(b.id)) : [player];
  }

  private finishMatch(): void {
    this.phase = "RESULTS";
    this.matchDeadline = undefined;
    this.activeRaids.BLUE = undefined;
    this.activeRaids.RED = undefined;
    for (const player of this.players.values()) { player.dx = 0; player.dy = 0; }
    this.sendSnapshots();
  }

  private rematch(player: ServerPlayer): void {
    if (player.id !== this.hostPlayerId) throw new Error("Only the host can start a rematch.");
    this.phase = "LOBBY";
    this.matchDeadline = undefined;
    this.pickups = [];
    this.activeContactPairs.clear();
    this.activeRaids.BLUE = undefined; this.activeRaids.RED = undefined;
    this.raidCooldownUntil.BLUE = 0; this.raidCooldownUntil.RED = 0;
    this.allocationComplete = false;
    this.allocationLocked.BLUE = false; this.allocationLocked.RED = false;
    this.resetPositions();
    for (const member of this.players.values()) {
      member.status = "ACTIVE"; member.points = 0; member.startingPoints = undefined;
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

  private isPositionFree(x: number, y: number): boolean {
    if (x < PLAYER_RADIUS || y < PLAYER_RADIUS || x > ARENA_CONFIG.width - PLAYER_RADIUS || y > ARENA_CONFIG.height - PLAYER_RADIUS) return false;
    return ARENA_OBSTACLES.every((obstacle) => {
      const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
      const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
      const dx = x - nearestX; const dy = y - nearestY;
      return dx * dx + dy * dy >= PLAYER_RADIUS * PLAYER_RADIUS;
    });
  }

  private sendLobbySnapshots(force = false): void {
    if (!force && (this.phase === "PLAYING" || this.phase === "RESULTS")) return;
    const connectedPlayerCount = this.clients.length;
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
        roomCode: this.roomId, phase: this.phase, selfPlayerId: self.id, voiceCredential: this.voiceCredentialFor(self), voiceRoomName: `${this.roomId}:round-${this.roundNumber}:${self.teamId}`, hostPlayerId: this.hostPlayerId,
        connectedPlayerCount, players,
        captainIds: { BLUE: this.captainIds.BLUE ?? null, RED: this.captainIds.RED ?? null },
        ownTeamAllocation: teammates.map((teammate) => ({ playerId: teammate.id, points: teammate.startingPoints ?? null })),
        ownTeamLocked: this.allocationLocked[self.teamId], allocationComplete: this.allocationComplete,
        countdownSecondsRemaining: this.countdownDeadline === undefined ? null : remainingSeconds(this.countdownDeadline, performance.now()),
      }));
    }
  }

  private sendSnapshots(): void {
    const connectedPlayerCount = this.clients.length;
    const teamScores = {
      BLUE: [...this.players.values()].filter((player) => player.teamId === "BLUE").reduce((sum, player) => sum + player.points, 0),
      RED: [...this.players.values()].filter((player) => player.teamId === "RED").reduce((sum, player) => sum + player.points, 0),
    };
    const result = this.phase === "RESULTS" ? {
      winnerTeam: teamScores.BLUE === teamScores.RED ? null : teamScores.BLUE > teamScores.RED ? "BLUE" as const : "RED" as const,
      teamScores,
      players: [...this.players.values()].map((player) => ({
        id: player.id, nickname: player.nickname, teamId: player.teamId, points: player.points,
        pickupsCollected: player.pickupsCollected, battlesWon: player.battlesWon, raidsCompleted: player.raidsCompleted,
      })).sort((a, b) => b.points - a.points || a.id.localeCompare(b.id)),
    } : null;
    for (const client of this.clients) {
      const self = this.players.get(client.sessionId);
      if (!self) continue;
      const players: PlayerSnapshot[] = [];
      for (const candidate of this.players.values()) {
        const isSelfOrTeammate = candidate.id === self.id || candidate.teamId === self.teamId;
        const distance = Math.hypot(candidate.x - self.x, candidate.y - self.y);
        const isSpottedEnemy = candidate.teamId !== self.teamId && candidate.status !== "DISCONNECTED" && distance <= MOVEMENT_CONFIG.viewRadius && hasLineOfSight(self, candidate);
        if (!isSelfOrTeammate && !isSpottedEnemy) continue;
        players.push({
          id: candidate.id, nickname: candidate.nickname, teamId: candidate.teamId, status: candidate.status,
          x: candidate.x, y: candidate.y,
          ...(candidate.teamId === self.teamId ? { points: candidate.points } : {}),
          ...(candidate.teamId === self.teamId && candidate.linkedPlayerId ? { linkedPlayerId: candidate.linkedPlayerId } : {}),
        });
      }
      const ownRaid = this.activeRaids[self.teamId];
      const selfRaid = ownRaid?.playerId
        ? { progressSeconds: Math.min(GAME_RULES.raidChannelSeconds, (performance.now() - ownRaid.startedAt) / 1_000), cooldownSecondsRemaining: remainingSeconds(this.raidCooldownUntil[self.teamId], performance.now()) }
        : { progressSeconds: 0, cooldownSecondsRemaining: remainingSeconds(this.raidCooldownUntil[self.teamId], performance.now()) };
      client.send("snapshot", roomSnapshotSchema.parse({
        phase: this.phase === "RESULTS" ? "RESULTS" : "PLAYING",
        selfPlayerId: self.id, connectedPlayerCount, serverTime: Date.now(),
        remainingSeconds: this.phase === "RESULTS" || this.matchDeadline === undefined ? 0 : remainingSeconds(this.matchDeadline, performance.now()),
        players, teamScores, pickups: this.pickups, selfRaid, result,
      }));
    }
  }
}
