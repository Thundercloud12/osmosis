import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  ARENA_OBSTACLES,
  TEAM_BASES,
  gameEventSchema,
  lobbySnapshotSchema,
  roomSnapshotSchema,
  type LobbySnapshot,
  type RoomSnapshot,
  type TeamId,
  type GameEvent,
} from "@osmosis/shared";

import { matchMaker } from "@colyseus/core";
import { server } from "../app.config";
import { ArenaRoom, roomJoinLimiter } from "./ArenaRoom";

interface MutablePlayer {
  id: string;
  nickname: string;
  teamId: TeamId;
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  lastSequence: number;
  points: number;
  status: "ACTIVE" | "INACTIVE" | "ELIMINATED" | "DISCONNECTED";
  inactiveUntil: number;
  frozenUntil: number;
  linkedPlayerId: string | undefined;
  pickupsCollected: number;
  battlesWon: number;
  raidsCompleted: number;
  startingPoints: number | undefined;
}

interface MutableArenaRoom {
  players: Map<string, MutablePlayer>;
  phase: string;
  matchDeadline: number | undefined;
  pickups: Array<{ id: string; x: number; y: number }>;
  activeRaids: Record<TeamId, { playerId: string; startedAt: number } | undefined>;
  raidCooldownUntil: Record<TeamId, number>;
  poleHolders: Record<TeamId, string | undefined>;
  activeContactPairs: Set<string>;
  resolveContacts(): void;
  rearmPlayers(): void;
  startLink(player: MutablePlayer, teammateId: string): void;
  collectPickups(): void;
  setInteraction(player: MutablePlayer, active: boolean): void;
  advanceRaids(now: number): void;
  finishMatch(): void;
  simulate(dt: number): void;
  rematch(player: MutablePlayer): void;
  reconcilePoleHolders(): void;
  sendSnapshots(): void;
}

const gameClient = new Client("http://127.0.0.1:2568");

interface SnapshotClient {
  onMessage<Payload>(type: string, callback: (payload: Payload) => void): () => void;
}

function nextSnapshot(client: SnapshotClient, predicate: (snapshot: RoomSnapshot) => boolean = () => true): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for an arena snapshot"));
    }, 8_000);

    const unsubscribe = client.onMessage<unknown>("snapshot", (payload) => {
      const parsed = roomSnapshotSchema.safeParse(payload);
      if (!parsed.success || !predicate(parsed.data)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(parsed.data);
    });
  });
}

function nextLobbySnapshot(client: SnapshotClient): Promise<LobbySnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for a lobby snapshot"));
    }, 3_000);
    const unsubscribe = client.onMessage<unknown>("lobbySnapshot", (payload) => {
      const parsed = lobbySnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(parsed.data);
    });
  });
}

function nextCommandError(client: SnapshotClient): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Timed out waiting for a command rejection")); }, 3_000);
    const unsubscribe = client.onMessage<unknown>("commandError", (payload) => {
      if (typeof payload !== "object" || payload === null || !("message" in payload) || typeof payload.message !== "string") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload.message);
    });
  });
}

function nextReportAccepted(client: SnapshotClient): Promise<{ targetPlayerId: string; message: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Timed out waiting for report acceptance")); }, 3_000);
    const unsubscribe = client.onMessage<unknown>("reportAccepted", (payload) => {
      if (typeof payload !== "object" || payload === null || !("targetPlayerId" in payload)
        || typeof payload.targetPlayerId !== "string" || !("message" in payload) || typeof payload.message !== "string") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve({ targetPlayerId: payload.targetPlayerId, message: payload.message });
    });
  });
}

function nextGameEvent(client: SnapshotClient, predicate: (event: GameEvent) => boolean = () => true): Promise<GameEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Timed out waiting for a game feedback event")); }, 3_000);
    const unsubscribe = client.onMessage<unknown>("gameEvent", (payload) => {
      const parsed = gameEventSchema.safeParse(payload);
      if (!parsed.success || !predicate(parsed.data)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(parsed.data);
    });
  });
}

function lobbyUntil(client: SnapshotClient, predicate: (snapshot: LobbySnapshot) => boolean): Promise<LobbySnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the expected lobby state"));
    }, 3_000);
    const unsubscribe = client.onMessage<unknown>("lobbySnapshot", (payload) => {
      const parsed = lobbySnapshotSchema.safeParse(payload);
      if (!parsed.success || !predicate(parsed.data)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(parsed.data);
    });
  });
}

