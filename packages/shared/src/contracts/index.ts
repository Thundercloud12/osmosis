import { z } from "zod";
import { GAME_RULES } from "../constants";

export const matchPhaseSchema = z.enum([
  "LOBBY",
  "ALLOCATION",
  "COUNTDOWN",
  "PLAYING",
  "RESULTS",
]);

export const roomModeSchema = z.enum(["STANDARD", "TEST_1V1", "TEST_2V2"]);
export type RoomMode = z.infer<typeof roomModeSchema>;

export const matchSettingsSchema = z.object({
  teamSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(5)]),
  matchDurationSeconds: z.number().int()
    .min(GAME_RULES.minimumMatchDurationSeconds)
    .max(GAME_RULES.maximumMatchDurationSeconds)
    .multipleOf(GAME_RULES.matchDurationStepSeconds),
}).strict();
export const matchSettingsInputSchema = matchSettingsSchema.partial().strict();
export type MatchSettings = z.infer<typeof matchSettingsSchema>;

export const roomCreationOptionsSchema = z.object({
  roomMode: roomModeSchema.optional(),
  matchSettings: matchSettingsInputSchema.optional(),
});

const movementAxisSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    dx: movementAxisSchema,
    dy: movementAxisSchema,
  }),
  z.object({
    type: z.literal("interact"),
    targetId: z.string().min(1).max(64).optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("linkStart"),
    teammateId: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal("linkStop") }),
  z.object({ type: z.literal("rematch") }),
  z.object({ type: z.literal("ping") }).strict(),
  z.object({
    type: z.literal("reportPlayer"),
    targetPlayerId: z.string().min(1).max(64),
    category: z.enum(["CHEATING", "HARASSMENT", "OTHER"]),
  }).strict(),
  z.object({ type: z.literal("ready"), ready: z.boolean() }),
  z.object({ type: z.literal("chooseTeam"), teamId: z.enum(["BLUE", "RED"]) }),
  z.object({ type: z.literal("captain"), action: z.enum(["claim", "release"]) }),
  z.object({ type: z.literal("beginAllocation") }),
  z.object({
    type: z.literal("allocate"),
    pointsByPlayerId: z.record(z.string(), z.number().int().nonnegative()),
  }),
  z.object({ type: z.literal("lockAllocation") }),
  z.object({ type: z.literal("startCountdown") }),
  z.object({ type: z.literal("cancelCountdown") }),
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type MatchPhase = z.infer<typeof matchPhaseSchema>;

export const playerStatusSchema = z.enum(["ACTIVE", "INACTIVE", "ELIMINATED", "DISCONNECTED"]);
export type PlayerStatus = z.infer<typeof playerStatusSchema>;

export interface PlayerSummary {
  id: string;
  nickname: string;
  teamId: "BLUE" | "RED";
  status: PlayerStatus;
}

export const playerSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  nickname: z.string().min(1).max(24),
  teamId: z.enum(["BLUE", "RED"]),
  status: playerStatusSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  poleHolder: z.boolean().optional(),
  acknowledgedInputSeq: z.number().int().min(-1).optional(),
  inactiveSecondsRemaining: z.number().int().nonnegative().optional(),
  frozenSecondsRemaining: z.number().int().nonnegative().optional(),
  points: z.number().int().nonnegative().optional(),
  linkedPlayerId: z.string().min(1).max(64).optional(),
});

export const roomSnapshotSchema = z.object({
  phase: z.enum(["PLAYING", "RESULTS"]),
  matchSettings: matchSettingsSchema,
  selfPlayerId: z.string().min(1).max(64),
  hostPlayerId: z.string().min(1).max(64).optional(),
  connectedPlayerCount: z.number().int().min(0).max(10),
  serverTime: z.number().finite(),
  remainingSeconds: z.number().int().min(0).max(GAME_RULES.maximumMatchDurationSeconds),
  players: z.array(playerSnapshotSchema).max(10),
  helpPings: z.array(z.object({
    playerId: z.string().min(1).max(64),
    remainingMs: z.number().int().positive().max(4_000),
  })).max(5),
  spectatorTargetId: z.string().min(1).max(64).optional(),
  teamScores: z.object({ BLUE: z.number().int().nonnegative().nullable(), RED: z.number().int().nonnegative().nullable() }),
  pickups: z.array(z.object({ id: z.string().min(1), x: z.number().finite(), y: z.number().finite() })).max(32),
  selfRaid: z.object({ progressSeconds: z.number().finite().nonnegative(), cooldownSecondsRemaining: z.number().int().nonnegative() }).nullable(),
  result: z.object({
    winnerTeam: z.enum(["BLUE", "RED"]).nullable(),
    matchSettings: matchSettingsSchema,
    teamScores: z.object({ BLUE: z.number().int().nonnegative(), RED: z.number().int().nonnegative() }),
    players: z.array(z.object({
      id: z.string().min(1).max(64),
      nickname: z.string().min(1).max(24),
      teamId: z.enum(["BLUE", "RED"]),
      points: z.number().int().nonnegative(),
      pickupsCollected: z.number().int().nonnegative(),
      battlesWon: z.number().int().nonnegative(),
      raidsCompleted: z.number().int().nonnegative(),
    })).max(10),
  }).nullable(),
});

