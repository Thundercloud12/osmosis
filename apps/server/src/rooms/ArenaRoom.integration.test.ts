import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  ARENA_OBSTACLES,
  TEAM_BASES,
  lobbySnapshotSchema,
  roomSnapshotSchema,
  type LobbySnapshot,
  type RoomSnapshot,
  type TeamId,
} from "@osmosis/shared";

import { matchMaker } from "colyseus";
import { server } from "../app.config";
import { ArenaRoom } from "./ArenaRoom";

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
  status: "ACTIVE" | "INACTIVE" | "DISCONNECTED";
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
  resolveContacts(): void;
  rearmPlayers(): void;
  startLink(player: MutablePlayer, teammateId: string): void;
  collectPickups(): void;
  setInteraction(player: MutablePlayer, active: boolean): void;
  advanceRaids(now: number): void;
  finishMatch(): void;
  simulate(dt: number): void;
  rematch(player: MutablePlayer): void;
}

const gameClient = new Client("http://127.0.0.1:2568");

interface SnapshotClient {
  onMessage<Payload>(type: string, callback: (payload: Payload) => void): () => void;
}

function nextSnapshot(client: SnapshotClient): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for an arena snapshot"));
    }, 8_000);

    const unsubscribe = client.onMessage<unknown>("snapshot", (payload) => {
      const parsed = roomSnapshotSchema.safeParse(payload);
      if (!parsed.success) return;
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

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

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

    bluePlayer.x = 500;
    bluePlayer.y = 700;
    redPlayer.x = 800;
    redPlayer.y = 700;
    const occludedSnapshot = await nextSnapshot(mover);
    expect(occludedSnapshot.players.some((player) => player.id === redPlayer.id)).toBe(false);

    bluePlayer.x = 500;
    bluePlayer.y = 450;
    redPlayer.x = 620;
    redPlayer.y = 450;
    const visibleSnapshot = await nextSnapshot(mover);
    expect(visibleSnapshot.players.some((player) => player.id === redPlayer.id)).toBe(true);
    expect(visibleSnapshot.players.find((player) => player.id === redPlayer.id)?.points).toBeUndefined();

    const gameplayRoom = room as unknown as MutableArenaRoom;
    bluePlayer.x = 500; bluePlayer.y = 550; bluePlayer.points = 1_000; bluePlayer.status = "ACTIVE";
    redPlayer.x = 530; redPlayer.y = 550; redPlayer.points = 300; redPlayer.status = "ACTIVE";
    gameplayRoom.resolveContacts();
    expect(bluePlayer.points).toBe(1_300);
    expect(redPlayer.points).toBe(0);
    expect(bluePlayer.status).toBe("INACTIVE");
    expect(redPlayer.status).toBe("INACTIVE");
    gameplayRoom.resolveContacts();
    expect(bluePlayer.points).toBe(1_300);
    bluePlayer.x = 180; bluePlayer.y = 700;
    gameplayRoom.rearmPlayers();
    expect(bluePlayer.status).toBe("ACTIVE");

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
    gameplayRoom.pickups = [{ id: "integration-pickup", x: 1_000, y: 550 }];
    gameplayRoom.collectPickups();
    expect(pickupPlayer.points).toBe(300);
    expect(pickupPlayer.pickupsCollected).toBe(1);
    expect(gameplayRoom.pickups).toHaveLength(0);

    const raider = [...serverPlayers.values()].find((player) => player.teamId === "BLUE" && player.status === "ACTIVE" && player.id !== pickupPlayer.id)!;
    raider.x = TEAM_BASES.RED.x + 80; raider.y = 800; raider.points = 1_000;
    const beforeRaid = raider.points;
    gameplayRoom.setInteraction(raider, true);
    const raidStartedAt = gameplayRoom.activeRaids.BLUE!.startedAt;
    gameplayRoom.advanceRaids(raidStartedAt + 3_001);
    expect(raider.points).toBe(beforeRaid + 2_000);
    expect(raider.raidsCompleted).toBe(1);
    expect(gameplayRoom.raidCooldownUntil.BLUE).toBeGreaterThan(raidStartedAt);
    expect(() => gameplayRoom.setInteraction(raider, true)).toThrow("cooling down");

    const defender = blueTeammate;
    pickupPlayer.x = TEAM_BASES.RED.x + 60; pickupPlayer.y = 800; pickupPlayer.points = 300; pickupPlayer.status = "ACTIVE";
    redTeammate.x = TEAM_BASES.RED.x + 80; redTeammate.y = 800; redTeammate.points = 1_000; redTeammate.status = "ACTIVE";
    gameplayRoom.resolveContacts();
    expect(pickupPlayer.status).toBe("INACTIVE");
    expect(pickupPlayer.points).toBe(300);
    expect(redTeammate.points).toBe(1_000);

    redTeammate.x = TEAM_BASES.RED.x + 80; redTeammate.y = 800;
    defender.x = TEAM_BASES.BLUE.x + 90; defender.y = 800;
    gameplayRoom.rearmPlayers();
    gameplayRoom.resolveContacts();
    redTeammate.x = 200; redTeammate.y = 700;
    defender.x = 220; defender.y = 700;
    const defenderPoints = defender.points;
    gameplayRoom.setInteraction(redTeammate, true);
    gameplayRoom.resolveContacts();
    expect(redTeammate.status).toBe("INACTIVE");
    expect(defender.status).toBe("ACTIVE");
    expect(defender.points).toBe(defenderPoints);
    expect(gameplayRoom.activeRaids.RED).toBeUndefined();

    const resultUpdate = nextSnapshot(host as unknown as SnapshotClient);
    gameplayRoom.matchDeadline = performance.now() - 1;
    gameplayRoom.simulate(0.05);
    const resultSnapshot = await resultUpdate;
    expect(resultSnapshot.phase).toBe("RESULTS");
    expect(resultSnapshot.result).not.toBeNull();
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
});
