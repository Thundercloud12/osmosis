import { randomBytes, randomInt, randomUUID } from "node:crypto";

import type { MatchmakingSnapshot, QuickPlaySettings } from "@osmosis/shared";
import { composeMatch, type QueueGroup } from "./TeamComposer";

export interface MatchmakingPlayer {
  id: string;
  sessionId: string;
  nickname: string;
  connected: boolean;
  partyCode: string | undefined;
  queueTicketId: string | undefined;
}

export interface PartyRecord {
  id: string;
  code: string;
  leaderId: string;
  memberIds: string[];
  settings: QuickPlaySettings;
  createdAt: number;
}

export interface QueueTicket extends QueueGroup<MatchmakingPlayer> {
  partyCode?: string;
  settings: QuickPlaySettings;
  status: "QUEUED" | "FORMING" | "HANDOFF";
  handoffId: string | undefined;
}

export interface MatchHandoff {
  id: string;
  roomId: string;
  settings: QuickPlaySettings;
  blue: QueueTicket[];
  red: QueueTicket[];
  reservations: Map<string, unknown>;
  joinedPlayerIds: Set<string>;
  clientReadyPlayerIds: Set<string>;
  createdAt: number;
}

export interface MatchmakingRemoval {
  affectedPlayerIds: string[];
  handoffId?: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MatchmakingCoordinator {
  private readonly playersBySession = new Map<string, MatchmakingPlayer>();
  private readonly playersById = new Map<string, MatchmakingPlayer>();
  private readonly partiesByCode = new Map<string, PartyRecord>();
  private readonly tickets = new Map<string, QueueTicket>();
  private readonly handoffs = new Map<string, MatchHandoff>();

  registerPlayer(sessionId: string, nickname: string): MatchmakingPlayer {
    const player: MatchmakingPlayer = {
      id: randomUUID(), sessionId, nickname, connected: true,
      partyCode: undefined, queueTicketId: undefined,
    };
    this.playersBySession.set(sessionId, player);
    this.playersById.set(player.id, player);
    return player;
  }

  getPlayerBySession(sessionId: string): MatchmakingPlayer | undefined {
    return this.playersBySession.get(sessionId);
  }

  setConnected(sessionId: string, connected: boolean): MatchmakingPlayer | undefined {
    const player = this.playersBySession.get(sessionId);
    if (player) player.connected = connected;
    return player;
  }

  createParty(playerId: string, settings: QuickPlaySettings, now = Date.now()): PartyRecord {
    const player = this.requireAvailablePlayer(playerId);
    if (player.partyCode) throw new Error("Leave your current crew before creating another party.");
    this.assertSettingsFit(settings, [player]);
    const code = this.createPartyCode();
    const party: PartyRecord = {
      id: randomUUID(), code, leaderId: playerId, memberIds: [playerId],
      settings, createdAt: now,
    };
    this.partiesByCode.set(code, party);
    player.partyCode = code;
    return party;
  }

  joinParty(playerId: string, code: string): PartyRecord {
    const player = this.requireAvailablePlayer(playerId);
    if (player.partyCode) throw new Error("Leave your current crew before joining another party.");
    const party = this.partiesByCode.get(code.toUpperCase());
    if (!party) throw new Error("That crew code has expired or is invalid.");
    if (this.partyTicket(party.code)) throw new Error("That crew is already searching for a match.");
    if (party.memberIds.length >= party.settings.teamSize) throw new Error("That crew is full.");
    party.memberIds.push(playerId);
    player.partyCode = party.code;
    return party;
  }

  updatePartySettings(playerId: string, settings: QuickPlaySettings): PartyRecord {
    const party = this.requirePartyFor(playerId);
    if (party.leaderId !== playerId) throw new Error("Only the crew leader can change Quick Play settings.");
    if (party.memberIds.length > settings.teamSize) throw new Error("Your crew is larger than that team size.");
    if (this.partyTicket(party.code)) throw new Error("Cancel the queue before changing crew settings.");
    party.settings = settings;
    return party;
  }

  leaveParty(playerId: string): MatchmakingRemoval {
    const player = this.requirePlayer(playerId);
    if (player.queueTicketId) throw new Error("Cancel Quick Play before leaving your crew.");
    const party = player.partyCode ? this.partiesByCode.get(player.partyCode) : undefined;
    if (!party) return { affectedPlayerIds: [playerId] };
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    player.partyCode = undefined;
    if (party.memberIds.length === 0) this.partiesByCode.delete(party.code);
    else if (party.leaderId === playerId) party.leaderId = this.connectedMembers(party)[0]?.id ?? party.memberIds[0]!;
    return { affectedPlayerIds: [playerId] };
  }

  queueSolo(playerId: string, settings: QuickPlaySettings, now = Date.now()): QueueTicket {
    const player = this.requireAvailablePlayer(playerId);
    if (player.partyCode) throw new Error("Leave your crew before queuing solo.");
    return this.createTicket([player], undefined, settings, now);
  }

  queueParty(playerId: string, now = Date.now()): QueueTicket {
    const party = this.requirePartyFor(playerId);
    if (party.leaderId !== playerId) throw new Error("Only the crew leader can queue your party.");
    if (this.partyTicket(party.code)) throw new Error("Your crew is already in Quick Play.");
    const members = party.memberIds.map((memberId) => this.requirePlayer(memberId));
    if (members.some((member) => !member.connected)) throw new Error("Everyone in your crew must reconnect before queuing.");
    return this.createTicket(members, party.code, party.settings, now);
  }

  cancelQueue(playerId: string): MatchmakingRemoval {
    const player = this.requirePlayer(playerId);
    const ticket = player.queueTicketId ? this.tickets.get(player.queueTicketId) : undefined;
    if (!ticket) return { affectedPlayerIds: [playerId] };
    if (ticket.partyCode) {
      const party = this.partiesByCode.get(ticket.partyCode);
      if (party && party.leaderId !== playerId) throw new Error("Only the crew leader can cancel this queue.");
    }
    if (ticket.status === "FORMING" || ticket.status === "HANDOFF") {
      return { affectedPlayerIds: ticket.members.map((member) => member.id), ...(ticket.handoffId ? { handoffId: ticket.handoffId } : {}) };
    }
    return { affectedPlayerIds: this.cancelTickets([ticket]) };
  }

  removePlayer(sessionId: string): MatchmakingRemoval {
    const player = this.playersBySession.get(sessionId);
    if (!player) return { affectedPlayerIds: [] };
    const ticket = player.queueTicketId ? this.tickets.get(player.queueTicketId) : undefined;
    const affectedPlayerIds = ticket ? ticket.members.map((member) => member.id) : [player.id];
    if (ticket && ticket.status !== "HANDOFF") this.cancelTickets([ticket]);
    const handoff = ticket?.handoffId ? this.handoffs.get(ticket.handoffId) : undefined;
    const playerAlreadyJoinedArena = Boolean(handoff?.joinedPlayerIds.has(player.id));
    const party = player.partyCode ? this.partiesByCode.get(player.partyCode) : undefined;
    if (party) {
      party.memberIds = party.memberIds.filter((id) => id !== player.id);
      player.partyCode = undefined;
      if (party.memberIds.length === 0) this.partiesByCode.delete(party.code);
      else if (party.leaderId === player.id) party.leaderId = this.connectedMembers(party)[0]?.id ?? party.memberIds[0]!;
    }
    this.playersBySession.delete(sessionId);
    this.playersById.delete(player.id);
    return {
      affectedPlayerIds,
      ...(!playerAlreadyJoinedArena && ticket?.handoffId ? { handoffId: ticket.handoffId } : {}),
    };
  }

  nextMatch(): { settings: QuickPlaySettings; blue: QueueTicket[]; red: QueueTicket[]; handoffId: string } | undefined {
    const keys = new Set([...this.tickets.values()]
      .filter((ticket) => ticket.status === "QUEUED" && ticket.members.every((member) => member.connected))
      .map((ticket) => settingsKey(ticket.settings)));
    for (const key of keys) {
      const eligible = [...this.tickets.values()]
        .filter((ticket) => ticket.status === "QUEUED" && ticket.members.every((member) => member.connected) && settingsKey(ticket.settings) === key);
      const settings = eligible[0]?.settings;
      if (!settings) continue;
      const composition = composeMatch(eligible, settings.teamSize);
      if (!composition) continue;
      const selected = [...composition.blue, ...composition.red];
      const handoffId = randomBytes(16).toString("base64url");
      for (const ticket of selected) {
        ticket.status = "FORMING";
        ticket.handoffId = handoffId;
      }
      return { settings, blue: composition.blue, red: composition.red, handoffId };
    }
    return undefined;
  }

  releaseFormation(handoffId: string): string[] {
    const affected: string[] = [];
    for (const ticket of this.tickets.values()) {
      if (ticket.handoffId !== handoffId || ticket.status !== "FORMING") continue;
      ticket.status = "QUEUED";
      ticket.handoffId = undefined;
      affected.push(...ticket.members.map((member) => member.id));
    }
    return affected;
  }

  isFormationActive(handoffId: string): boolean {
    return [...this.tickets.values()].some((ticket) => ticket.status === "FORMING" && ticket.handoffId === handoffId);
  }

  cancelFormation(handoffId: string): string[] {
    const tickets = [...this.tickets.values()].filter((ticket) => ticket.status === "FORMING" && ticket.handoffId === handoffId);
    return this.cancelTickets(tickets);
  }

  createHandoff(input: Omit<MatchHandoff, "joinedPlayerIds" | "clientReadyPlayerIds" | "createdAt">, now = Date.now()): void {
    for (const ticket of [...input.blue, ...input.red]) {
      if (ticket.status !== "FORMING" || ticket.handoffId !== input.id) throw new Error("The queue group changed before reservation.");
      ticket.status = "HANDOFF";
    }
    this.handoffs.set(input.id, {
      ...input,
      joinedPlayerIds: new Set(),
      clientReadyPlayerIds: new Set(),
      createdAt: now,
    });
  }

  handoffForPlayer(playerId: string): MatchHandoff | undefined {
    const ticketId = this.playersById.get(playerId)?.queueTicketId;
    const ticket = ticketId ? this.tickets.get(ticketId) : undefined;
    return ticket?.handoffId ? this.handoffs.get(ticket.handoffId) : undefined;
  }

  markArenaJoined(handoffId: string, playerId: string): { complete: boolean; playerIds: string[] } | undefined {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return undefined;
    const expected = [...handoff.blue, ...handoff.red].flatMap((ticket) => ticket.members.map((member) => member.id));
    if (!expected.includes(playerId)) return undefined;
    handoff.joinedPlayerIds.add(playerId);
    return { complete: handoff.joinedPlayerIds.size === expected.length, playerIds: expected };
  }

  markClientReady(handoffId: string, playerId: string): { complete: boolean; playerIds: string[] } | undefined {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || !handoff.joinedPlayerIds.has(playerId)) return undefined;
    const expected = [...handoff.blue, ...handoff.red].flatMap((ticket) => ticket.members.map((member) => member.id));
    if (!expected.includes(playerId)) return undefined;
    handoff.clientReadyPlayerIds.add(playerId);
    return {
      complete: handoff.joinedPlayerIds.size === expected.length && handoff.clientReadyPlayerIds.size === expected.length,
      playerIds: expected,
    };
  }

