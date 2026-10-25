export const GAME_RULES = {
  teamSize: 5,
  matchDurationSeconds: 900,
  startingTeamPoints: 10_000,
  allocationIncrement: 100,
  battleTransfer: 500,
  pickupReward: 200,
  raidReward: 2_000,
  raidChannelSeconds: 3,
  raidCooldownSeconds: 90,
  reconnectGraceSeconds: 60,
  countdownSeconds: 5,
  simulationHz: 20,
  maxLinkGroupSize: 2,
} as const;

export const MOVEMENT_CONFIG = {
  speed: 260,
  playerRadius: 22,
  viewRadius: 430,
  linkRadius: 120,
} as const;

export const ARENA_CONFIG = {
  width: 2_800,
  height: 1_600,
  boundaryThickness: 48,
} as const;

export const TEAM_IDS = ["BLUE", "RED"] as const;

export type TeamId = (typeof TEAM_IDS)[number];
