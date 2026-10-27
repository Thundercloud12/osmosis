import type { RoomSnapshot } from "@osmosis/shared";

export type SnapshotListener = (snapshot: RoomSnapshot) => void;

export function dispatchSnapshotListeners(
  listeners: Set<SnapshotListener>,
  snapshot: RoomSnapshot,
  onListenerError: (error: unknown) => void = console.error,
): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      listeners.delete(listener);
      onListenerError(error);
    }
  }
}
