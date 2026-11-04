import { describe, expect, it } from "vitest";

import { getDurationMarks } from "./MatchDurationSlider";

describe("match duration slider", () => {
  it("uses five-minute steps across private match durations", () => {
    expect(getDurationMarks(5, 30)).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it("keeps Quick Play on its existing five-to-twenty minute presets", () => {
    expect(getDurationMarks(5, 20)).toEqual([5, 10, 15, 20]);
  });
});
