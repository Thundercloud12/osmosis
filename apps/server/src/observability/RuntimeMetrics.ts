import { monitorEventLoopDelay } from "node:perf_hooks";

const SAMPLE_CAPACITY = 12_000;

class SampleWindow {
  private readonly values = new Float64Array(SAMPLE_CAPACITY);
  private nextIndex = 0;
  private size = 0;

  add(value: number): void {
    this.values[this.nextIndex] = value;
    this.nextIndex = (this.nextIndex + 1) % SAMPLE_CAPACITY;
    this.size = Math.min(this.size + 1, SAMPLE_CAPACITY);
  }

  summary(): { samples: number; p50: number; p95: number; p99: number; max: number } {
    if (this.size === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };

    const sorted = Array.from({ length: this.size }, (_, index) => {
      const firstIndex = (this.nextIndex - this.size + SAMPLE_CAPACITY) % SAMPLE_CAPACITY;
      return this.values[(firstIndex + index) % SAMPLE_CAPACITY]!;
    }).sort((left, right) => left - right);
    const percentile = (value: number): number => sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]!;
    return {
      samples: this.size,
      p50: round(percentile(0.5)),
      p95: round(percentile(0.95)),
      p99: round(percentile(0.99)),
      max: round(sorted[sorted.length - 1]!),
    };
  }
}

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

export class RuntimeMetrics {
  private readonly tickDurations = new SampleWindow();
  private readonly tickIntervals = new SampleWindow();
  private totalTicks = 0;
  private slowTicks = 0;
  private delayedTicks = 0;
  private lastTickDurationMs: number | undefined;
  private cpuBaseline = process.cpuUsage();
  private cpuSampleTime = performance.now();

  recordSimulationStep(durationMs: number, intervalMs: number | undefined, budgetMs: number): void {
    this.totalTicks += 1;
    this.tickDurations.add(durationMs);
    this.lastTickDurationMs = durationMs;
    if (durationMs > budgetMs) this.slowTicks += 1;
    if (intervalMs !== undefined) {
      this.tickIntervals.add(intervalMs);
      if (intervalMs > budgetMs) this.delayedTicks += 1;
    }
  }

  snapshot(roomCount: number, connectedPlayers: number, targetHz: number) {
    const now = performance.now();
    const elapsedMicroseconds = Math.max(1, (now - this.cpuSampleTime) * 1_000);
    const cpuDelta = process.cpuUsage(this.cpuBaseline);
    const cpuPercent = ((cpuDelta.user + cpuDelta.system) / elapsedMicroseconds) * 100;
    this.cpuBaseline = process.cpuUsage();
    this.cpuSampleTime = now;

    const toMilliseconds = (nanoseconds: number): number => round(nanoseconds / 1_000_000);
    const result = {
      sampledAt: new Date().toISOString(),
      uptimeSeconds: round(process.uptime()),
      server: { rooms: roomCount, connectedPlayers },
      process: {
        cpuPercent: round(cpuPercent),
        memoryBytes: process.memoryUsage(),
        eventLoopDelayMs: {
          p50: toMilliseconds(eventLoopDelay.percentile(50)),
          p95: toMilliseconds(eventLoopDelay.percentile(95)),
          p99: toMilliseconds(eventLoopDelay.percentile(99)),
          max: toMilliseconds(eventLoopDelay.max),
        },
      },
      simulation: {
        targetHz,
        targetIntervalMs: round(1_000 / targetHz),
        totalTicks: this.totalTicks,
        lastTickDurationMs: this.lastTickDurationMs === undefined ? null : round(this.lastTickDurationMs),
        tickDurationMs: this.tickDurations.summary(),
        tickIntervalMs: this.tickIntervals.summary(),
        ticksOverBudget: this.slowTicks,
        intervalsOverBudget: this.delayedTicks,
      },
    };
    eventLoopDelay.reset();
    return result;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export const runtimeMetrics = new RuntimeMetrics();
