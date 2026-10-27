import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@osmosis/shared";
import { dispatchSnapshotListeners, type SnapshotListener } from "./snapshotDispatch";

describe("snapshot listener delivery", () => {
  it("removes a failing listener without blocking other players", () => {
    const snapshot = {} as RoomSnapshot;
    const failing = vi.fn(() => { throw new Error("destroyed scene"); });
    const active = vi.fn();
    const onError = vi.fn();
    const listeners = new Set<SnapshotListener>([failing, active]);

    dispatchSnapshotListeners(listeners, snapshot, onError);
    dispatchSnapshotListeners(listeners, snapshot, onError);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
