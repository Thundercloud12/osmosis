import { describe, expect, it } from "vitest";
import { clearReconnectToken, readReconnectToken, saveReconnectToken } from "./ReconnectTokenStorage";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

describe("reconnection token storage", () => {
  it("migrates a legacy tab token into persistent storage", () => {
    const persistent = storage();
    const legacy = storage({ "osmosis:reconnect:AB12CD": "room:token" });
    expect(readReconnectToken("ab12cd", persistent, legacy)).toBe("room:token");
    expect(persistent.values.get("osmosis:reconnect:AB12CD")).toBe("room:token");
    expect(legacy.values.has("osmosis:reconnect:AB12CD")).toBe(false);
  });

  it("prefers an existing persistent token and removes the stale legacy copy", () => {
    const persistent = storage({ "osmosis:reconnect:AB12CD": "new-token" });
    const legacy = storage({ "osmosis:reconnect:AB12CD": "old-token" });
    expect(readReconnectToken("AB12CD", persistent, legacy)).toBe("new-token");
    expect(legacy.values.size).toBe(0);
  });

  it("saves refreshed tokens persistently and clears both stores on leave", () => {
    const persistent = storage();
    const legacy = storage({ "osmosis:reconnect:AB12CD": "old-token" });
    saveReconnectToken("ab12cd", "fresh-token", persistent, legacy);
    expect(readReconnectToken("AB12CD", persistent, legacy)).toBe("fresh-token");
    clearReconnectToken("AB12CD", persistent, legacy);
    expect(persistent.values.size).toBe(0);
    expect(legacy.values.size).toBe(0);
  });
});
