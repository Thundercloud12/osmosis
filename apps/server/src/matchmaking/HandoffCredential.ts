import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { TeamId } from "@osmosis/shared";

const HANDOFF_SECRET = process.env.RECONNECT_SECRET || randomBytes(32).toString("base64url");

export interface QuickPlayHandoffClaims {
  version: 1;
  handoffId: string;
  roomId: string;
  queueRoomId: string;
  sessionId: string;
  playerId: string;
  nickname: string;
  teamId: TeamId;
  expiresAt: number;
}

export interface QuickPlayRoomSeatClaim {
  sessionId: string;
  playerId: string;
  nickname: string;
  teamId: TeamId;
}

export interface QuickPlayRoomClaims {
  version: 1;
  handoffId: string;
  queueRoomId: string;
  seats: QuickPlayRoomSeatClaim[];
  expiresAt: number;
}

export function issueHandoffCredential(claims: QuickPlayHandoffClaims): string {
  return sign(claims);
}

export function verifyHandoffCredential(value: unknown, now = Date.now()): QuickPlayHandoffClaims | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  const claims = verify<Partial<QuickPlayHandoffClaims>>(value);
  if (!claims) return undefined;
  if (claims.version !== 1 || !claims.handoffId || !claims.roomId || !claims.queueRoomId
    || !claims.sessionId || !claims.playerId || !claims.nickname
    || (claims.teamId !== "BLUE" && claims.teamId !== "RED")
    || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt! < now) return undefined;
  return claims as QuickPlayHandoffClaims;
}

export function issueQuickPlayRoomCredential(claims: QuickPlayRoomClaims): string {
  return sign(claims);
}

export function verifyQuickPlayRoomCredential(value: unknown, now = Date.now()): QuickPlayRoomClaims | undefined {
  if (typeof value !== "string" || value.length > 4_096) return undefined;
  const claims = verify<Partial<QuickPlayRoomClaims>>(value);
  if (!claims || claims.version !== 1 || !claims.handoffId || !claims.queueRoomId
    || !Array.isArray(claims.seats) || claims.seats.length < 8 || claims.seats.length > 10
    || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt! < now) return undefined;
  const sessionIds = new Set<string>();
  const playerIds = new Set<string>();
  for (const seat of claims.seats) {
    if (!seat || !seat.sessionId || !seat.playerId || !seat.nickname
      || (seat.teamId !== "BLUE" && seat.teamId !== "RED")
      || sessionIds.has(seat.sessionId) || playerIds.has(seat.playerId)) return undefined;
    sessionIds.add(seat.sessionId);
    playerIds.add(seat.playerId);
  }
  return claims as QuickPlayRoomClaims;
}

function sign(claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", HANDOFF_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verify<T>(value: string): T | undefined {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return undefined;
  const expected = createHmac("sha256", HANDOFF_SECRET).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T; }
  catch { return undefined; }
}
