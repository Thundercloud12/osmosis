import { describe, expect, it } from "vitest";

import { readVoicePanelCollapsed, VOICE_PANEL_PREFERENCE_KEY, writeVoicePanelCollapsed } from "./voicePanelPreference";

describe("voice panel preference", () => {
  it("uses the saved preference or a compact default on narrow screens", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readVoicePanelCollapsed(storage, true)).toBe(true);
    expect(readVoicePanelCollapsed(storage, false)).toBe(false);
    writeVoicePanelCollapsed(storage, true);
    expect(values.get(VOICE_PANEL_PREFERENCE_KEY)).toBe("true");
    expect(readVoicePanelCollapsed(storage, false)).toBe(true);
  });

  it("falls back safely when browser storage is unavailable", () => {
    expect(readVoicePanelCollapsed(undefined, true)).toBe(true);
    expect(() => writeVoicePanelCollapsed(undefined, false)).not.toThrow();
    expect(readVoicePanelCollapsed({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    }, false)).toBe(false);
  });
});
