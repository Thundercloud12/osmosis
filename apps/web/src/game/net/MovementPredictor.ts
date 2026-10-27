import { stepMovement, type ForbiddenCircle, type MovementInput } from "@osmosis/shared";

interface PendingInput extends MovementInput { seq: number }

const STEP_SECONDS = 1 / 20;
const STEP_MILLISECONDS = STEP_SECONDS * 1_000;
const MAX_PENDING_INPUTS = 128;
const MAX_SMOOTH_CORRECTION = 40;

/** Fixed-step local prediction with server-acknowledged input replay. */
export class MovementPredictor {
  private x: number;
  private y: number;
  private accumulator = 0;
  private pending: PendingInput[] = [];
  private renderOffsetX = 0;
  private renderOffsetY = 0;

  constructor(position: { x: number; y: number }) {
    this.x = position.x;
    this.y = position.y;
  }

  advance(
    deltaMilliseconds: number,
    input: MovementInput,
    send: (input: MovementInput) => number,
    forbiddenCircles: readonly ForbiddenCircle[] = [],
  ): { x: number; y: number } {
    this.accumulator += Math.min(Math.max(deltaMilliseconds, 0), 250);
    while (this.accumulator >= STEP_MILLISECONDS) {
      const command = { ...input, seq: send(input) };
      this.pending.push(command);
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
      const next = stepMovement({ x: this.x, y: this.y }, command, STEP_SECONDS, { forbiddenCircles });
      this.x = next.x;
      this.y = next.y;
      this.accumulator -= STEP_MILLISECONDS;
    }
    return { x: this.x + this.renderOffsetX, y: this.y + this.renderOffsetY };
  }

  reconcile(
    authoritative: { x: number; y: number },
    acknowledgedInputSeq: number,
    forbiddenCircles: readonly ForbiddenCircle[] = [],
  ): void {
    const oldRendered = { x: this.x + this.renderOffsetX, y: this.y + this.renderOffsetY };
    this.pending = this.pending.filter((input) => input.seq > acknowledgedInputSeq);
    this.x = authoritative.x;
    this.y = authoritative.y;
    for (const input of this.pending) {
      const next = stepMovement({ x: this.x, y: this.y }, input, STEP_SECONDS, { forbiddenCircles });
      this.x = next.x;
      this.y = next.y;
    }
    const correctionX = oldRendered.x - this.x;
    const correctionY = oldRendered.y - this.y;
    if (Math.hypot(correctionX, correctionY) <= MAX_SMOOTH_CORRECTION) {
      this.renderOffsetX = correctionX;
      this.renderOffsetY = correctionY;
    } else {
      this.renderOffsetX = 0;
      this.renderOffsetY = 0;
    }
  }

  snap(position: { x: number; y: number }): void {
    this.x = position.x;
    this.y = position.y;
    this.pending = [];
    this.accumulator = 0;
    this.renderOffsetX = 0;
    this.renderOffsetY = 0;
  }

  render(deltaMilliseconds: number): { x: number; y: number } {
    const decay = Math.exp(-Math.max(deltaMilliseconds, 0) / 90);
    this.renderOffsetX *= decay;
    this.renderOffsetY *= decay;
    if (Math.abs(this.renderOffsetX) < 0.05) this.renderOffsetX = 0;
    if (Math.abs(this.renderOffsetY) < 0.05) this.renderOffsetY = 0;
    return { x: this.x + this.renderOffsetX, y: this.y + this.renderOffsetY };
  }

  get simulationPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  get pendingInputCount(): number {
    return this.pending.length;
  }
}
