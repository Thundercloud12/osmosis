import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room, type SeatReservation } from "@colyseus/sdk";
import { lobbySnapshotSchema, matchmakingSnapshotSchema, type LobbySnapshot, type MatchmakingSnapshot } from "@osmosis/shared";

import { matchMaker } from "@colyseus/core";
import { server } from "../app.config";
import { ArenaRoom } from "../rooms/ArenaRoom";
import { activeMatchmakingRoom } from "./MatchmakingRoom";

const endpoint = "http://127.0.0.1:2569";

interface MatchFound {
  matchId: string;
  reservation: SeatReservation;
}

function nextMessage<T>(room: Room, name: string, valid: (value: unknown) => value is T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${name}`));
    }, 12_000);
    const unsubscribe = room.onMessage<unknown>(name, (value) => {
      if (!valid(value)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(value);
    });
  });
}

function nextMatchmakingSnapshot(room: Room, predicate: (snapshot: MatchmakingSnapshot) => boolean): Promise<MatchmakingSnapshot> {
  return nextMessage(room, "matchmakingSnapshot", (value): value is MatchmakingSnapshot => {
    const parsed = matchmakingSnapshotSchema.safeParse(value);
    return parsed.success && predicate(parsed.data);
  });
}

function nextLobbySnapshot(room: Room, predicate: (snapshot: LobbySnapshot) => boolean): Promise<LobbySnapshot> {
  return nextMessage(room, "lobbySnapshot", (value): value is LobbySnapshot => {
    const parsed = lobbySnapshotSchema.safeParse(value);
    return parsed.success && predicate(parsed.data);
  });
}

function isMatchFound(value: unknown): value is MatchFound {
  return typeof value === "object" && value !== null
    && "matchId" in value && typeof value.matchId === "string"
    && "reservation" in value && typeof value.reservation === "object" && value.reservation !== null;
}

function hasMatchId(value: unknown): value is { matchId: string } {
  return typeof value === "object" && value !== null && "matchId" in value && typeof value.matchId === "string";
}

describe("M7 Quick Play room handoff", () => {
  beforeAll(async () => {
    await server.listen(2569);
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it.each([4, 5] as const)("keeps a party together through a complete %i-player-per-side handoff and locks its team", async (teamSize) => {
    const clients = Array.from({ length: teamSize * 2 }, () => new Client(endpoint));
    const queueRooms: Room[] = [];
    const arenaRooms: Room[] = [];
    let partyPlayerIds: string[] = [];
    const settings = { teamSize, matchDurationSeconds: 300 } as const;

    try {
      for (let index = 0; index < clients.length; index += 1) {
        const room = await clients[index]!.joinOrCreate("matchmaking", { nickname: `Quick Crew ${teamSize}-${index}` });
        queueRooms.push(room);
      }

      const leaderRoom = queueRooms[0]!;
      const partyCreated = nextMatchmakingSnapshot(leaderRoom, (snapshot) => Boolean(snapshot.party));
      leaderRoom.send("matchmakingCommand", { type: "createParty", settings });
      const created = await partyCreated;
      const partyCode = created.party!.code;

      const memberRoom = queueRooms[1]!;
      const partyJoined = nextMatchmakingSnapshot(memberRoom, (snapshot) => snapshot.party?.members.length === 2);
      memberRoom.send("matchmakingCommand", { type: "joinParty", code: partyCode });
      const joined = await partyJoined;
      partyPlayerIds = joined.party!.members.map((member) => member.id);

      const searchSnapshots = queueRooms.map((room) => nextMatchmakingSnapshot(room, (snapshot) => Boolean(snapshot.queue)));
      const foundPromises = queueRooms.map((room) => nextMessage(room, "matchFound", isMatchFound));
      leaderRoom.send("matchmakingCommand", { type: "queueParty" });
      for (let index = 2; index < queueRooms.length; index += 1) {
        queueRooms[index]!.send("matchmakingCommand", { type: "queueSolo", settings });
      }
      const queued = await Promise.all(searchSnapshots);
      expect(queued.every((snapshot) => snapshot.queue?.status === "SEARCHING" || snapshot.queue?.status === "MATCH_FOUND")).toBe(true);

      const found = await Promise.all(foundPromises);
      expect(new Set(found.map((entry) => entry.matchId)).size).toBe(1);
      expect(new Set(found.map((entry) => entry.reservation.roomId)).size).toBe(1);

      for (let index = 0; index < found.length; index += 1) {
        arenaRooms.push(await clients[index]!.consumeSeatReservation(found[index]!.reservation));
      }
      const handoffRoomId = found[0]!.reservation.roomId;
      const arena = matchMaker.getLocalRoomById(handoffRoomId) as ArenaRoom;
      const arenaLobbySnapshots = await Promise.all(arenaRooms.map((room) => nextLobbySnapshot(room, (snapshot) =>
        snapshot.players.length === teamSize * 2 && snapshot.teamSelectionLocked,
      )));
      const arenaInternals = arena as unknown as {
        players: Map<string, { id: string; teamId: "BLUE" | "RED" }>;
        playersPerTeam: number;
        countTeam(teamId: "BLUE" | "RED"): number;
      };

      expect(arenaLobbySnapshots.every((snapshot) => snapshot.matchSettings.teamSize === teamSize)).toBe(true);
      expect(arenaLobbySnapshots.every((snapshot) => snapshot.teamSelectionLocked)).toBe(true);
      expect(arenaInternals.playersPerTeam).toBe(teamSize);
      expect(arenaInternals.countTeam("BLUE")).toBe(teamSize);
      expect(arenaInternals.countTeam("RED")).toBe(teamSize);
      const partyTeams = partyPlayerIds.map((id) => {
        const player = [...arenaInternals.players.values()].find((candidate) => candidate.id === id);
        return player?.teamId;
      });
      expect(partyTeams).toHaveLength(2);
      expect(partyTeams[0]).toBeDefined();
      expect(partyTeams[1]).toBe(partyTeams[0]);

      const lobbyConnection = arenaRooms[0]!;
      const quickPlayPlayer = arenaInternals.players.get(lobbyConnection.sessionId)!;
      const rejection = nextMessage(lobbyConnection, "commandError", (value): value is { message: string } =>
        typeof value === "object" && value !== null && "message" in value && typeof value.message === "string",
      );
      lobbyConnection.send("command", {
        type: "chooseTeam",
        teamId: quickPlayPlayer.teamId === "BLUE" ? "RED" : "BLUE",
      });
      await expect(rejection).resolves.toMatchObject({ message: expect.stringContaining("keeps your assigned crew together") });

      const completions = queueRooms.map((room) => nextMessage(room, "handoffComplete", hasMatchId));
      for (const room of queueRooms) room.send("handoffClientReady", { matchId: found[0]!.matchId });
      const completed = await Promise.all(completions);
      expect(completed.every((entry) => entry.matchId === found[0]!.matchId)).toBe(true);
    } finally {
      await Promise.allSettled([...arenaRooms, ...queueRooms].map((room) => room.leave()));
    }
  }, 30_000);

  it("restores a queued party member's identity and eligibility after reconnect", async () => {
    const clients = [new Client(endpoint), new Client(endpoint)];
    const rooms: Room[] = [];
    let reconnected: Room | undefined;
    try {
      for (let index = 0; index < clients.length; index += 1) {
        rooms.push(await clients[index]!.joinOrCreate("matchmaking", { nickname: `Returning Crew ${index}` }));
      }
      const leader = rooms[0]!;
      const createdPromise = nextMatchmakingSnapshot(leader, (snapshot) => Boolean(snapshot.party));
      leader.send("matchmakingCommand", {
        type: "createParty", settings: { teamSize: 4, matchDurationSeconds: 300 },
      });
      const created = await createdPromise;
      const partyJoined = nextMatchmakingSnapshot(rooms[1]!, (snapshot) => snapshot.party?.members.length === 2);
      rooms[1]!.send("matchmakingCommand", { type: "joinParty", code: created.party!.code });
      const joined = await partyJoined;
      const returningPlayerId = joined.party!.members.find((member) => member.nickname === "Returning Crew 1")!.id;

      const queuedPromise = nextMatchmakingSnapshot(leader, (snapshot) => Boolean(snapshot.queue));
      leader.send("matchmakingCommand", { type: "queueParty" });
      await queuedPromise;

      const reconnectToken = rooms[1]!.reconnectionToken;
      const pausedPromise = nextMatchmakingSnapshot(leader, (snapshot) =>
        snapshot.queue?.isPaused === true
        && snapshot.party?.members.some((member) => member.id === returningPlayerId && !member.connected) === true,
      );
      rooms[1]!.reconnection.enabled = false;
      rooms[1]!.connection.close(4010);
      await pausedPromise;

      const resumedPromise = nextMatchmakingSnapshot(leader, (snapshot) =>
        snapshot.queue?.isPaused === false
        && snapshot.party?.members.some((member) => member.id === returningPlayerId && member.connected) === true,
      );
      reconnected = await new Client(endpoint).reconnect(reconnectToken);
      await resumedPromise;
      expect(reconnected.sessionId).toBe(rooms[1]!.sessionId);
      expect(activeMatchmakingRoom?.metricsSnapshot()).toMatchObject({ queueTickets: 1, queuedPlayers: 2 });
    } finally {
      const cleanup = [rooms[0]!, ...(reconnected ? [reconnected] : [])];
      await Promise.allSettled(cleanup.map((room) => room.leave()));
    }
  }, 15_000);

  it("rate-limits repeated party actions for one queue session", async () => {
    const client = new Client(endpoint);
    let room: Room | undefined;
    try {
      room = await client.joinOrCreate("matchmaking", { nickname: "Rate Limit Crew" });
      const settings = { teamSize: 4, matchDurationSeconds: 300 };
      const created = nextMatchmakingSnapshot(room, (snapshot) => Boolean(snapshot.party));
      room.send("matchmakingCommand", { type: "createParty", settings });
      await created;

      const rateLimitError = nextMessage(room, "matchmakingError", (value): value is { message: string } =>
        typeof value === "object" && value !== null && "message" in value
        && typeof value.message === "string" && value.message.includes("too quickly"),
      );
      for (let index = 0; index < 9; index += 1) {
        room.send("matchmakingCommand", { type: "updatePartySettings", settings });
      }
      await expect(rateLimitError).resolves.toMatchObject({ message: expect.stringContaining("too quickly") });
    } finally {
      if (room) await room.leave();
    }
  }, 15_000);

  it("cancels the whole handoff if a player leaves before consuming their reserved seat", async () => {
    const clients = Array.from({ length: 8 }, () => new Client(endpoint));
    const rooms: Room[] = [];
    try {
      for (let index = 0; index < clients.length; index += 1) {
        rooms.push(await clients[index]!.joinOrCreate("matchmaking", { nickname: `Leaving Crew ${index}` }));
      }
      const foundPromises = rooms.map((room) => nextMessage(room, "matchFound", isMatchFound));
      for (const room of rooms) room.send("matchmakingCommand", {
        type: "queueSolo", settings: { teamSize: 4, matchDurationSeconds: 300 },
      });
      const found = await Promise.all(foundPromises);
      const cancelledPromises = rooms.slice(1).map((room) => nextMessage(room, "handoffCancelled", hasMatchId));

      await rooms[0]!.leave();

      const cancellations = await Promise.all(cancelledPromises);
      expect(cancellations.every((entry) => entry.matchId === found[0]!.matchId)).toBe(true);
      expect(new Set(found.map((entry) => entry.reservation.roomId)).size).toBe(1);
      expect(activeMatchmakingRoom?.metricsSnapshot()).toMatchObject({ queueTickets: 0, handoffs: 0 });
    } finally {
      await Promise.allSettled(rooms.slice(1).map((room) => room.leave()));
    }
  }, 20_000);
});
