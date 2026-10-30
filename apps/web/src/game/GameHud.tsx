import { useState } from "react";
import { ARENA_CONFIG, ARENA_OBSTACLES, MOVEMENT_CONFIG, TEAM_BASES, TRANSPARENT_BARRIERS, WAREHOUSE_TUNNELS, WAREHOUSE_ZONES, type GameCommand, type RoomSnapshot } from "@osmosis/shared";
import { ConnectionQualityIndicator } from "./ConnectionQualityIndicator";
import type { NetworkStatus } from "../net/MultiplayerClient";

interface GameHudProps { snapshot: RoomSnapshot | null; error: string | undefined; reportNotice: string | undefined; onCommand: (command: GameCommand) => void; onLeave: () => void; networkStatus: NetworkStatus }

export function GameHud({ snapshot, error, reportNotice, onCommand, onLeave, networkStatus }: GameHudProps) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTargetId, setReportTargetId] = useState("");
  const [reportCategory, setReportCategory] = useState<"CHEATING" | "HARASSMENT" | "OTHER">("HARASSMENT");
  const self = snapshot?.players.find((player) => player.id === snapshot.selfPlayerId);
  const ownTeam = self?.teamId ?? "BLUE";
  const ownColor = ownTeam === "BLUE" ? "#438fc9" : "#e87879";
  const ownPoints = self?.points ?? 0;
  const enemyTeam = ownTeam === "BLUE" ? "RED" : "BLUE";
  const linkedTeammate = snapshot?.players.find((player) => player.id === self?.linkedPlayerId);
  const frozenSeconds = self?.frozenSecondsRemaining ?? 0;
  const statusLabel = frozenSeconds > 0 ? "FROZEN" : self?.status ?? "CONNECTING";
  const controlHint = linkedTeammate
    ? `LINKED WITH ${linkedTeammate.nickname} · release F to unlink`
    : snapshot?.matchSettings.teamSize === 1
      ? "Link needs a teammate · use a 2v2 or 5v5 room"
      : `WASD move · E raid · hold F near an active teammate (${MOVEMENT_CONFIG.linkRadius} range, clear sight)`;
  const tipTitle = self?.status === "ELIMINATED" ? "ELIMINATED"
    : frozenSeconds > 0 ? "FROZEN!"
      : self?.status === "INACTIVE" ? "INACTIVE · KEEP MOVING"
        : linkedTeammate ? "TEAM LINK ACTIVE" : "CREWMATE CONTROLS";
  const tipText = self?.status === "ELIMINATED" ? "Your crew is still in the match. Spectating follows the next available crewmate."
    : frozenSeconds > 0 ? `Movement locked · move again in ${frozenSeconds}s.`
      : self?.status === "INACTIVE" ? `Move freely; no tags, stars, links or raids. Back in ${self.inactiveSecondsRemaining ?? 0}s · your HQ re-arms you early.`
        : `${controlHint} · G call for help`;
  const minutes = Math.floor((snapshot?.remainingSeconds ?? 900) / 60).toString().padStart(2, "0");
  const seconds = ((snapshot?.remainingSeconds ?? 900) % 60).toString().padStart(2, "0");
  const helpPingPlayerIds = new Set(snapshot?.helpPings.map((ping) => ping.playerId) ?? []);
  const reportTargets = snapshot?.players.filter((player) => player.id !== snapshot.selfPlayerId) ?? [];

  return <div className="match-hud" aria-label="Match information">
    <button className="match-leave-button" onClick={() => setConfirmLeave(true)}>LEAVE MATCH</button>
    <button className="match-report-button" onClick={() => { setReportTargetId(reportTargets[0]?.id ?? ""); setReportOpen(true); }}>REPORT A PLAYER</button>
    <div className="match-hud-top">
      <div className={`match-score-card ${ownTeam === "BLUE" ? "score-blue" : "score-red"}`}>
        <span>{ownTeam === "BLUE" ? "BLUE CREW" : "RED CREW"}</span><strong>{snapshot?.teamScores[ownTeam]?.toLocaleString() ?? "—"}</strong>
        <small>YOUR SCORE · {ownPoints.toLocaleString()}</small>
      </div>
        <div className="match-clock"><span>TIME LEFT</span><strong>{minutes}:{seconds}</strong><small>{statusLabel}</small><ConnectionQualityIndicator networkStatus={networkStatus} /></div>
      <div className={`match-score-card ${ownTeam === "BLUE" ? "score-red" : "score-blue"}`}>
        <span>{enemyTeam} CREW</span><strong>HIDDEN</strong>
        <small>OPPONENT SCORE</small>
      </div>
    </div>
    <div className="match-bottom-left">
      <div className="match-tip"><strong>{tipTitle}</strong><span>{tipText}</span></div>
      {snapshot?.spectatorTargetId && <div className="match-state-badge"><strong>SPECTATING</strong><span>Following {snapshot.players.find((player) => player.id === snapshot.spectatorTargetId)?.nickname ?? "crew"}</span></div>}
      {self?.poleHolder && <div className="match-state-badge"><strong>HQ POLE HELD</strong><span>Touching an opponent eliminates them</span></div>}
      {snapshot?.selfRaid && <div className="raid-meter"><strong>{snapshot.selfRaid.progressSeconds > 0 ? "BASE RAID" : "RAID CHARGE"}</strong><div><i style={{ width: `${Math.min(100, snapshot.selfRaid.progressSeconds / 3 * 100)}%` }} /></div><span>{snapshot.selfRaid.progressSeconds > 0 ? `${snapshot.selfRaid.progressSeconds.toFixed(1)} / 3.0s` : snapshot.selfRaid.cooldownSecondsRemaining ? `${snapshot.selfRaid.cooldownSecondsRemaining}s cooldown` : "Ready"}</span></div>}
    </div>
    {snapshot && <div className="minimap-card" aria-label="Team minimap">
      <div className="minimap-title">CREW RADAR</div>
      <svg viewBox={`0 0 ${ARENA_CONFIG.width} ${ARENA_CONFIG.height}`} style={{ aspectRatio: `${ARENA_CONFIG.width} / ${ARENA_CONFIG.height}` }} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Teammates on the arena map">
          <rect width={ARENA_CONFIG.width} height={ARENA_CONFIG.height} fill="#342f3c" />
          {WAREHOUSE_ZONES.map((zone) => <g key={zone.id}>
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} fill={`#${zone.tint.toString(16).padStart(6, "0")}`} opacity=".82" />
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} fill="none" stroke="#f9ecd2" strokeOpacity=".58" strokeWidth="28" />
          </g>)}
          {WAREHOUSE_TUNNELS.map((tunnel) => <rect key={tunnel.id} x={tunnel.x} y={tunnel.y} width={tunnel.width} height={tunnel.height} fill="#d9c28a" opacity=".9" />)}
          {ARENA_OBSTACLES.map((wall) => <rect key={wall.id} x={wall.x} y={wall.y} width={wall.width} height={wall.height} rx="14" fill="#342c3c" stroke="#8b7e92" strokeWidth="16" />)}
          {TRANSPARENT_BARRIERS.map((wall) => <rect key={wall.id} x={wall.x} y={wall.y} width={wall.width} height={wall.height} fill="#c4eef0" fillOpacity=".56" stroke="#e7ffff" strokeWidth="18" />)}
          {Object.values(TEAM_BASES).map((base) => <rect key={base.id} x={base.x} y={base.y} width={base.width} height={base.height} rx="42" fill={base.id === "blue-base" ? "#438fc9" : "#e87879"} opacity=".7" />)}
          {snapshot.players.filter((player) => player.teamId === ownTeam).map((player) => <g key={player.id}>
            {helpPingPlayerIds.has(player.id) && <circle className="help-ping-pulse" cx={player.x} cy={player.y} r="52" />}
            <circle cx={player.x} cy={player.y} r={player.id === snapshot.selfPlayerId ? 39 : 27} fill={player.id === snapshot.selfPlayerId ? "#fff5d7" : ownColor} stroke="white" strokeWidth="12" />
            <circle cx={player.x} cy={player.y} r="13" fill={ownColor} />
          </g>)}
      </svg>
      <small>{snapshot.players.filter((player) => player.teamId === ownTeam).length}/{snapshot.matchSettings.teamSize} CREW ON RADAR</small>
    </div>}
    {error && <div className="match-error" role="status">{error}</div>}
    {reportNotice && <div className="report-notice" role="status">{reportNotice}</div>}
    {reportOpen && <div className="leave-confirm-backdrop" role="presentation">
      <section className="leave-confirm-card report-card" role="dialog" aria-modal="true" aria-labelledby="report-player-title">
        <strong id="report-player-title">Report a crewmate</strong>
        <p>Reports are reviewed from server logs. Choose a player visible to you in this match.</p>
        {reportTargets.length === 0 ? <p>No other players are currently visible to report.</p> : <>
          <label className="field-label" htmlFor="report-target">CREWMATE</label>
          <select id="report-target" className="lobby-input" value={reportTargetId || reportTargets[0]?.id} onChange={(event) => setReportTargetId(event.target.value)}>
            {reportTargets.map((player) => <option value={player.id} key={player.id}>{player.nickname} · {player.teamId === ownTeam ? "your crew" : "opponent"}</option>)}
          </select>
          <label className="field-label" htmlFor="report-category">REASON</label>
          <select id="report-category" className="lobby-input" value={reportCategory} onChange={(event) => setReportCategory(event.target.value as typeof reportCategory)}>
            <option value="HARASSMENT">Harassment or offensive name</option><option value="CHEATING">Cheating or exploit</option><option value="OTHER">Other concern</option>
          </select>
        </>}
        <div><button onClick={() => setReportOpen(false)}>CANCEL</button><button className="leave-confirm-action" disabled={!reportTargets.length} onClick={() => {
          const targetPlayerId = reportTargetId || reportTargets[0]?.id;
          if (!targetPlayerId) return;
          onCommand({ type: "reportPlayer", targetPlayerId, category: reportCategory });
          setReportOpen(false);
        }}>SEND REPORT</button></div>
      </section>
    </div>}
    {confirmLeave && <div className="leave-confirm-backdrop" role="presentation">
      <section className="leave-confirm-card" role="dialog" aria-modal="true" aria-labelledby="leave-match-title">
        <strong id="leave-match-title">Leave this match?</strong>
        <p>You can’t rejoin this round. If you’re disconnected, the server releases your reserved seat within 120 seconds.</p>
        <div><button onClick={() => setConfirmLeave(false)}>STAY IN GAME</button><button className="leave-confirm-action" onClick={onLeave}>LEAVE ROOM</button></div>
      </section>
    </div>}
  </div>;
}