const gameEventIdSchema = z.string().min(1).max(48);
const eventPlayerSchema = z.object({
  playerId: z.string().min(1).max(64),
  teamId: z.enum(["BLUE", "RED"]),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const gameEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("battleResolved"),
    eventId: gameEventIdSchema,
    participants: z.array(eventPlayerSchema.extend({
      outcome: z.enum(["WIN", "LOSS", "TIE", "ELIMINATED"]),
    })).min(2).max(4),
  }),
  z.object({
    type: z.literal("poleElimination"),
    eventId: gameEventIdSchema,
    attacker: eventPlayerSchema,
    holder: eventPlayerSchema,
  }),
  z.object({
    type: z.literal("raidFeedback"),
    eventId: gameEventIdSchema,
    stage: z.enum(["STARTED", "INTERRUPTED", "COMPLETED"]),
    raiderPlayerId: z.string().min(1).max(64),
    teamId: z.enum(["BLUE", "RED"]),
    baseTeamId: z.enum(["BLUE", "RED"]),
  }),
]);

export type GameEvent = z.infer<typeof gameEventSchema>;

export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const lobbyPlayerSchema = z.object({
  id: z.string().min(1).max(64),
  nickname: z.string().min(1).max(24),
  teamId: z.enum(["BLUE", "RED"]),
  ready: z.boolean(),
  connected: z.boolean(),
  isHost: z.boolean(),
  isCaptain: z.boolean(),
  startingPoints: z.number().int().min(500).optional(),
});

export const lobbySnapshotSchema = z.object({
  roomCode: z.string().length(6).regex(/^[A-Z2-9]+$/),
  roomMode: roomModeSchema,
  matchSettings: matchSettingsSchema,
  phase: matchPhaseSchema,
  selfPlayerId: z.string().min(1).max(64),
  voiceCredential: z.string().min(20).max(2_048),
  voiceRoomName: z.string().min(1).max(128),
  hostPlayerId: z.string().min(1).max(64),
  teamSelectionLocked: z.boolean(),
  connectedPlayerCount: z.number().int().min(0).max(10),
  players: z.array(lobbyPlayerSchema).max(10),
  captainIds: z.object({
    BLUE: z.string().min(1).max(64).nullable(),
    RED: z.string().min(1).max(64).nullable(),
  }),
  ownTeamAllocation: z.array(z.object({
    playerId: z.string().min(1).max(64),
    points: z.number().int().min(500).nullable(),
  })).max(5),
  ownTeamLocked: z.boolean(),
  allocationComplete: z.boolean(),
  countdownSecondsRemaining: z.number().int().min(0).max(10).nullable(),
});

export type LobbyPlayer = z.infer<typeof lobbyPlayerSchema>;
export type LobbySnapshot = z.infer<typeof lobbySnapshotSchema>;
export type LobbyCommand = Extract<
  ClientCommand,
  { type: "chooseTeam" | "captain" | "beginAllocation" | "ready" | "allocate" | "lockAllocation" | "startCountdown" | "cancelCountdown" }
>;
export type GameCommand = Extract<ClientCommand, { type: "interact" | "linkStart" | "linkStop" | "ping" | "reportPlayer" | "rematch" }>;

export const quickPlayTeamSizeSchema = z.union([z.literal(4), z.literal(5)]);
export const quickPlayDurationSchema = z.union([
  z.literal(300), z.literal(600), z.literal(900), z.literal(1200),
]);
export const quickPlaySettingsSchema = z.object({
  teamSize: quickPlayTeamSizeSchema,
  matchDurationSeconds: quickPlayDurationSchema,
}).strict();
export type QuickPlaySettings = z.infer<typeof quickPlaySettingsSchema>;

export const matchmakingPartySnapshotSchema = z.object({
  code: z.string().length(6).regex(/^[A-Z2-9]+$/),
  leaderId: z.string().min(1).max(64),
  settings: quickPlaySettingsSchema,
  members: z.array(z.object({
    id: z.string().min(1).max(64),
    nickname: z.string().min(1).max(24),
    connected: z.boolean(),
  }).strict()).min(1).max(5),
}).strict();

export const matchmakingSnapshotSchema = z.object({
  selfPlayerId: z.string().min(1).max(64),
  selfNickname: z.string().min(1).max(24),
  party: matchmakingPartySnapshotSchema.nullable(),
  queue: z.object({
    status: z.enum(["SEARCHING", "MATCH_FOUND"]),
    isPaused: z.boolean(),
    settings: quickPlaySettingsSchema,
    partySize: z.number().int().min(1).max(5),
    playersNeeded: z.number().int().min(0).max(10),
    estimatedPlayersWaiting: z.number().int().min(0),
    waitSeconds: z.number().int().min(0),
  }).strict().nullable(),
}).strict();
export type MatchmakingSnapshot = z.infer<typeof matchmakingSnapshotSchema>;

export const matchmakingCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createParty"), settings: quickPlaySettingsSchema }).strict(),
  z.object({ type: z.literal("joinParty"), code: z.string().length(6).regex(/^[A-Z2-9]+$/) }).strict(),
  z.object({ type: z.literal("leaveParty") }).strict(),
  z.object({ type: z.literal("updatePartySettings"), settings: quickPlaySettingsSchema }).strict(),
  z.object({ type: z.literal("queueSolo"), settings: quickPlaySettingsSchema }).strict(),
  z.object({ type: z.literal("queueParty") }).strict(),
  z.object({ type: z.literal("cancelQueue") }).strict(),
]);
export type MatchmakingCommand = z.infer<typeof matchmakingCommandSchema>;
