import { describe, expect, it } from "vitest";

import { QUICK_PLAY_SETTINGS } from "@osmosis/shared";
import { MatchmakingCoordinator } from "./MatchmakingCoordinator";

function players(coordinator: MatchmakingCoordinator, count: number) {
  return Array.from({ length: count }, (_, index) => coordinator.registerPlayer(`session-${index}`, `Crew ${index}`));
}

describe("MatchmakingCoordinator", () => {
  it("keeps a party intact while composing exact teams from queued solos", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 10);
    const party = coordinator.createParty(crew[0]!.id);
    coordinator.joinParty(crew[1]!.id, party.code);
    const partyTicket = coordinator.queueParty(crew[0]!.id);
    for (const player of crew.slice(2)) coordinator.queueSolo(player.id);

    const selected = coordinator.nextMatch();

    expect(selected).toBeDefined();
    expect(selected!.settings).toEqual(QUICK_PLAY_SETTINGS);
    expect(selected!.blue.reduce((count, ticket) => count + ticket.members.length, 0)).toBe(5);
    expect(selected!.red.reduce((count, ticket) => count + ticket.members.length, 0)).toBe(5);
    expect(selected!.blue.some((ticket) => ticket.id === partyTicket.id)
      || selected!.red.some((ticket) => ticket.id === partyTicket.id)).toBe(true);
    expect(partyTicket.members.map((member) => member.id)).toEqual([crew[0]!.id, crew[1]!.id]);
  });

  it("assigns the oldest ten tickets first, including when their timestamps tie", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 12);
    const tickets = crew.map((player) => coordinator.queueSolo(player.id, 100));

    const selected = coordinator.nextMatch();

    expect(selected).toBeDefined();
    const selectedOrders = [...selected!.blue, ...selected!.red].map((ticket) => ticket.queueOrder).sort((a, b) => a - b);
    expect(selectedOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tickets[10]!.status).toBe("QUEUED");
    expect(tickets[11]!.status).toBe("QUEUED");
    expect(selected!.settings).toEqual(QUICK_PLAY_SETTINGS);
  });

  it("rejects party overflow, repeat membership, and non-leader queue cancellation", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 6);
    const party = coordinator.createParty(crew[0]!.id);
    coordinator.joinParty(crew[1]!.id, party.code);
    expect(() => coordinator.joinParty(crew[1]!.id, party.code)).toThrow("Leave your current crew");
    coordinator.joinParty(crew[2]!.id, party.code);
    coordinator.joinParty(crew[3]!.id, party.code);
    coordinator.joinParty(crew[4]!.id, party.code);
    expect(() => coordinator.joinParty(crew[5]!.id, party.code)).toThrow("crew is full");
    coordinator.queueParty(crew[0]!.id);
    expect(() => coordinator.cancelQueue(crew[1]!.id)).toThrow("Only the crew leader");
    expect(coordinator.cancelQueue(crew[0]!.id).affectedPlayerIds).toHaveLength(5);
    expect(coordinator.snapshotFor(crew[1]!.sessionId)?.queue).toBeNull();
  });

  it("pauses a disconnected ticket and resumes eligibility on reconnection", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 10);
    for (const player of crew) coordinator.queueSolo(player.id);
    coordinator.setConnected(crew[3]!.sessionId, false);

    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.queue).toMatchObject({
      status: "SEARCHING", isPaused: false, estimatedPlayersWaiting: 9, playersNeeded: 1,
    });
    expect(coordinator.snapshotFor(crew[3]!.sessionId)?.queue).toMatchObject({
      status: "SEARCHING", isPaused: true, estimatedPlayersWaiting: 9, playersNeeded: 1,
    });
    expect(coordinator.nextMatch()).toBeUndefined();

    coordinator.setConnected(crew[3]!.sessionId, true);
    expect(coordinator.snapshotFor(crew[0]!.sessionId)?.queue?.isPaused).toBe(false);
    expect(coordinator.nextMatch()).toBeDefined();
  });

  it("removes a disconnected party member after grace and cancels that indivisible ticket", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 3);
    const party = coordinator.createParty(crew[0]!.id);
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
    const crew = players(coordinator, 10);
    for (const player of crew) coordinator.queueSolo(player.id);
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
    expect(coordinator.completeHandoff(selected.handoffId)).toHaveLength(10);
    expect(coordinator.metricsSnapshot()).toMatchObject({ queueTickets: 0, handoffs: 0 });
  });

  it("cancels the whole handoff if one player leaves before consuming their reserved seat", () => {
    const coordinator = new MatchmakingCoordinator();
    const crew = players(coordinator, 10);
    for (const player of crew) coordinator.queueSolo(player.id);
    const selected = coordinator.nextMatch()!;
    expect(coordinator.cancelQueue(crew[0]!.id).handoffId).toBe(selected.handoffId);
    expect(coordinator.cancelFormation(selected.handoffId)).toHaveLength(10);
    expect(coordinator.metricsSnapshot().queueTickets).toBe(0);
    expect(coordinator.queueSolo(crew[0]!.id).members).toHaveLength(1);
  });
});
