import { useMemo, useState } from "react";

import type { LobbyCommand, LobbySnapshot, RoomSnapshot } from "@osmosis/shared";
import type { NetworkStatus } from "../net/MultiplayerClient";

interface LobbyScreenProps {
  lobby: LobbySnapshot | null;
  networkStatus: NetworkStatus;
  error: string | undefined;
  latestRoomSnapshot: RoomSnapshot | null;
  onCreate: (nickname: string) => void;
  onJoin: (nickname: string, code: string) => void;
  onCommand: (command: LobbyCommand) => void;
  onLeave: () => void;
}

const teams = [
  { id: "BLUE", label: "Blue Crew", color: "blue" },
  { id: "RED", label: "Red Crew", color: "red" },
] as const;

export function LobbyScreen({ lobby, networkStatus, error, onCreate, onJoin, onCommand, onLeave }: LobbyScreenProps) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "");
  const [copied, setCopied] = useState(false);
  const self = lobby?.players.find((player) => player.id === lobby.selfPlayerId);
  const ownTeamPlayers = useMemo(
    () => lobby?.players.filter((player) => player.teamId === self?.teamId) ?? [],
    [lobby, self?.teamId],
  );
  const isCaptain = self?.isCaptain ?? false;
  const isHost = self?.isHost ?? false;
  const pointsByPlayer = new Map(lobby?.ownTeamAllocation.map((entry) => [entry.playerId, entry.points ?? 0]) ?? []);
  const totalPoints = [...pointsByPlayer.values()].reduce((sum, points) => sum + points, 0);

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate(nickname.trim() || "Crew");
  }

  function submitJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoin(nickname.trim() || "Crew", roomCode.trim().toUpperCase());
  }

  function changePoints(playerId: string, delta: number) {
    if (!lobby) return;
    const values = Object.fromEntries(lobby.ownTeamAllocation.map((entry) => [entry.playerId, entry.points ?? 0]));
    const donor = ownTeamPlayers.find((player) => player.id !== playerId && (values[player.id] ?? 0) >= delta);
    if (delta > 0 && !donor) return;
    values[playerId] = (values[playerId] ?? 0) + delta;
    if (donor) values[donor.id] = (values[donor.id] ?? 0) - delta;
    onCommand({ type: "allocate", pointsByPlayerId: values });
  }

  async function copyInvite() {
    if (!lobby) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", lobby.roomCode);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="lobby-shell">
      <header className="lobby-header">
        <a className="lobby-brand" href="/" onClick={(event) => { if (lobby) { event.preventDefault(); onLeave(); } }}>
          <span className="brand-planet">✦</span><span>OSMOSIS</span><small>CREW UP!</small>
        </a>
        {lobby ? (
          <div className="room-chip"><span className="online-dot" /> ROOM <strong>{lobby.roomCode}</strong></div>
        ) : <div className="lobby-kicker">A LITTLE SPACE. A LOT OF TEAMWORK.</div>}
      </header>

      {!lobby ? (
        <section className="welcome-layout">
          <div className="welcome-copy">
            <div className="welcome-art" aria-hidden="true"><div className="welcome-star star-one">✦</div><div className="welcome-star star-two">✦</div><div className="welcome-moon" /><div className="welcome-crew crew-blue">●</div><div className="welcome-crew crew-coral">●</div></div>
            <p className="mini-label">READY, CREWMATE?</p>
            <h1>Find your<br /><span>people.</span></h1>
            <p className="welcome-subtitle">Team up, share the points, and take over the arena together.</p>
          </div>
          <div className="welcome-card">
            <div className="card-tab">YOUR CREW STARTS HERE</div>
            <label className="field-label" htmlFor="nickname">CREWMATE NAME</label>
            <input id="nickname" className="lobby-input" value={nickname} maxLength={24} placeholder="e.g. Starbean" onChange={(event) => setNickname(event.target.value)} />
            <button className="play-button" disabled={networkStatus.state === "connecting"} onClick={() => onCreate(nickname.trim() || "Crew")}>
              {networkStatus.state === "connecting" ? "CONNECTING…" : "CREATE A ROOM"}<span>→</span>
            </button>
            <div className="or-divider"><span /> OR JOIN YOUR FRIENDS <span /></div>
            <form onSubmit={submitJoin} className="join-form">
              <label className="field-label" htmlFor="room-code">ROOM CODE</label>
              <div className="join-row"><input id="room-code" className="lobby-input code-input" value={roomCode} maxLength={6} placeholder="6 LETTERS" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} /><button className="join-button" disabled={roomCode.length !== 6}>JOIN</button></div>
            </form>
            {error && <p className="lobby-error" role="alert">{error}</p>}
            {networkStatus.state === "connecting" && <p className="connecting-note">Finding your airlock…</p>}
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-heading">
            <div><p className="mini-label">PRE-MATCH AIRLOCK</p><h1>Gather your <span>crew.</span></h1></div>
            <button className="quiet-button" onClick={onLeave}>LEAVE ROOM</button>
          </div>
          <div className="invite-strip"><span>Send your friends the room code</span><strong>{lobby.roomCode}</strong><button className="copy-button" onClick={() => void copyInvite()}>{copied ? "COPIED! ✓" : "COPY INVITE ↗"}</button><span className="player-count">{lobby.connectedPlayerCount}/10 PLAYERS</span></div>

          <div className="lobby-grid">
            {teams.map((team) => {
              const roster = lobby.players.filter((player) => player.teamId === team.id);
              const captainId = lobby.captainIds[team.id];
              return <section className={`team-card team-card-${team.color}`} key={team.id}>
                <header className="team-card-heading"><span className="team-emblem">✦</span><div><p>{team.id === "BLUE" ? "COOL AS COSMOS" : "A LITTLE BIT BOLD"}</p><h2>{team.label}</h2></div><strong>{roster.length}/5</strong></header>
                <div className="roster-list">{Array.from({ length: 5 }, (_, index) => {
                  const player = roster[index];
                  return <div className={`roster-slot ${player ? "occupied" : "empty"}`} key={player?.id ?? `${team.id}-${index}`}>
                    <span className="crew-avatar">{player ? player.nickname.slice(0, 1).toUpperCase() : "+"}</span>
                    <span className="crew-name">{player?.nickname ?? "Waiting for a crewmate"}</span>
                    {player?.isHost && <small className="role-badge host-badge">HOST</small>}
                    {player?.isCaptain && <small className="role-badge captain-badge">CAPTAIN</small>}
                    {player && !player.connected && <small className="offline-badge">RECONNECTING</small>}
                    {player?.ready && <small className="ready-badge">READY ✓</small>}
                  </div>;
                })}</div>
                {self && self.teamId !== team.id && lobby.phase === "LOBBY" && !lobby.allocationComplete && <button className="team-action" onClick={() => onCommand({ type: "chooseTeam", teamId: team.id })}>JOIN THIS CREW</button>}
                {self?.teamId === team.id && !captainId && lobby.phase === "LOBBY" && !lobby.allocationComplete && <button className="team-action" onClick={() => onCommand({ type: "captain", action: "claim" })}>BECOME CAPTAIN</button>}
                {self?.isCaptain && captainId === self.id && lobby.phase === "LOBBY" && !lobby.allocationComplete && <button className="team-action secondary-action" onClick={() => onCommand({ type: "captain", action: "release" })}>STEP DOWN AS CAPTAIN</button>}
              </section>;
            })}
          </div>

          <section className="control-card">
            <div className="control-copy">
              <p className="mini-label">{lobby.phase === "ALLOCATION" ? "CAPTAIN'S TABLE" : lobby.phase === "COUNTDOWN" ? "AIRLOCK CLOSING" : "NEXT UP"}</p>
              <h2>{lobby.phase === "ALLOCATION" ? "Share the team points." : lobby.phase === "COUNTDOWN" ? "Launching soon!" : lobby.allocationComplete ? "Ready for liftoff?" : "Pick your captains."}</h2>
              <p>{lobby.phase === "ALLOCATION" ? `Your crew's captain can split ${totalPoints.toLocaleString()} points. The other crew's plan stays private.` : lobby.phase === "COUNTDOWN" ? "The host can cancel if someone needs another moment." : lobby.allocationComplete ? `${lobby.players.filter((player) => player.ready).length}/10 crewmates ready to launch.` : "Fill both crews, then each side picks a captain to plan its opening points."}</p>
              {error && <p className="lobby-error" role="alert">{error}</p>}
            </div>
            <div className="control-actions">
              {lobby.phase === "ALLOCATION" && <>
                <div className="allocation-list">{ownTeamPlayers.map((player) => {
                  const points = pointsByPlayer.get(player.id) ?? 0;
                  return <div className="allocation-row" key={player.id}><span>{player.nickname}{player.isCaptain ? " ✦" : ""}</span><button className="stepper" disabled={!isCaptain || lobby.ownTeamLocked || points < 100} onClick={() => changePoints(player.id, -100)} aria-label={`Remove 100 points from ${player.nickname}`}>−</button><strong>{points.toLocaleString()}</strong><button className="stepper" disabled={!isCaptain || lobby.ownTeamLocked} onClick={() => changePoints(player.id, 100)} aria-label={`Add 100 points to ${player.nickname}`}>+</button></div>;
                })}</div>
                {isCaptain && !lobby.ownTeamLocked && <button className="play-button compact-button" disabled={totalPoints !== 10_000} onClick={() => onCommand({ type: "lockAllocation" })}>LOCK MY CREW <span>✓</span></button>}
                {lobby.ownTeamLocked && <div className="locked-note">YOUR CREW'S PLAN IS LOCKED ✓</div>}
              </>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && isHost && <button className="play-button compact-button" disabled={lobby.connectedPlayerCount !== 10 || lobby.captainIds.BLUE === null || lobby.captainIds.RED === null} onClick={() => onCommand({ type: "beginAllocation" })}>OPEN POINT ALLOCATION <span>→</span></button>}
              {lobby.phase === "LOBBY" && lobby.allocationComplete && <>
                <button className={`ready-button ${self?.ready ? "ready-on" : ""}`} onClick={() => onCommand({ type: "ready", ready: !self?.ready })}>{self?.ready ? "I'M READY ✓" : "READY UP"}</button>
                {isHost && <button className="play-button compact-button" disabled={lobby.connectedPlayerCount !== 10 || lobby.players.some((player) => !player.ready)} onClick={() => onCommand({ type: "startCountdown" })}>START MATCH <span>→</span></button>}
              </>}
              {lobby.phase === "COUNTDOWN" && <><div className="countdown-number">{lobby.countdownSecondsRemaining ?? 0}</div>{isHost && <button className="quiet-button" onClick={() => onCommand({ type: "cancelCountdown" })}>CANCEL COUNTDOWN</button>}</>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && <div className="requirement-note">{lobby.connectedPlayerCount < 10 ? `Waiting for ${10 - lobby.connectedPlayerCount} more players` : "Both captains need to be selected"}</div>}
            </div>
          </section>
          <footer className="lobby-footer"><span className="online-dot" /> SERVER CONNECTED <span>·</span> {networkStatus.connectedPlayerCount}/10 PLAYERS</footer>
        </section>
      )}
    </main>
  );
}
