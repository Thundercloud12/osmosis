import type { MovementInput, PlayerSnapshot, RoomSnapshot } from "@osmosis/shared";

export interface MovementTraceRow {
  at: number;
  kind: "input" | "frame" | "snapshot";
  sequence?: number | undefined;
  input?: MovementInput | undefined;
  serverTime?: number | undefined;
  acknowledgedInputSeq?: number | undefined;
  snapshotIntervalMs?: number | undefined;
  frameDeltaMs?: number | undefined;
  authoritative?: { x: number; y: number } | undefined;
  predicted?: { x: number; y: number } | undefined;
  rendered?: { x: number; y: number } | undefined;
  correctionDistance?: number | undefined;
  nearestPickupDistance?: number | undefined;
  frozenSecondsRemaining?: number | undefined;
  status?: PlayerSnapshot["status"] | undefined;
}

declare global {
  interface Window { __osmosisMovementTrace?: MovementTraceRow[] }
}

/** Opt-in browser trace: append ?movementDebug=1 and inspect window.__osmosisMovementTrace. */
export class MovementTrace {
  private readonly rows: MovementTraceRow[] = [];
  private lastSnapshotAt: number | undefined;
  private lastFrameAt: number | undefined;
  private lastLoggedFrameAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly enabled = new URLSearchParams(window.location.search).get("movementDebug") === "1") {
    if (this.enabled) window.__osmosisMovementTrace = this.rows;
  }

  input(sequence: number, input: MovementInput): void {
    this.push({ at: performance.now(), kind: "input", sequence, input });
  }

  snapshot(snapshot: RoomSnapshot, self: PlayerSnapshot, predicted: { x: number; y: number }): void {
    if (!this.enabled) return;
    const at = performance.now();
    this.push({
      at, kind: "snapshot", serverTime: snapshot.serverTime,
      snapshotIntervalMs: this.lastSnapshotAt === undefined ? undefined : at - this.lastSnapshotAt,
      acknowledgedInputSeq: self.acknowledgedInputSeq,
      authoritative: { x: self.x, y: self.y }, predicted,
      correctionDistance: Math.hypot(self.x - predicted.x, self.y - predicted.y),
      frozenSecondsRemaining: self.frozenSecondsRemaining,
      status: self.status,
      nearestPickupDistance: nearestPickup(self, snapshot),
    });
    this.lastSnapshotAt = at;
  }

  frame(deltaMs: number, self: PlayerSnapshot | undefined, snapshot: RoomSnapshot | undefined,
    predicted: { x: number; y: number }, rendered: { x: number; y: number }): void {
    if (!this.enabled) return;
    const at = performance.now();
    const frameDeltaMs = this.lastFrameAt === undefined ? deltaMs : at - this.lastFrameAt;
    this.lastFrameAt = at;
    if (at - this.lastLoggedFrameAt < 100) return;
    this.lastLoggedFrameAt = at;
    this.push({
      at, kind: "frame", frameDeltaMs, serverTime: snapshot?.serverTime,
      acknowledgedInputSeq: self?.acknowledgedInputSeq,
      authoritative: self ? { x: self.x, y: self.y } : undefined,
      predicted, rendered,
      correctionDistance: self ? Math.hypot(self.x - predicted.x, self.y - predicted.y) : undefined,
      frozenSecondsRemaining: self?.frozenSecondsRemaining,
      status: self?.status,
      nearestPickupDistance: self && snapshot ? nearestPickup(self, snapshot) : undefined,
    });
  }

  private push(row: MovementTraceRow): void {
    if (!this.enabled) return;
    this.rows.push(row);
    if (this.rows.length > 10_000) this.rows.splice(0, this.rows.length - 10_000);
    if (row.kind === "snapshot") console.debug("[osmosis-movement-trace]", row);
  }
}

function nearestPickup(self: PlayerSnapshot, snapshot: RoomSnapshot): number | undefined {
  if (snapshot.pickups.length === 0) return undefined;
  return Math.min(...snapshot.pickups.map((pickup) => Math.hypot(self.x - pickup.x, self.y - pickup.y)));
}
