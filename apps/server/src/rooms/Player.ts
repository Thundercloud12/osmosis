import type { PlayerStatus, TeamId } from "@osmosis/shared";

export interface QueuedMovementInput {
  seq: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

export interface ServerPlayer {
  id: string;
  nickname: string;
  teamId: TeamId;
  x: number;
  y: number;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  lastSequence: number;
  lastAppliedSequence: number;
  pendingMoves: QueuedMovementInput[];
  ready: boolean;
  joinOrder: number;
  startingPoints: number | undefined;
  points: number;
  status: PlayerStatus;
  inactiveUntil: number;
  frozenUntil: number;
  connected: boolean;
  statusBeforeDisconnect: Exclude<PlayerStatus, "DISCONNECTED"> | undefined;
  reconnectUntil?: number | undefined;
  linkedPlayerId: string | undefined;
  voiceCredential: string | undefined;
  voiceCredentialExpiresAt: number;
  voiceCredentialRoomName: string | undefined;
  pickupsCollected: number;
  battlesWon: number;
  raidsCompleted: number;
}

export interface Pickup {
  id: string;
  x: number;
  y: number;
}