  completeHandoff(handoffId: string): string[] {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return [];
    const ids = [...handoff.blue, ...handoff.red].flatMap((ticket) => ticket.members.map((member) => member.id));
    for (const ticket of [...handoff.blue, ...handoff.red]) this.tickets.delete(ticket.id);
    for (const id of ids) {
      const player = this.playersById.get(id);
      if (player) {
        player.queueTicketId = undefined;
        if (player.partyCode) this.partiesByCode.delete(player.partyCode);
        player.partyCode = undefined;
        this.playersById.delete(id);
        this.playersBySession.delete(player.sessionId);
      }
    }
    this.handoffs.delete(handoffId);
    return ids;
  }

  abortHandoff(handoffId: string): { roomId: string; playerIds: string[] } | undefined {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return undefined;
    const tickets = [...handoff.blue, ...handoff.red];
    const playerIds = tickets.flatMap((ticket) => ticket.members.map((member) => member.id));
    for (const ticket of tickets) {
      ticket.status = "QUEUED";
      ticket.handoffId = undefined;
    }
    this.handoffs.delete(handoffId);
    return { roomId: handoff.roomId, playerIds };
  }

  cancelHandoff(handoffId: string): { roomId: string; playerIds: string[] } | undefined {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return undefined;
    const tickets = [...handoff.blue, ...handoff.red];
    const playerIds = tickets.flatMap((ticket) => ticket.members.map((member) => member.id));
    this.cancelTickets(tickets);
    this.handoffs.delete(handoffId);
    return { roomId: handoff.roomId, playerIds };
  }

