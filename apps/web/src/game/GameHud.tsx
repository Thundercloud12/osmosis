import { ARENA_CONFIG, ARENA_OBSTACLES, TEAM_BASES, type RoomSnapshot } from "@osmosis/shared";

interface GameHudProps { snapshot: RoomSnapshot | null; error: string | undefined }

export function GameHud({ snapshot, error }: GameHudProps) {
  const self = snapshot?.players.find((player) => player.id === snapshot.selfPlayerId);
  const ownTeam = self?.teamId ?? "BLUE";
  const ownColor = ownTeam === "BLUE" ? "#438fc9" : "#e87879";
  const ownPoints = self?.points ?? 0;
  const minutes = Math.floor((snapshot?.remainingSeconds ?? 900) / 60).toString().padStart(2, "0");
  const seconds = ((snapshot?.remainingSeconds ?? 900) % 60).toString().padStart(2, "0");

  return <div className="match-hud" aria-label="Match information">
    <div className="match-hud-top">
      <div className={`match-score-card ${ownTeam === "BLUE" ? "score-blue" : "score-red"}`}>
        <span>{ownTeam === "BLUE" ? "BLUE CREW" : "RED CREW"}</span><strong>{snapshot?.teamScores[ownTeam].toLocaleString() ?? "—"}</strong>
        <small>YOUR SCORE · {ownPoints.toLocaleString()}</small>
      </div>
      <div className="match-clock"><span>TIME LEFT</span><strong>{minutes}:{seconds}</strong><small>{self?.status ?? "CONNECTING"}</small></div>
      <div className={`match-score-card ${ownTeam === "BLUE" ? "score-red" : "score-blue"}`}>
        <span>{ownTeam === "BLUE" ? "RED CREW" : "BLUE CREW"}</span><strong>{snapshot?.teamScores[ownTeam === "BLUE" ? "RED" : "BLUE"].toLocaleString() ?? "—"}</strong>
        <small>CREW SCORE</small>
      </div>
    </div>
    <div className="match-bottom-left">
      <div className="match-tip"><strong>{self?.status === "INACTIVE" ? "TAGGED OUT!" : "CREWMATE CONTROLS"}</strong><span>{self?.status === "INACTIVE" ? "Head back to your base to re-arm." : "WASD move · E raid · hold F to link"}</span></div>
      {snapshot?.selfRaid && <div className="raid-meter"><strong>{snapshot.selfRaid.progressSeconds > 0 ? "BASE RAID" : "RAID CHARGE"}</strong><div><i style={{ width: `${Math.min(100, snapshot.selfRaid.progressSeconds / 3 * 100)}%` }} /></div><span>{snapshot.selfRaid.progressSeconds > 0 ? `${snapshot.selfRaid.progressSeconds.toFixed(1)} / 3.0s` : snapshot.selfRaid.cooldownSecondsRemaining ? `${snapshot.selfRaid.cooldownSecondsRemaining}s cooldown` : "Ready"}</span></div>}
    </div>
    {snapshot && <div className="minimap-card" aria-label="Team minimap">
      <div className="minimap-title">CREW RADAR</div>
      <svg viewBox={`0 0 ${ARENA_CONFIG.width} ${ARENA_CONFIG.height}`} role="img" aria-label="Teammates on the arena map">
        <rect width={ARENA_CONFIG.width} height={ARENA_CONFIG.height} rx="50" fill="#cce5dd" />
        {ARENA_OBSTACLES.map((wall) => <rect key={wall.id} x={wall.x} y={wall.y} width={wall.width} height={wall.height} rx="20" fill="#5e8790" />)}
        {Object.values(TEAM_BASES).map((base) => <rect key={base.id} x={base.x} y={base.y} width={base.width} height={base.height} rx="42" fill={base.id === "blue-base" ? "#438fc9" : "#e87879"} opacity=".7" />)}
        {snapshot.players.filter((player) => player.teamId === ownTeam).map((player) => <g key={player.id}>
          <circle cx={player.x} cy={player.y} r={player.id === snapshot.selfPlayerId ? 39 : 27} fill={player.id === snapshot.selfPlayerId ? "#fff5d7" : ownColor} stroke="white" strokeWidth="12" />
          <circle cx={player.x} cy={player.y} r="13" fill={ownColor} />
        </g>)}
      </svg>
      <small>{snapshot.players.filter((player) => player.teamId === ownTeam).length}/5 CREW ON RADAR</small>
    </div>}
    {error && <div className="match-error" role="status">{error}</div>}
  </div>;
}
