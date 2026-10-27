import { describe, expect, it } from "vitest";
import { MovementPredictor } from "./MovementPredictor";
import { PositionBuffer } from "./PositionBuffer";

describe("movement prediction and interpolation", () => {
  it("replays unacknowledged inputs from the authoritative server position", () => {
    const predictor = new MovementPredictor({ x: 624, y: 2_352 });
    let sequence = 0;
    const send = () => sequence++;
    predictor.advance(50, { dx: 1, dy: 0 }, send);
    predictor.advance(50, { dx: 1, dy: 0 }, send);
    predictor.reconcile({ x: 637, y: 2_352 }, 0);
    expect(predictor.simulationPosition).toEqual({ x: 650, y: 2_352 });
    expect(predictor.pendingInputCount).toBe(1);
  });

  it("smooths small render corrections and snaps simulation state immediately", () => {
    const predictor = new MovementPredictor({ x: 624, y: 2_352 });
    let sequence = 0;
    predictor.advance(50, { dx: 1, dy: 0 }, () => sequence++);
    predictor.reconcile({ x: 635, y: 2_352 }, 0);
    expect(predictor.simulationPosition.x).toBe(635);
    expect(predictor.render(0).x).toBeCloseTo(637);
    expect(predictor.render(500).x).toBeCloseTo(635, 1);
  });

  it("interpolates remote players between buffered snapshots", () => {
    const buffer = new PositionBuffer(100);
    buffer.push({ x: 0, y: 0 }, 0);
    buffer.push({ x: 100, y: 50 }, 100);
    expect(buffer.sample(150)).toEqual({ x: 50, y: 25 });
  });
});