  snapshotFor(sessionId: string, now = Date.now()): MatchmakingSnapshot | undefined {
    const player = this.playersBySession.get(sessionId);
    if (!player) return undefined;
    const party = player.partyCode ? this.partiesByCode.get(player.partyCode) : undefined;
    const ticket = player.queueTicketId ? this.tickets.get(player.queueTicketId) : undefined;
    const waitingPlayers = ticket?.status === "QUEUED"
      ? [...this.tickets.values()]
        .filter((candidate) => candidate.status === "QUEUED"
          && candidate.members.every((member) => member.connected)
          && sameSettings(candidate.settings, ticket.settings))
        .reduce((sum, candidate) => sum + candidate.members.length, 0)
      : 0;
    return {
      selfPlayerId: player.id,
      selfNickname: player.nickname,
      party: party ? {
        code: party.code,
        leaderId: party.leaderId,
        settings: party.settings,
        members: party.memberIds.flatMap((id) => {
          const member = this.playersById.get(id);
          return member ? [{ id: member.id, nickname: member.nickname, connected: member.connected }] : [];
        }),
      } : null,
      queue: ticket ? {
        status: ticket.status === "QUEUED" ? "SEARCHING" : "MATCH_FOUND",
        isPaused: ticket.status === "QUEUED" && ticket.members.some((member) => !member.connected),
        settings: ticket.settings,
        partySize: ticket.members.length,
        playersNeeded: Math.max(0, ticket.settings.teamSize * 2 - waitingPlayers),
        estimatedPlayersWaiting: waitingPlayers,
        waitSeconds: Math.max(0, Math.floor((now - ticket.createdAt) / 1_000)),
      } : null,
    };
  }