describe("M3 lobby and multiplayer arena", () => {
  beforeAll(async () => {
    await server.listen(2568);
  });

  beforeEach(() => roomJoinLimiter.clear());

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it("reserves a dropped seat for 120 seconds and restores its identity without reclaiming the host role", async () => {
    const clients: Room[] = [];
    let reconnected: Room | undefined;
    try {
      const first = await gameClient.create("arena", { nickname: "Returning Crew", roomMode: "TEST_1V1" });
      clients.push(first);
      const second = await gameClient.joinById(first.roomId, { nickname: "New Host" });
      clients.push(second);
      const room = matchMaker.getLocalRoomById(first.roomId) as ArenaRoom;
      const internals = room as unknown as {
        players: Map<string, { id: string; points: number; connected: boolean; status: string; reconnectUntil?: number }>;
        hostPlayerId: string | undefined;
        phase: string;
        matchDeadline: number | undefined;
      };
      const playerBeforeDrop = internals.players.get(first.sessionId)!;
      const secondPlayer = internals.players.get(second.sessionId)!;
      const originalPlayerId = playerBeforeDrop.id;
      playerBeforeDrop.points = 8_765;
      internals.phase = "PLAYING";
      internals.matchDeadline = performance.now() + 60_000;
      expect(internals.hostPlayerId).toBe(originalPlayerId);

      const disconnectedSnapshot = nextSnapshot(second as unknown as SnapshotClient, (snapshot) =>
        snapshot.connectedPlayerCount === 1 && snapshot.hostPlayerId === secondPlayer.id,
      );
      const token = first.reconnectionToken;
      first.reconnection.enabled = false;
      first.connection.close(4010);
      await disconnectedSnapshot;

      expect(playerBeforeDrop.connected).toBe(false);
      expect(playerBeforeDrop.status).toBe("DISCONNECTED");
      expect(playerBeforeDrop.reconnectUntil).toBeGreaterThan(performance.now() + 119_000);
      expect(playerBeforeDrop.reconnectUntil).toBeLessThanOrEqual(performance.now() + 120_000);
      expect(internals.hostPlayerId).toBe(secondPlayer.id);

      const restoredSnapshot = nextSnapshot(second as unknown as SnapshotClient, (snapshot) =>
        snapshot.connectedPlayerCount === 2 && snapshot.hostPlayerId === secondPlayer.id,
      );
      reconnected = await new Client("http://127.0.0.1:2568").reconnect(token);
      await restoredSnapshot;
      const restoredPlayer = internals.players.get(reconnected.sessionId)!;
      expect(reconnected.sessionId).toBe(first.sessionId);
      expect(restoredPlayer.id).toBe(originalPlayerId);
      expect(restoredPlayer.points).toBe(8_765);
      expect(restoredPlayer.connected).toBe(true);
      expect(restoredPlayer.status).toBe("ACTIVE");
      expect(restoredPlayer.reconnectUntil).toBeUndefined();
      expect(internals.hostPlayerId).toBe(secondPlayer.id);
      expect(room.clients).toHaveLength(2);
    } finally {
      await Promise.all([...(reconnected ? [reconnected] : []), ...clients.slice(1)].map((client) => client.leave()));
    }
  }, 10_000);

  it("runs the ten-player lobby, locks private allocations, starts the match, syncs movement, and filters enemies", async () => {
    const clients: Room[] = [];
    const firstClient = await gameClient.create("arena", { nickname: "Tester 1" });
    const room = matchMaker.getLocalRoomById(firstClient.roomId) as ArenaRoom;
    clients.push(firstClient);
    for (let index = 1; index < 10; index += 1) {
      const client = await gameClient.joinById(room.roomId, { nickname: `Tester ${index + 1}` });
      (client as unknown as SnapshotClient).onMessage<unknown>("snapshot", () => undefined);
      (client as unknown as SnapshotClient).onMessage<unknown>("lobbySnapshot", () => undefined);
      clients.push(client);
    }

    expect(room.clients).toHaveLength(10);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const initialLobbies = await Promise.all(clients.map((client) => nextLobbySnapshot(client as unknown as SnapshotClient)));
    const teamCounts = initialLobbies.reduce(
      (counts, snapshot) => {
        const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId);
        expect(self).toBeDefined();
        counts[self!.teamId] += 1;
        return counts;
      },
      { BLUE: 0, RED: 0 },
    );
    expect(teamCounts).toEqual({ BLUE: 5, RED: 5 });

    const teamCaptains = new Map<TeamId, number>();
    for (let index = 0; index < initialLobbies.length; index += 1) {
      const lobby = initialLobbies[index]!;
      const self = lobby.players.find((player) => player.id === lobby.selfPlayerId)!;
      if (!teamCaptains.has(self.teamId)) teamCaptains.set(self.teamId, index);
    }
    const captainClients = new Map<TeamId, typeof clients[number]>();
    for (const teamId of ["BLUE", "RED"] as const) {
      const index = teamCaptains.get(teamId)!;
      const client = clients[index]!;
      const expected = lobbyUntil(client as unknown as SnapshotClient, (snapshot) => snapshot.captainIds[teamId] === initialLobbies[index]!.selfPlayerId);
      client.send("command", { type: "captain", action: "claim" });
      await expected;
      captainClients.set(teamId, client);
    }

    const hostIndex = initialLobbies.findIndex((snapshot) => snapshot.players.find((player) => player.id === snapshot.selfPlayerId)?.isHost);
    const host = clients[hostIndex]!;
    const allocationStarted = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.phase === "ALLOCATION");
    host.send("command", { type: "beginAllocation" });
    const allocationSnapshot = await allocationStarted;
    for (const snapshot of initialLobbies) {
      const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId)!;
      const teamView = await nextLobbySnapshot(clients[initialLobbies.indexOf(snapshot)] as unknown as SnapshotClient);
      expect(teamView.ownTeamAllocation).toHaveLength(5);
      expect(teamView.ownTeamAllocation.every((entry) => entry.points === 2_000)).toBe(true);
      expect(teamView.players.filter((player) => player.teamId !== self.teamId).every((player) => player.startingPoints === undefined)).toBe(true);
    }
    const blueCaptain = captainClients.get("BLUE")!;
    const blueLobby = allocationSnapshot.players.find((player) => player.id === allocationSnapshot.selfPlayerId)?.teamId === "BLUE"
      ? allocationSnapshot
      : await nextLobbySnapshot(blueCaptain as unknown as SnapshotClient);
    const blueCaptainId = blueLobby.selfPlayerId;
    const bluePoints = Object.fromEntries(blueLobby.ownTeamAllocation.map((entry, index) => [entry.playerId, index === 0 ? 2_100 : index === 1 ? 1_900 : 2_000]));
    const [underMinimumId, donorId] = Object.keys(bluePoints);
    const underMinimumAllocation = { ...bluePoints, [underMinimumId!]: 400, [donorId!]: bluePoints[donorId!]! + 1_700 };
    const invalidAllocation = nextCommandError(blueCaptain as unknown as SnapshotClient);
    blueCaptain.send("command", { type: "allocate", pointsByPlayerId: underMinimumAllocation });
    expect(await invalidAllocation).toContain("at least 500");
    const updatedAllocation = lobbyUntil(blueCaptain as unknown as SnapshotClient, (snapshot) => snapshot.ownTeamAllocation.find((entry) => entry.playerId === blueCaptainId)?.points === 2_100);
    blueCaptain.send("command", { type: "allocate", pointsByPlayerId: bluePoints });
    await updatedAllocation;

    const bothLocked = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.allocationComplete);
    for (const client of captainClients.values()) client.send("command", { type: "lockAllocation" });
    await bothLocked;

    const everyoneReady = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.players.every((player) => player.ready));
    for (const client of clients) client.send("command", { type: "ready", ready: true });
    await everyoneReady;
    const countdown = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.phase === "COUNTDOWN");
    host.send("command", { type: "startCountdown" });
    await countdown;

    const playingClient = clients[0]!;
    const playingSnapshotPromise = nextSnapshot(playingClient as unknown as SnapshotClient);
    const initialSnapshots = await Promise.all(clients.map((client) => nextSnapshot(client as unknown as SnapshotClient)));

    const moverIndex = initialSnapshots.findIndex((snapshot) =>
      snapshot.players.some((player) => player.id === snapshot.selfPlayerId && player.teamId === "BLUE"),
    );
    const mover = clients[moverIndex]!;
    const moverSnapshot = initialSnapshots[moverIndex]!;
    const moverId = moverSnapshot.selfPlayerId;
    const before = moverSnapshot.players.find((player) => player.id === moverId)!;
    const teammateIndex = initialSnapshots.findIndex((snapshot, index) =>
      index !== moverIndex && snapshot.players.some((player) => player.id === moverId),
    );
    const teammate = clients[teammateIndex]!;
    const redIndex = initialSnapshots.findIndex((snapshot) =>
      snapshot.players.some((player) => player.teamId === "RED"),
    );
    const redClient = clients[redIndex]!;
    const teammateSnapshot = initialSnapshots[teammateIndex]!;
    expect(teammateSnapshot.players.some((player) => player.id === moverId)).toBe(true);
    expect(moverSnapshot.phase).toBe("PLAYING");
    expect(moverSnapshot.remainingSeconds).toBeLessThanOrEqual(900);
    expect(moverSnapshot.players.every((player) => player.teamId !== "BLUE" || player.points !== undefined)).toBe(true);
    expect(moverSnapshot.teamScores.RED).toBeNull();
    expect(moverSnapshot.players.filter((player) => player.teamId === "RED").every((player) => player.points === undefined)).toBe(true);

    const redServerTimeBeforePing = initialSnapshots[redIndex]!.serverTime;
    const teammatePingSnapshotPromise = nextSnapshot(teammate as unknown as SnapshotClient,
      (snapshot) => snapshot.helpPings.some((ping) => ping.playerId === moverId));
    const enemyPingSnapshotPromise = nextSnapshot(redClient as unknown as SnapshotClient,
      (snapshot) => snapshot.serverTime > redServerTimeBeforePing && snapshot.helpPings.length === 0);
    mover.send("command", { type: "ping" });
    const [teammatePingSnapshot, enemyPingSnapshot] = await Promise.all([teammatePingSnapshotPromise, enemyPingSnapshotPromise]);
    expect(teammatePingSnapshot.helpPings.find((ping) => ping.playerId === moverId)?.remainingMs).toBeGreaterThan(0);
    expect(teammatePingSnapshot.helpPings.find((ping) => ping.playerId === moverId)?.remainingMs).toBeLessThanOrEqual(4_000);
    expect(enemyPingSnapshot.helpPings).toEqual([]);

    for (let sequence = 0; sequence < 45; sequence += 1) {
      mover.send("move", { type: "move", seq: sequence, dx: 1, dy: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    mover.send("move", { type: "move", seq: 45, dx: 0, dy: 0 });
    const syncedSnapshot = await nextSnapshot(teammate);
    const syncedMover = syncedSnapshot.players.find((player) => player.id === moverId)!;
    const westSpine = ARENA_OBSTACLES.find((obstacle) => obstacle.id === "west-spine")!;
    expect(syncedMover.x).toBeGreaterThan(before.x + 300);
    expect(syncedMover.x).toBeLessThan(westSpine.x - 21);

    const serverPlayers = (room as unknown as { players: Map<string, MutablePlayer> }).players;
    const bluePlayer = serverPlayers.get(mover.sessionId)!;
    const redPlayer = serverPlayers.get(redClient.sessionId)!;
    const voiceHealth = await (await fetch("http://127.0.0.1:2568/health")).json() as { voiceConfigured: boolean };
    if (voiceHealth.voiceConfigured) {
      const voiceRoom = room as unknown as { roomId: string; voiceCredentialFor(player: MutablePlayer): string };
      const issueVoiceToken = async (player: MutablePlayer, channel: "TEAM" | "GLOBAL" = "TEAM") => fetch("http://127.0.0.1:2568/voice/token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: voiceRoom.roomId,
          credential: voiceRoom.voiceCredentialFor(player),
          channel,
          teamId: player.teamId === "BLUE" ? "RED" : "BLUE",
          roomName: "forged-room-name",
        }),
      });
      const [blueVoiceResponse, redVoiceResponse, blueGlobalResponse, redGlobalResponse] = await Promise.all([
        issueVoiceToken(bluePlayer),
        issueVoiceToken(redPlayer),
        issueVoiceToken(bluePlayer, "GLOBAL"),
        issueVoiceToken(redPlayer, "GLOBAL"),
      ]);
      expect(blueVoiceResponse.status).toBe(200);
      expect(redVoiceResponse.status).toBe(200);
      expect(blueGlobalResponse.status).toBe(200);
      expect(redGlobalResponse.status).toBe(200);
      const blueVoice = await blueVoiceResponse.json() as { token: string; roomName: string; channel: string };
      const redVoice = await redVoiceResponse.json() as { token: string; roomName: string; channel: string };
      const blueGlobalVoice = await blueGlobalResponse.json() as { token: string; roomName: string; channel: string };
      const redGlobalVoice = await redGlobalResponse.json() as { token: string; roomName: string; channel: string };
      expect(blueVoice.roomName).toBe(`${voiceRoom.roomId}:round-1:BLUE`);
      expect(redVoice.roomName).toBe(`${voiceRoom.roomId}:round-1:RED`);
      expect(blueVoice.channel).toBe("TEAM");
      expect(redVoice.channel).toBe("TEAM");
      expect(blueGlobalVoice.roomName).toBe(`${voiceRoom.roomId}:round-1:GLOBAL`);
      expect(redGlobalVoice.roomName).toBe(`${voiceRoom.roomId}:round-1:GLOBAL`);
      expect(blueGlobalVoice.channel).toBe("GLOBAL");
      expect(redGlobalVoice.channel).toBe("GLOBAL");
      const tokenRoom = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")).video.room as string;
      expect(tokenRoom(blueVoice.token)).toBe(blueVoice.roomName);
      expect(tokenRoom(redVoice.token)).toBe(redVoice.roomName);
      expect(tokenRoom(blueGlobalVoice.token)).toBe(blueGlobalVoice.roomName);
      expect(tokenRoom(redGlobalVoice.token)).toBe(redGlobalVoice.roomName);
      const invalidVoiceResponse = await fetch("http://127.0.0.1:2568/voice/token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: voiceRoom.roomId, credential: voiceRoom.voiceCredentialFor(redPlayer), channel: "BLUE" }),
      });
      expect(invalidVoiceResponse.status).toBe(400);
    }

    bluePlayer.x = 2_308;
    bluePlayer.y = 2_400;
    redPlayer.x = 2_608;
    redPlayer.y = 2_400;
    const occludedSnapshot = await nextSnapshot(mover);
    expect(occludedSnapshot.players.some((player) => player.id === redPlayer.id)).toBe(false);

    bluePlayer.x = 2_308;
    bluePlayer.y = 3_000;
    redPlayer.x = 2_608;
    redPlayer.y = 3_000;
    const visibleSnapshot = await nextSnapshot(mover);
    expect(visibleSnapshot.players.some((player) => player.id === redPlayer.id)).toBe(true);
    expect(visibleSnapshot.players.find((player) => player.id === redPlayer.id)?.points).toBeUndefined();
    redPlayer.status = "INACTIVE";
    redPlayer.inactiveUntil = performance.now() + 15_000;
    const maskedInactivity = await nextSnapshot(mover);
    expect(maskedInactivity.players.find((player) => player.id === redPlayer.id)?.status).toBe("ACTIVE");

    const gameplayRoom = room as unknown as MutableArenaRoom;
    const livePhase = gameplayRoom.phase;
    gameplayRoom.phase = "RESULTS";
    bluePlayer.x = 500; bluePlayer.y = 550; bluePlayer.points = 1_000; bluePlayer.status = "ACTIVE";
    redPlayer.x = 530; redPlayer.y = 550; redPlayer.points = 300; redPlayer.status = "ACTIVE";
    const blueBattleEvent = nextGameEvent(mover as unknown as SnapshotClient, (event) => event.type === "battleResolved");
    const redBattleEvent = nextGameEvent(redClient as unknown as SnapshotClient, (event) => event.type === "battleResolved");
    gameplayRoom.resolveContacts();
    const [blueBattleFeedback, redBattleFeedback] = await Promise.all([blueBattleEvent, redBattleEvent]);
    expect(blueBattleFeedback.type).toBe("battleResolved");
    expect(redBattleFeedback.type).toBe("battleResolved");
    if (blueBattleFeedback.type === "battleResolved") {
      expect(blueBattleFeedback.eventId).toBe(redBattleFeedback.eventId);
      expect(blueBattleFeedback.participants.find(({ playerId }) => playerId === redPlayer.id)?.outcome).toBe("ELIMINATED");
    }
    expect(bluePlayer.points).toBe(1_300);
    expect(redPlayer.points).toBe(0);
    expect(bluePlayer.status).toBe("INACTIVE");
    expect(redPlayer.status).toBe("ELIMINATED");
    gameplayRoom.resolveContacts();
    expect(bluePlayer.points).toBe(1_300);
    bluePlayer.x = TEAM_BASES.BLUE.x + TEAM_BASES.BLUE.width / 2;
    bluePlayer.y = TEAM_BASES.BLUE.y + 100;
    gameplayRoom.rearmPlayers();
    expect(bluePlayer.status).toBe("ACTIVE");

    bluePlayer.x = 500; bluePlayer.y = 550; bluePlayer.points = 900; bluePlayer.status = "ACTIVE"; bluePlayer.frozenUntil = 0;
    redPlayer.x = 530; redPlayer.y = 550; redPlayer.points = 700; redPlayer.status = "INACTIVE";
    redPlayer.inactiveUntil = performance.now() + 15_000;
    redPlayer.frozenUntil = 0;
    gameplayRoom.activeContactPairs.clear();
    const activePointsBeforeInactiveContact = bluePlayer.points;
    const inactivePointsBeforeContact = redPlayer.points;
    gameplayRoom.resolveContacts();
    expect(bluePlayer.status).toBe("ACTIVE");
    expect(bluePlayer.frozenUntil).toBeGreaterThan(performance.now());
    expect(bluePlayer.points).toBe(activePointsBeforeInactiveContact);
    expect(redPlayer.status).toBe("INACTIVE");
    expect(redPlayer.points).toBe(inactivePointsBeforeContact);
    const freezeDeadline = bluePlayer.frozenUntil;
    gameplayRoom.resolveContacts();
    expect(bluePlayer.frozenUntil).toBe(freezeDeadline);
    const inactiveContactSnapshot = nextSnapshot(redClient as unknown as SnapshotClient,
      (snapshot) => snapshot.players.find((player) => player.id === redPlayer.id)?.status === "INACTIVE");
    const freezeOwnerSnapshot = nextSnapshot(mover as unknown as SnapshotClient,
      (snapshot) => snapshot.players.find((player) => player.id === bluePlayer.id)?.frozenSecondsRemaining !== undefined);
    gameplayRoom.sendSnapshots();
    const [inactiveView, freezeView] = await Promise.all([inactiveContactSnapshot, freezeOwnerSnapshot]);
    expect(inactiveView.players.find((player) => player.id === bluePlayer.id)?.status).toBe("ACTIVE");
    expect(inactiveView.players.find((player) => player.id === bluePlayer.id)).not.toHaveProperty("frozenSecondsRemaining");
    expect(freezeView.players.find((player) => player.id === bluePlayer.id)?.frozenSecondsRemaining).toBeGreaterThan(0);

    const blueTeammate = [...serverPlayers.values()].find((player) => player.teamId === "BLUE" && player.id !== bluePlayer.id)!;
    const redTeammate = [...serverPlayers.values()].find((player) => player.teamId === "RED" && player.id !== redPlayer.id)!;
    bluePlayer.x = 480; bluePlayer.y = 700; bluePlayer.points = 400;
    blueTeammate.x = 570; blueTeammate.y = 700; blueTeammate.points = 200; blueTeammate.status = "ACTIVE";
    gameplayRoom.startLink(bluePlayer, blueTeammate.id);
    expect(bluePlayer.linkedPlayerId).toBe(blueTeammate.id);
    expect(blueTeammate.linkedPlayerId).toBe(bluePlayer.id);
    redTeammate.x = 520; redTeammate.y = 700; redTeammate.points = 500; redTeammate.status = "ACTIVE";
    gameplayRoom.resolveContacts();
    expect(bluePlayer.points).toBe(650);
    expect(blueTeammate.points).toBe(450);
    expect(redTeammate.points).toBe(0);

    const pickupPlayer = [...serverPlayers.values()].find((player) => player.teamId === "BLUE" && player.id !== bluePlayer.id && player.id !== blueTeammate.id)!;
    pickupPlayer.x = 1_000; pickupPlayer.y = 550; pickupPlayer.points = 100; pickupPlayer.status = "ACTIVE";
    gameplayRoom.pickups = [{ id: "integration-pickup-1", x: 1_000, y: 550 }, { id: "integration-pickup-2", x: 1_300, y: 550 }];
    gameplayRoom.collectPickups();
    expect(pickupPlayer.points).toBe(300);
    expect(pickupPlayer.pickupsCollected).toBe(1);
    expect(gameplayRoom.pickups).toHaveLength(1);
    pickupPlayer.x = 1_300;
    gameplayRoom.collectPickups();
    expect(pickupPlayer.points).toBe(500);
    expect(pickupPlayer.pickupsCollected).toBe(2);
    expect(gameplayRoom.pickups).toHaveLength(0);

    const raider = [...serverPlayers.values()].find((player) => player.teamId === "BLUE" && player.status === "ACTIVE" && player.id !== pickupPlayer.id)!;
    raider.x = TEAM_BASES.RED.x + 80; raider.y = TEAM_BASES.RED.y + 100; raider.points = 1_000;
    const raiderSessionId = [...serverPlayers.entries()].find(([, player]) => player.id === raider.id)?.[0];
    const raiderClient = clients.find((client) => client.sessionId === raiderSessionId)!;
    const redRaidEvents: GameEvent[] = [];
    const stopCollectingRedRaidEvents = (redClient as unknown as SnapshotClient).onMessage<unknown>("gameEvent", (payload) => {
      const parsed = gameEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.type === "raidFeedback") redRaidEvents.push(parsed.data);
    });
    const raidStartedFeedback = nextGameEvent(raiderClient as unknown as SnapshotClient,
      (event) => event.type === "raidFeedback" && event.stage === "STARTED");
    const beforeRaid = raider.points;
    gameplayRoom.setInteraction(raider, true);
    expect((await raidStartedFeedback).type).toBe("raidFeedback");
    const raidCompletedFeedback = nextGameEvent(raiderClient as unknown as SnapshotClient,
      (event) => event.type === "raidFeedback" && event.stage === "COMPLETED");
    const raidStartedAt = gameplayRoom.activeRaids.BLUE!.startedAt;
    gameplayRoom.advanceRaids(raidStartedAt + 3_001);
    expect((await raidCompletedFeedback).type).toBe("raidFeedback");
    stopCollectingRedRaidEvents();
    expect(redRaidEvents).toHaveLength(0);
    expect(raider.points).toBe(beforeRaid + 2_000);
    expect(raider.raidsCompleted).toBe(1);
    expect(gameplayRoom.raidCooldownUntil.BLUE).toBeGreaterThan(raidStartedAt);
    expect(() => gameplayRoom.setInteraction(raider, true)).toThrow("cooling down");
    raider.x = 2_000; raider.y = 500;

    const defender = blueTeammate;
    pickupPlayer.x = TEAM_BASES.RED.x + 60; pickupPlayer.y = TEAM_BASES.RED.y + 100; pickupPlayer.points = 300; pickupPlayer.status = "ACTIVE";
    redTeammate.x = TEAM_BASES.RED.x + 80; redTeammate.y = TEAM_BASES.RED.y + 100; redTeammate.points = 1_000; redTeammate.status = "ACTIVE";
    gameplayRoom.activeContactPairs.clear();
    expect(pickupPlayer.teamId).not.toBe(redTeammate.teamId);
    expect(Math.hypot(pickupPlayer.x - redTeammate.x, pickupPlayer.y - redTeammate.y)).toBeLessThan(44);
    expect(gameplayRoom.poleHolders).toEqual({ BLUE: undefined, RED: undefined });
    gameplayRoom.resolveContacts();
    expect(pickupPlayer.status).toBe("ELIMINATED");
    expect(redTeammate.status).toBe("INACTIVE");
    expect(pickupPlayer.points).toBe(0);
    expect(redTeammate.points).toBe(1_300);

    redTeammate.x = TEAM_BASES.RED.x + 80; redTeammate.y = TEAM_BASES.RED.y + 100;
    defender.x = TEAM_BASES.BLUE.x + 90; defender.y = TEAM_BASES.BLUE.y + 100;
    gameplayRoom.rearmPlayers();
    gameplayRoom.resolveContacts();
    redTeammate.x = TEAM_BASES.BLUE.x + 60; redTeammate.y = TEAM_BASES.BLUE.y + 100;
    defender.x = TEAM_BASES.BLUE.x + 100; defender.y = TEAM_BASES.BLUE.y + 100;
    redTeammate.status = "ACTIVE"; redTeammate.points = 1_000;
    defender.status = "ACTIVE"; defender.points = 500;
    gameplayRoom.activeContactPairs.clear();
    const defenderPoints = defender.points;
    gameplayRoom.setInteraction(redTeammate, true);
    gameplayRoom.resolveContacts();
    expect(redTeammate.status).toBe("INACTIVE");
    expect(defender.status).toBe("ELIMINATED");
    expect(defender.points).toBe(0);
    expect(redTeammate.points).toBeGreaterThan(1_000);
    expect(defender.points).toBeLessThan(defenderPoints);
    expect(gameplayRoom.activeRaids.RED).toBeUndefined();

    gameplayRoom.activeContactPairs.clear();
    bluePlayer.x = 864; bluePlayer.y = 2_688; bluePlayer.points = 500; bluePlayer.status = "ACTIVE";
    redPlayer.x = 894; redPlayer.y = 2_688; redPlayer.points = 10_000; redPlayer.status = "ACTIVE";
    gameplayRoom.reconcilePoleHolders();
    expect(gameplayRoom.poleHolders.BLUE).toBe(bluePlayer.id);
    const bluePoleEvent = nextGameEvent(mover as unknown as SnapshotClient, (event) => event.type === "poleElimination");
    const redPoleEvent = nextGameEvent(redClient as unknown as SnapshotClient, (event) => event.type === "poleElimination");
    gameplayRoom.resolveContacts();
    const [bluePoleFeedback, redPoleFeedback] = await Promise.all([bluePoleEvent, redPoleEvent]);
    expect(bluePoleFeedback.type).toBe("poleElimination");
    expect(redPoleFeedback.type).toBe("poleElimination");
    expect(redPlayer.status).toBe("ELIMINATED");
    expect(bluePlayer.status).toBe("ACTIVE");
    expect(bluePlayer.points).toBe(500);
    expect(redPlayer.points).toBe(0);
    const eliminatedSnapshotPromise = nextSnapshot(redClient as unknown as SnapshotClient,
      (snapshot) => snapshot.players.find((player) => player.id === redPlayer.id)?.status === "ELIMINATED" && snapshot.spectatorTargetId !== undefined);
    gameplayRoom.sendSnapshots();
    const eliminatedSnapshot = await eliminatedSnapshotPromise;
    expect(eliminatedSnapshot.players.find((player) => player.id === redPlayer.id)?.status).toBe("ELIMINATED");
    expect(eliminatedSnapshot.spectatorTargetId).toBeDefined();
    if (voiceHealth.voiceConfigured) {
      const eliminatedVoiceResponse = await fetch("http://127.0.0.1:2568/voice/token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: room.roomId, credential: (room as unknown as { voiceCredentialFor(player: MutablePlayer): string }).voiceCredentialFor(redPlayer) }),
      });
      expect(eliminatedVoiceResponse.status).toBe(200);
    }
    gameplayRoom.phase = livePhase;
    const eliminatedAction = nextCommandError(redClient as unknown as SnapshotClient);
    redClient.send("command", { type: "linkStart", teammateId: redTeammate.id });
    expect(await eliminatedAction).toContain("spectators");
    const eliminatedX = redPlayer.x;
    redClient.send("move", { type: "move", seq: 100, dx: 1, dy: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(redPlayer.x).toBe(eliminatedX);

    const resultUpdate = nextSnapshot(host as unknown as SnapshotClient);
    gameplayRoom.matchDeadline = performance.now() - 1;
    gameplayRoom.simulate(0.05);
    const resultSnapshot = await resultUpdate;
    expect(resultSnapshot.phase).toBe("RESULTS");
    expect(resultSnapshot.result).not.toBeNull();
    expect(resultSnapshot.result?.players).toHaveLength(10);
    expect(resultSnapshot.result?.matchSettings).toEqual({ teamSize: 5, matchDurationSeconds: 900 });
    expect(resultSnapshot.result?.teamScores.BLUE).toBeTypeOf("number");
    expect(resultSnapshot.result?.teamScores.RED).toBeTypeOf("number");
    expect(resultSnapshot.result?.players.find((player) => player.id === redPlayer.id)?.points).toBe(0);
    for (const teamId of ["BLUE", "RED"] as const) {
      const playerTotal = resultSnapshot.result!.players.filter((player) => player.teamId === teamId)
        .reduce((sum, player) => sum + player.points, 0);
      expect(resultSnapshot.result!.teamScores[teamId]).toBe(playerTotal);
    }
    expect(resultSnapshot.teamScores.BLUE).toBeGreaterThan(0);
    const hostState = gameplayRoom.players.get(host.sessionId)!;
    const rematchLobby = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.phase === "LOBBY" && !snapshot.allocationComplete);
    gameplayRoom.rematch(hostState);
    await rematchLobby;
    expect(hostState.points).toBe(0);
    expect(hostState.startingPoints).toBeUndefined();
    expect(hostState.x).toBe(TEAM_BASES[hostState.teamId].x + TEAM_BASES[hostState.teamId].width / 2);

    await playingSnapshotPromise;
    await Promise.all(clients.map((client) => client.leave()));
  }, 30_000);

  it("creates an official 4v4 room with server-owned team size and custom match duration", async () => {
    const clients: Room[] = [];
    try {
      await expect(gameClient.create("arena", {
        nickname: "Invalid Format",
        matchSettings: { teamSize: 3, matchDurationSeconds: 900 },
      })).rejects.toThrow();
      await expect(gameClient.create("arena", {
        nickname: "Invalid Timer",
        matchSettings: { teamSize: 4, matchDurationSeconds: 301 },
      })).rejects.toThrow();

      const first = await gameClient.create("arena", {
        nickname: "4v4 Host",
        matchSettings: { teamSize: 4, matchDurationSeconds: 600 },
      });
      clients.push(first);
      const room = matchMaker.getLocalRoomById(first.roomId) as ArenaRoom;
      const internals = room as unknown as {
        playersPerTeam: number;
        players: Map<string, { id: string }>;
        matchSettings: { teamSize: number; matchDurationSeconds: number };
        matchDeadline: number | undefined;
        startMatch(): void;
        finishMatch(): void;
        rematch(player: { id: string }): void;
      };
      for (let index = 1; index < 8; index += 1) {
        clients.push(await gameClient.joinById(room.roomId, { nickname: `4v4 Player ${index + 1}` }));
      }

      await new Promise((resolve) => setTimeout(resolve, 60));
      const snapshots = await Promise.all(clients.map((client) => nextLobbySnapshot(client as unknown as SnapshotClient)));
      expect(snapshots.every((snapshot) => snapshot.matchSettings.teamSize === 4 && snapshot.matchSettings.matchDurationSeconds === 600)).toBe(true);
      expect(internals.playersPerTeam).toBe(4);
      expect(internals.matchSettings).toEqual({ teamSize: 4, matchDurationSeconds: 600 });
      expect(room.clients).toHaveLength(8);
      await expect(gameClient.joinById(room.roomId, { nickname: "Extra Player" })).rejects.toThrow();

      const teamCounts = snapshots.reduce((counts, snapshot) => {
        const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId)!;
        counts[self.teamId] += 1;
        return counts;
      }, { BLUE: 0, RED: 0 });
      expect(teamCounts).toEqual({ BLUE: 4, RED: 4 });

      const playing = nextSnapshot(clients[0] as unknown as SnapshotClient, (snapshot) => snapshot.phase === "PLAYING");
      internals.startMatch();
      const playingSnapshot = await playing;
      expect(playingSnapshot.matchSettings).toEqual({ teamSize: 4, matchDurationSeconds: 600 });
      expect(playingSnapshot.remainingSeconds).toBeLessThanOrEqual(600);
      expect(playingSnapshot.remainingSeconds).toBeGreaterThan(590);
      expect(playingSnapshot.result).toBeNull();
      expect(internals.matchDeadline).toBeDefined();

      const resultPromise = nextSnapshot(clients[0] as unknown as SnapshotClient, (snapshot) => snapshot.phase === "RESULTS");
      internals.finishMatch();
      const resultSnapshot = await resultPromise;
      expect(resultSnapshot.result?.matchSettings).toEqual({ teamSize: 4, matchDurationSeconds: 600 });
      const hostState = internals.players.get(first.sessionId)!;
      const rematchPromise = lobbyUntil(clients[0] as unknown as SnapshotClient, (snapshot) => snapshot.phase === "LOBBY");
      internals.rematch(hostState);
      expect((await rematchPromise).matchSettings).toEqual({ teamSize: 4, matchDurationSeconds: 600 });
    } finally {
      await Promise.all(clients.map((client) => client.leave()));
    }
  }, 30_000);

  it("creates a temporary 2v2 room and launches it with the same lobby rules", async () => {
    const clients: Room[] = [];
    try {
      const first = await gameClient.create("arena", { nickname: "2v2 Tester 1", roomMode: "TEST_2V2" });
      const room = matchMaker.getLocalRoomById(first.roomId) as ArenaRoom;
      clients.push(first);
      for (let index = 1; index < 4; index += 1) {
        const client = await gameClient.joinById(room.roomId, { nickname: `2v2 Tester ${index + 1}` });
        (client as unknown as SnapshotClient).onMessage<unknown>("snapshot", () => undefined);
        (client as unknown as SnapshotClient).onMessage<unknown>("lobbySnapshot", () => undefined);
        clients.push(client);
      }

      await new Promise((resolve) => setTimeout(resolve, 60));
      const snapshots = await Promise.all(clients.map((client) => nextLobbySnapshot(client as unknown as SnapshotClient)));
      expect(snapshots.every((snapshot) => snapshot.roomMode === "TEST_2V2" && snapshot.matchSettings.teamSize === 2)).toBe(true);
      expect(room.clients).toHaveLength(4);
      await expect(gameClient.joinById(room.roomId, { nickname: "Extra Tester" })).rejects.toThrow();
      expect(room.clients).toHaveLength(4);
      const teamCounts = snapshots.reduce((counts, snapshot) => {
        const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId)!;
        counts[self.teamId] += 1;
        return counts;
      }, { BLUE: 0, RED: 0 });
      expect(teamCounts).toEqual({ BLUE: 2, RED: 2 });

      const captainClients = new Map<TeamId, typeof clients[number]>();
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index]!;
        const self = snapshot.players.find((player) => player.id === snapshot.selfPlayerId)!;
        if (captainClients.has(self.teamId)) continue;
        const client = clients[index]!;
        const claimed = lobbyUntil(client as unknown as SnapshotClient, (next) => next.captainIds[self.teamId] === self.id);
        client.send("command", { type: "captain", action: "claim" });
        await claimed;
        captainClients.set(self.teamId, client);
      }

      const hostIndex = snapshots.findIndex((snapshot) => snapshot.players.find((player) => player.id === snapshot.selfPlayerId)?.isHost);
      const host = clients[hostIndex]!;
      const allocationStarted = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.phase === "ALLOCATION");
      host.send("command", { type: "beginAllocation" });
      const allocation = await allocationStarted;
      expect(allocation.ownTeamAllocation).toHaveLength(2);
      expect(allocation.ownTeamAllocation.every((entry) => entry.points === 5_000)).toBe(true);

      const bothLocked = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.allocationComplete);
      for (const client of captainClients.values()) client.send("command", { type: "lockAllocation" });
      await bothLocked;
      const everyoneReady = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.players.every((player) => player.ready));
      for (const client of clients) client.send("command", { type: "ready", ready: true });
      await everyoneReady;
      const countdown = lobbyUntil(host as unknown as SnapshotClient, (snapshot) => snapshot.phase === "COUNTDOWN");
      host.send("command", { type: "startCountdown" });
      expect((await countdown).matchSettings.teamSize).toBe(2);

      const blueClient = clients[0]!;
      const initialMatch = await nextSnapshot(blueClient as unknown as SnapshotClient);
      const self = initialMatch.players.find((player) => player.id === initialMatch.selfPlayerId)!;
      const teammate = initialMatch.players.find((player) => player.teamId === self.teamId && player.id !== self.id)!;
      const linkedUpdate = nextSnapshot(blueClient as unknown as SnapshotClient);
      blueClient.send("command", { type: "linkStart", teammateId: teammate.id });
      expect((await linkedUpdate).players.find((player) => player.id === self.id)?.linkedPlayerId).toBe(teammate.id);
      const unlinkedUpdate = nextSnapshot(blueClient as unknown as SnapshotClient);
      blueClient.send("command", { type: "linkStop" });
      expect((await unlinkedUpdate).players.find((player) => player.id === self.id)?.linkedPlayerId).toBeUndefined();
    } finally {
      await Promise.all(clients.map((client) => client.leave()));
    }
  }, 20_000);

  it("rejects invalid and duplicate abuse reports and limits each player to three reports per match", async () => {
    const clients: Room[] = [];
    const reportLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const first = await gameClient.create("arena", { nickname: "Reporting Crew" });
      clients.push(first);
      const room = matchMaker.getLocalRoomById(first.roomId) as ArenaRoom;
      for (let index = 1; index < 5; index += 1) {
        clients.push(await gameClient.joinById(room.roomId, { nickname: `Reported Crew ${index}` }));
      }
      const internals = room as unknown as { players: Map<string, MutablePlayer>; phase: string };
      internals.phase = "PLAYING";
      const reporter = internals.players.get(first.sessionId)!;
      const targets = clients.slice(1).map((client) => internals.players.get(client.sessionId)!.id);
      const reporterClient = first as unknown as SnapshotClient;

      const selfError = nextCommandError(reporterClient);
      first.send("command", { type: "reportPlayer", targetPlayerId: reporter.id, category: "OTHER" });
      expect(await selfError).toContain("report yourself");

      const unknownError = nextCommandError(reporterClient);
      first.send("command", { type: "reportPlayer", targetPlayerId: "missing-player", category: "CHEATING" });
      expect(await unknownError).toContain("no longer in this match");

      const acceptedFirst = nextReportAccepted(reporterClient);
      first.send("command", { type: "reportPlayer", targetPlayerId: targets[0], category: "HARASSMENT" });
      expect(await acceptedFirst).toMatchObject({ targetPlayerId: targets[0] });
      const structuredReport = JSON.parse(String(reportLog.mock.calls[0]?.[0])) as { event: string; category: string };
      expect(structuredReport).toMatchObject({ event: "osmosis.abuse_report", category: "HARASSMENT" });

      const duplicateError = nextCommandError(reporterClient);
      first.send("command", { type: "reportPlayer", targetPlayerId: targets[0], category: "OTHER" });
      expect(await duplicateError).toContain("already reported");

      for (const targetId of targets.slice(1, 3)) {
        const accepted = nextReportAccepted(reporterClient);
        first.send("command", { type: "reportPlayer", targetPlayerId: targetId, category: "OTHER" });
        await expect(accepted).resolves.toMatchObject({ targetPlayerId: targetId });
      }

      const limitError = nextCommandError(reporterClient);
      first.send("command", { type: "reportPlayer", targetPlayerId: targets[3], category: "CHEATING" });
      expect(await limitError).toContain("maximum number of reports");
    } finally {
      reportLog.mockRestore();
      await Promise.all(clients.map((client) => client.leave()));
    }
  }, 15_000);
});
