import { describe, expect, it } from "vitest";

import { MatchmakingCoordinator } from "./MatchmakingCoordinator";

const FOUR_MINUTES = { teamSize: 4, matchDurationSeconds: 300 } as const;
const FOUR_TEN_MINUTES = { teamSize: 4, matchDurationSeconds: 600 } as const;

function players(coordinator: MatchmakingCoordinator, count: number) {
  return Array.from({ length: count }, (_, index) => coordinator.registerPlayer(`session-${index}`, `Crew ${index}`));
}

describe("MatchmakingCoordinator", () => {
  it("keeps a party intact while composing exact teams from compatible solos", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 8);
    const party = coordinator.createParty(crew[0]!.id, FOUR_MINUTES);
    coordinator.joinParty(crew[1]!.id, party.code);
    const partyTicket = coordinator.queueParty(crew[0]!.id);
    for (const player of crew.slice(2)) coordinator.queueSolo(player.id, FOUR_MINUTES);

    const selected = coordinator.nextMatch();

    expect(selected).toBeDefined();
    expect(selected!.settings).toEqual(FOUR_MINUTES);
    expect(selected!.blue.reduce((count, ticket) => count + ticket.members.length, 0)).toBe(4);
    expect(selected!.red.reduce((count, ticket) => count + ticket.members.length, 0)).toBe(4);
    expect(selected!.blue.some((ticket) => ticket.id === partyTicket.id)
      || selected!.red.some((ticket) => ticket.id === partyTicket.id)).toBe(true);
    expect(partyTicket.members.map((member) => member.id)).toEqual([crew[0]!.id, crew[1]!.id]);
  });

  it("never mixes duration queues and waits for enough compatible players", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 12);
    for (const player of crew.slice(0, 4)) coordinator.queueSolo(player.id, FOUR_MINUTES);
    for (const player of crew.slice(4, 8)) coordinator.queueSolo(player.id, FOUR_TEN_MINUTES);
    expect(coordinator.nextMatch()).toBeUndefined();

    for (const player of crew.slice(8)) coordinator.queueSolo(player.id, FOUR_MINUTES);
    const selected = coordinator.nextMatch();
    expect(selected?.settings).toEqual(FOUR_MINUTES);
    expect([...selected!.blue, ...selected!.red].flatMap((ticket) => ticket.members)
      .every((player) => player.queueTicketId && coordinator.snapshotFor(player.sessionId)?.queue?.settings.matchDurationSeconds === 300)).toBe(true);
  });

  it("rejects party overflow, repeat membership, and non-leader party queue cancellation", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 5);
    const party = coordinator.createParty(crew[0]!.id, FOUR_MINUTES);
    coordinator.joinParty(crew[1]!.id, party.code);
    expect(() => coordinator.joinParty(crew[1]!.id, party.code)).toThrow("Leave your current crew");
    coordinator.joinParty(crew[2]!.id, party.code);
    coordinator.joinParty(crew[3]!.id, party.code);
    expect(() => coordinator.joinParty(crew[4]!.id, party.code)).toThrow("crew is full");
    coordinator.queueParty(crew[0]!.id);
    expect(() => coordinator.cancelQueue(crew[1]!.id)).toThrow("Only the crew leader");
    expect(coordinator.cancelQueue(crew[0]!.id).affectedPlayerIds).toHaveLength(4);
    expect(coordinator.snapshotFor(crew[1]!.sessionId)?.queue).toBeNull();
  });

  it("pauses a disconnected ticket and resumes eligibility on reconnection", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 8);
    for (const player of crew) coordinator.queueSolo(player.id, FOUR_MINUTES);
    coordinator.setConnected(crew[3]!.sessionId, false);

    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.queue).toMatchObject({
      status: "SEARCHING", isPaused: false, estimatedPlayersWaiting: 7, playersNeeded: 1,
    });
    expect(coordinator.snapshotFor(crew[3]!.sessionId)?.queue).toMatchObject({
      status: "SEARCHING", isPaused: true, estimatedPlayersWaiting: 7, playersNeeded: 1,
    });
    expect(coordinator.nextMatch()).toBeUndefined();

    coordinator.setConnected(crew[3]!.sessionId, true);
    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.queue?.isPaused).toBe(false);
    expect(coordinator.nextMatch()).toBeDefined();
  });

  it("removes a disconnected party member after grace and cancels that indivisible ticket", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 3);
    const party = coordinator.createParty(crew[0]!.id, FOUR_MINUTES);
    coordinator.joinParty(crew[1]!.id, party.code);
    const ticket = coordinator.queueParty(crew[0]!.id);
    coordinator.setConnected(crew[1]!.sessionId, false);

    const removal = coordinator.removePlayer(crew[1]!.sessionId);

    expect(removal.affectedPlayerIds).toEqual([crew[0]!.id, crew[1]!.id]);
    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.queue).toBeNull();
    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.party?.members.map((member) => member.id)).toEqual([crew[0]!.id]);
    expect(coordinator.getPlayerById(crew[1]!.id)).toBeUndefined();
    expect(coordinator.nextMatch()).toBeUndefined();
    expect(coordinator.metricsSnapshot().queueTickets).toBe(0);
    expect(ticket.members).toHaveLength(2);
  });

  it("requires every player to join Arena and confirm client readiness before completing a handoff", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 8);
    for (const player of crew) coordinator.queueSolo(player.id, FOUR_MINUTES);
    const selected = coordinator.nextMatch()!;
    coordinator.createHandoff({
      id: selected.handoffId,
      roomId: "arena-room",
      settings: selected.settings,
      blue: selected.blue,
      red: selected.red,
      reservations: new Map(),
    });

    expect(coordinator.markClientReady(selected.handoffId, crew[0]!.id)).toBeUndefined();
    for (const player of crew) coordinator.markArenaJoined(selected.handoffId, player.id);
    for (const player of crew.slice(0, -1)) {
      expect(coordinator.markClientReady(selected.handoffId, player.id)?.complete).toBe(false);
    }
    expect(coordinator.markClientReady(selected.handoffId, crew.at(-1)!.id)?.complete).toBe(true);
    expect(coordinator.completeHandoff(selected.handoffId)).toHaveLength(8);
    expect(coordinator.metricsSnapshot()).toMatchObject({ queueTickets: 0, handoffs: 0 });
  });

  it("cancels a forming match as a whole and leaves those players eligible to queue again", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 8);
    for (const player of crew) coordinator.queueSolo(player.id, FOUR_MINUTES);
    const selected = coordinator.nextMatch()!;
    expect(coordinator.cancelQueue(crew[0]!.id).handoffId).toBe(selected.handoffId);
    expect(coordinator.cancelFormation(selected.handoffId)).toHaveLength(8);
    expect(coordinator.metricsSnapshot().queueTickets).toBe(0);
    expect(coordinator.queueSolo(crew[0]!.id, FOUR_MINUTES).members).toHaveLength(1);
  });
});
