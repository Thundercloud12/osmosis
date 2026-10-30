import type { RoomSnapshot } from "@osmosis/shared";

interface ResultsScreenProps {
  result: NonNullable<RoomSnapshot["result"]>;
  isHost: boolean;
  error: string | undefined;
  onRematch: () => void;
  onLeave: () => void;
}

export function ResultsScreen({ result, isHost, error, onRematch, onLeave }: ResultsScreenProps) {
  const blueWon = result.winnerTeam === "BLUE";
  const redWon = result.winnerTeam === "RED";
  return <main className="lobby-shell results-shell">
    <header className="lobby-header"><a className="lobby-brand" href="/"><span className="brand-planet">✦</span><span>OSMOSIS</span><small>MISSION COMPLETE</small></a><button className="quiet-button" onClick={onLeave}>BACK TO CREW UP</button></header>
    <section className="results-card">
      <div className="results-confetti" aria-hidden="true">✦　✧　✦</div>
      <p className="mini-label">MATCH COMPLETE · FINAL CREW SCORES</p>
      <h1>{result.winnerTeam ? `${result.winnerTeam === "BLUE" ? "Blue" : "Red"} crew wins!` : "It’s a draw!"}</h1>
      <div className="result-score-row">
        <div className={`result-team result-blue ${blueWon ? "result-winner" : ""}`}><span className="result-mascot"><img src="/assets/characters/astronaut.png" alt="" /></span><span>BLUE CREW</span><strong>{result.teamScores.BLUE?.toLocaleString() ?? "0"}</strong>{blueWon && <small className="winner-ribbon">WINNER ✦</small>}</div>
        <div className="result-vs">VS</div>
        <div className={`result-team result-red ${redWon ? "result-winner" : ""}`}><span className="result-mascot"><img src="/assets/characters/astronaut.png" alt="" /></span><span>RED CREW</span><strong>{result.teamScores.RED?.toLocaleString() ?? "0"}</strong>{redWon && <small className="winner-ribbon">WINNER ✦</small>}</div>
      </div>
      <div className="result-roster" aria-label="Final player scores">
        {(["BLUE", "RED"] as const).map((teamId) => <section className={`result-roster-team ${teamId === "BLUE" ? "roster-blue" : "roster-red"}`} key={teamId}>
          <h2>{teamId === "BLUE" ? "Blue" : "Red"} crew · {result.players.filter((player) => player.teamId === teamId).length} players</h2>
          {result.players.filter((player) => player.teamId === teamId).map((player) => <div className="result-player" key={player.id}>
            <span className={`result-player-avatar ${player.teamId === "BLUE" ? "avatar-blue" : "avatar-red"}`}><img src="/assets/characters/astronaut.png" alt="" /></span>
            <div className="result-player-name"><strong>{player.nickname}</strong></div>
            <span className="result-player-points">{player.points.toLocaleString()} pts</span>
            <small className="result-player-stats">{player.pickupsCollected} stars · {player.battlesWon} wins · {player.raidsCompleted} raids</small>
          </div>)}
        </section>)}
      </div>
      {error && <p className="lobby-error" role="alert">{error}</p>}
      {isHost ? <button className="play-button result-rematch" onClick={onRematch}>REMATCH <span>↻</span></button> : <p className="rematch-note">Waiting for the host to start a rematch…</p>}
    </section>
  </main>;
}