  metricsSnapshot() {
    const queued = [...this.tickets.values()].filter((ticket) => ticket.status === "QUEUED");
    const forming = [...this.tickets.values()].filter((ticket) => ticket.status !== "QUEUED");
    return {
      parties: this.partiesByCode.size,
      queueTickets: queued.length,
      queuedPlayers: queued.reduce((sum, ticket) => sum + ticket.members.length, 0),
      handoffPlayers: forming.reduce((sum, ticket) => sum + ticket.members.length, 0),
      handoffs: this.handoffs.size,
    };
  }

  getAllPlayers(): MatchmakingPlayer[] { return [...this.playersById.values()]; }

  getPlayerById(playerId: string): MatchmakingPlayer | undefined { return this.playersById.get(playerId); }

  getHandoff(handoffId: string): MatchHandoff | undefined { return this.handoffs.get(handoffId); }

  private createTicket(members: MatchmakingPlayer[], partyCode: string | undefined, settings: QuickPlaySettings, now: number): QueueTicket {
    this.assertSettingsFit(settings, members);
    if (members.some((member) => member.queueTicketId)) throw new Error("Someone in your crew is already queued.");
    const ticket: QueueTicket = {
      id: randomUUID(), createdAt: now, members, settings, status: "QUEUED", handoffId: undefined,
      ...(partyCode ? { partyCode } : {}),
    };
    this.tickets.set(ticket.id, ticket);
    for (const member of members) member.queueTicketId = ticket.id;
    return ticket;
  }

  private cancelTickets(tickets: QueueTicket[]): string[] {
    const ids = tickets.flatMap((ticket) => ticket.members.map((member) => member.id));
    for (const ticket of tickets) {
      this.tickets.delete(ticket.id);
      for (const member of ticket.members) member.queueTicketId = undefined;
    }
    return ids;
  }

  private requirePlayer(playerId: string): MatchmakingPlayer {
    const player = this.playersById.get(playerId);
    if (!player) throw new Error("Your crew session has expired. Rejoin Quick Play.");
    return player;
  }

  private requireAvailablePlayer(playerId: string): MatchmakingPlayer {
    const player = this.requirePlayer(playerId);
    if (!player.connected) throw new Error("Reconnect before changing your crew.");
    if (player.queueTicketId) throw new Error("Cancel Quick Play before changing your crew.");
    return player;
  }

  private requirePartyFor(playerId: string): PartyRecord {
    const player = this.requirePlayer(playerId);
    const party = player.partyCode ? this.partiesByCode.get(player.partyCode) : undefined;
    if (!party) throw new Error("You are not in a crew party.");
    if (this.partyTicket(party.code)) throw new Error("Cancel Quick Play before changing your crew.");
    return party;
  }

  private partyTicket(code: string): QueueTicket | undefined {
    return [...this.tickets.values()].find((ticket) => ticket.partyCode === code);
  }

  private connectedMembers(party: PartyRecord): MatchmakingPlayer[] {
    return party.memberIds.flatMap((id) => {
      const player = this.playersById.get(id);
      return player?.connected ? [player] : [];
    });
  }

  private assertSettingsFit(settings: QuickPlaySettings, members: MatchmakingPlayer[]): void {
    if (members.length > settings.teamSize) throw new Error("Your crew is larger than the selected team size.");
  }

  private createPartyCode(): string {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      if (!this.partiesByCode.has(code)) return code;
    }
  }
}

function settingsKey(settings: QuickPlaySettings): string {
  return `${settings.teamSize}:${settings.matchDurationSeconds}`;
}

function sameSettings(left: QuickPlaySettings, right: QuickPlaySettings): boolean {
  return settingsKey(left) === settingsKey(right);
}
