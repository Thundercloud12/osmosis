interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyFor = (roomCode: string) => `osmosis:reconnect:${roomCode.toUpperCase()}`;

/** Reads persistent tokens and migrates any legacy tab-session token exactly once. */
export function readReconnectToken(
  roomCode: string,
  persistent: TokenStorage = localStorage,
  legacySession: TokenStorage = sessionStorage,
): string | undefined {
  const key = keyFor(roomCode);
  const persistentToken = persistent.getItem(key);
  const legacyToken = legacySession.getItem(key);
  if (legacyToken) {
    if (!persistentToken) persistent.setItem(key, legacyToken);
    legacySession.removeItem(key);
  }
  return persistentToken ?? legacyToken ?? undefined;
}

export function saveReconnectToken(
  roomCode: string,
  token: string,
  persistent: TokenStorage = localStorage,
  legacySession: TokenStorage = sessionStorage,
): void {
  const key = keyFor(roomCode);
  persistent.setItem(key, token);
  legacySession.removeItem(key);
}

export function clearReconnectToken(
  roomCode: string,
  persistent: TokenStorage = localStorage,
  legacySession: TokenStorage = sessionStorage,
): void {
  const key = keyFor(roomCode);
  persistent.removeItem(key);
  legacySession.removeItem(key);
}
