import type { LobbySnapshot, RoomSnapshot } from "@osmosis/shared";

interface ResultsScreenProps {
  result: NonNullable<RoomSnapshot["result"]>;
  lobby: LobbySnapshot | null;
  error: string | undefined;
  onRematch: () => void;
  onLeave: () => void;
}

export function ResultsScreen({ result, lobby, error, onRematch, onLeave }: ResultsScreenProps) {
  const selfId = lobby?.selfPlayerId;
  const isHost = lobby?.players.find((player) => player.id === selfId)?.isHost ?? false;
  const blueWon = result.winnerTeam === "BLUE";
  const redWon = result.winnerTeam === "RED";
  return <main className="lobby-shell results-shell">
    <header className="lobby-header"><a className="lobby-brand" href="/"><span className="brand-planet">✦</span><span>OSMOSIS</span><small>MISSION COMPLETE</small></a><button className="quiet-button" onClick={onLeave}>LEAVE ROOM</button></header>
    <section className="results-card">
      <p className="mini-label">MATCH COMPLETE</p>
      <h1>{result.winnerTeam ? `${result.winnerTeam === "BLUE" ? "Blue" : "Red"} crew wins!` : "It’s a draw!"}</h1>
      <div className="result-score-row">
        <div className={`result-team result-blue ${blueWon ? "result-winner" : ""}`}><span>BLUE CREW</span><strong>{result.teamScores.BLUE.toLocaleString()}</strong></div>
        <div className="result-vs">VS</div>
        <div className={`result-team result-red ${redWon ? "result-winner" : ""}`}><span>RED CREW</span><strong>{result.teamScores.RED.toLocaleString()}</strong></div>
      </div>
      <div className="result-roster">
        {result.players.map((player) => <div className="result-player" key={player.id}>
          <span className={`result-player-dot ${player.teamId === "BLUE" ? "dot-blue" : "dot-red"}`} />
          <strong>{player.nickname}</strong><small>{player.teamId}</small><span>{player.points.toLocaleString()} pts</span>
          <small>{player.pickupsCollected} stars · {player.battlesWon} wins · {player.raidsCompleted} raids</small>
        </div>)}
      </div>
      {error && <p className="lobby-error" role="alert">{error}</p>}
      {isHost ? <button className="play-button result-rematch" onClick={onRematch}>REMATCH <span>↻</span></button> : <p className="rematch-note">Waiting for the host to start a rematch…</p>}
    </section>
  </main>;
}
