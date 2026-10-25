import { z } from "zod";

export const matchPhaseSchema = z.enum([
  "LOBBY",
  "ALLOCATION",
  "COUNTDOWN",
  "PLAYING",
  "RESULTS",
]);

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
  z.object({
    type: z.literal("ping"),
    x: z.number().finite(),
    y: z.number().finite(),
    kind: z.enum(["help", "attack", "defend"]),
  }),
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

export interface PlayerSummary {
  id: string;
  nickname: string;
  teamId: "BLUE" | "RED";
  status: "ACTIVE" | "INACTIVE" | "DISCONNECTED";
}

export const playerSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  nickname: z.string().min(1).max(24),
  teamId: z.enum(["BLUE", "RED"]),
  status: z.enum(["ACTIVE", "INACTIVE", "DISCONNECTED"]),
  x: z.number().finite(),
  y: z.number().finite(),
  points: z.number().int().nonnegative().optional(),
  linkedPlayerId: z.string().min(1).max(64).optional(),
});

export const roomSnapshotSchema = z.object({
  phase: z.enum(["PLAYING", "RESULTS"]),
  selfPlayerId: z.string().min(1).max(64),
  connectedPlayerCount: z.number().int().min(1).max(10),
  serverTime: z.number().finite(),
  remainingSeconds: z.number().int().min(0).max(900),
  players: z.array(playerSnapshotSchema).max(10),
  teamScores: z.object({ BLUE: z.number().int().nonnegative(), RED: z.number().int().nonnegative() }),
  pickups: z.array(z.object({ id: z.string().min(1), x: z.number().finite(), y: z.number().finite() })).max(32),
  selfRaid: z.object({ progressSeconds: z.number().finite().nonnegative(), cooldownSecondsRemaining: z.number().int().nonnegative() }).nullable(),
  result: z.object({
    winnerTeam: z.enum(["BLUE", "RED"]).nullable(),
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
  startingPoints: z.number().int().nonnegative().optional(),
});

export const lobbySnapshotSchema = z.object({
  roomCode: z.string().length(6).regex(/^[A-Z2-9]+$/),
  phase: matchPhaseSchema,
  selfPlayerId: z.string().min(1).max(64),
  voiceCredential: z.string().min(20).max(2_048),
  voiceRoomName: z.string().min(1).max(128),
  hostPlayerId: z.string().min(1).max(64),
  connectedPlayerCount: z.number().int().min(1).max(10),
  players: z.array(lobbyPlayerSchema).max(10),
  captainIds: z.object({
    BLUE: z.string().min(1).max(64).nullable(),
    RED: z.string().min(1).max(64).nullable(),
  }),
  ownTeamAllocation: z.array(z.object({
    playerId: z.string().min(1).max(64),
    points: z.number().int().nonnegative().nullable(),
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
export type GameCommand = Extract<ClientCommand, { type: "interact" | "linkStart" | "linkStop" | "ping" | "rematch" }>;
