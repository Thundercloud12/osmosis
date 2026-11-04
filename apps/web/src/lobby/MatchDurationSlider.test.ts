import { describe, expect, it } from "vitest";

import { getDurationMarks } from "./MatchDurationSlider";

describe("match duration slider", () => {
  it("uses five-minute steps across private match durations", () => {
    expect(getDurationMarks(5, 30)).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it("renders custom duration bounds in five-minute increments", () => {
    expect(getDurationMarks(10, 30)).toEqual([10, 15, 20, 25, 30]);
  });
});
