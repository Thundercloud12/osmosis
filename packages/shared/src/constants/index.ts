export const GAME_RULES = {
  teamSize: 5,
  matchDurationSeconds: 900,
  minimumMatchDurationSeconds: 300,
  maximumMatchDurationSeconds: 1_800,
  matchDurationStepSeconds: 60,
  startingTeamPoints: 10_000,
  minimumStartingPointsPerPlayer: 500,
  allocationIncrement: 100,
  battleTransfer: 500,
  inactiveContactFreezeSeconds: 3,
  pickupReward: 200,
  raidReward: 2_000,
  raidChannelSeconds: 3,
  raidCooldownSeconds: 90,
  battleInactivitySeconds: 15,
  helpPingDurationSeconds: 4,
  helpPingCooldownSeconds: 3,
  hqPoleTouchRadius: 36,
  reconnectGraceSeconds: 120,
  countdownSeconds: 5,
  simulationHz: 20,
  maxLinkGroupSize: 2,
} as const;

export const QUICK_PLAY_DURATION_PRESETS_SECONDS = [300, 600, 900, 1_200] as const;

export const MOVEMENT_CONFIG = {
  speed: 260,
  playerRadius: 22,
  viewRadius: 430,
  linkRadius: 120,
} as const;

export const ARENA_CONFIG = {
  width: 11_232,
  height: 5_376,
  boundaryThickness: 48,
} as const;

export const TEAM_IDS = ["BLUE", "RED"] as const;

export type TeamId = (typeof TEAM_IDS)[number];
