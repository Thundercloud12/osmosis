export interface PositionSample {
  receivedAt: number;
  x: number;
  y: number;
}

/** Delayed interpolation absorbs uneven arrivals without extrapolating hidden state. */
export class PositionBuffer {
  private readonly samples: PositionSample[] = [];
  private lastSampleTime = Number.NEGATIVE_INFINITY;

  constructor(private readonly renderDelayMilliseconds = 100, private readonly capacity = 12) {}

  push(position: { x: number; y: number }, receivedAt: number): void {
    const monotonicTime = Math.max(receivedAt, this.lastSampleTime + 0.01);
    this.lastSampleTime = monotonicTime;
    this.samples.push({ receivedAt: monotonicTime, x: position.x, y: position.y });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  sample(now: number): { x: number; y: number } | undefined {
    if (this.samples.length === 0) return undefined;
    if (this.samples.length === 1) return this.samples[0];
    const targetTime = now - this.renderDelayMilliseconds;
    if (targetTime <= this.samples[0]!.receivedAt) return this.samples[0];
    for (let index = 1; index < this.samples.length; index += 1) {
      const right = this.samples[index]!;
      const left = this.samples[index - 1]!;
      if (targetTime > right.receivedAt) continue;
      const amount = (targetTime - left.receivedAt) / (right.receivedAt - left.receivedAt);
      return {
        x: left.x + (right.x - left.x) * amount,
        y: left.y + (right.y - left.y) * amount,
      };
    }
    return this.samples[this.samples.length - 1];
  }

  clear(): void {
    this.samples.length = 0;
    this.lastSampleTime = Number.NEGATIVE_INFINITY;
  }
}
