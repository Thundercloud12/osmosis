import type { RoomMode } from "@osmosis/shared";

export function roomModeAllowed(mode: RoomMode, environment: NodeJS.ProcessEnv = process.env): boolean {
  return mode === "STANDARD" || environment.NODE_ENV !== "production" || environment.ENABLE_TEST_ROOM_MODES === "true";
}
