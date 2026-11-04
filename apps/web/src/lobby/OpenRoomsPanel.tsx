import type { OpenRoomListing } from "@osmosis/shared";

interface OpenRoomsPanelProps {
  rooms: OpenRoomListing[];
  loading: boolean;
  error: string | undefined;
  disabled: boolean;
  onRefresh: () => void;
  onJoin: (roomCode: string) => void;
}

export function OpenRoomsPanel({ rooms, loading, error, disabled, onRefresh, onJoin }: OpenRoomsPanelProps) {
  return <div className="open-rooms-panel">
    <div className="open-rooms-toolbar">
      <p aria-live="polite">{loading ? "Checking for open rooms…" : `${rooms.length} open ${rooms.length === 1 ? "room" : "rooms"}`}</p>
      <button type="button" className="open-rooms-refresh" onClick={onRefresh} disabled={loading}>REFRESH</button>
    </div>
    {error && <p className="open-rooms-error" role="alert">{error}</p>}
    {rooms.length > 0 ? <ul className="open-rooms-list" aria-label="Rooms open to the public">
      {rooms.map((room) => {
        const teamSize = room.matchSettings.teamSize;
        const matchLength = room.matchSettings.matchDurationSeconds / 60;
        const occupancy = Math.min(100, Math.round((room.playerCount / room.maxPlayers) * 100));
        return <li className="open-room-card" key={room.roomCode}>
          <div className="open-room-main">
            <div className="open-room-heading"><strong>ROOM {room.roomCode}</strong><span>{room.roomMode === "STANDARD" ? "" : "TEST · "}{teamSize}v{teamSize} · {matchLength} MIN</span></div>
            <div className="open-room-capacity" role="group" aria-label={`${room.playerCount} of ${room.maxPlayers} players in room`}>
              <span><strong>{room.playerCount}/{room.maxPlayers}</strong> players</span>
              <div className="open-room-capacity-track" role="progressbar" aria-label="Room occupancy" aria-valuemin={0} aria-valuemax={room.maxPlayers} aria-valuenow={room.playerCount}>
                <span style={{ width: `${occupancy}%` }} />
              </div>
            </div>
          </div>
          <button type="button" className="join-button open-room-join" disabled={disabled} onClick={() => onJoin(room.roomCode)}>JOIN ROOM</button>
        </li>;
      })}
    </ul> : <div className="open-rooms-empty" role="status">
      <span aria-hidden="true">✦</span>
      <strong>{loading ? "Looking around…" : "No open rooms right now"}</strong>
      <p>Hosts can open a private room from its pre-match lobby.</p>
    </div>}
    <p className="open-rooms-note">Room availability updates automatically. Rooms stop accepting players when the host closes them or the match setup begins.</p>
  </div>;
}
