export const VOICE_PANEL_PREFERENCE_KEY = "osmosis.voice-panel-collapsed";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readVoicePanelCollapsed(storage: PreferenceStorage | undefined, narrowViewport: boolean): boolean {
  try {
    const saved = storage?.getItem(VOICE_PANEL_PREFERENCE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    // Storage may be disabled by the browser; fall back to the viewport default.
  }
  return narrowViewport;
}

export function writeVoicePanelCollapsed(storage: PreferenceStorage | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(VOICE_PANEL_PREFERENCE_KEY, String(collapsed));
  } catch {
    // The panel remains usable when browser storage is unavailable.
  }
}
