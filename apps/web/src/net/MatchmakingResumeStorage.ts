const STORAGE_KEY = "osmosis.quickplay.resume.v1";

export interface MatchmakingResumeRecord {
  roomId: string;
  token: string;
}

export function readMatchmakingResume(): MatchmakingResumeRecord | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<MatchmakingResumeRecord>;
    if (typeof parsed.roomId !== "string" || typeof parsed.token !== "string") return undefined;
    return { roomId: parsed.roomId, token: parsed.token };
  } catch { return undefined; }
}

export function saveMatchmakingResume(record: MatchmakingResumeRecord): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Browser storage can be unavailable. */ }
}

export function clearMatchmakingResume(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Browser storage can be unavailable. */ }
}
