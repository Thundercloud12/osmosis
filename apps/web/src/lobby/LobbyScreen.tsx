import { useCallback, useMemo, useRef, useState } from "react";

import { GAME_RULES, type LobbyCommand, type LobbySnapshot, type MatchSettings, type QuickPlaySettings, type RoomMode, type RoomSnapshot } from "@osmosis/shared";
import type { NetworkStatus } from "../net/MultiplayerClient";
import { TutorialBook } from "./TutorialBook";

interface LobbyScreenProps {
  lobby: LobbySnapshot | null;
  networkStatus: NetworkStatus;
  error: string | undefined;
  latestRoomSnapshot: RoomSnapshot | null;
  onCreate: (nickname: string, roomMode: RoomMode, matchSettings: MatchSettings) => void;
  onJoin: (nickname: string, code: string) => void;
  onQuickPlay: (nickname: string, settings: QuickPlaySettings) => void;
  onCreateParty: (nickname: string, settings: QuickPlaySettings) => void;
  onJoinParty: (nickname: string, code: string) => void;
  onCommand: (command: LobbyCommand) => void;
  onLeave: () => void;
}

const teams = [
  { id: "BLUE", label: "Blue Crew", color: "blue" },
  { id: "RED", label: "Red Crew", color: "red" },
] as const;

export function LobbyScreen({ lobby, networkStatus, error, onCreate, onJoin, onQuickPlay, onCreateParty, onJoinParty, onCommand, onLeave }: LobbyScreenProps) {
  const [nickname, setNickname] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "");
  const [partyCode, setPartyCode] = useState(new URLSearchParams(window.location.search).get("party")?.toUpperCase() ?? "");
  const [copied, setCopied] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const tutorialButtonRef = useRef<HTMLButtonElement>(null);
  const closeTutorial = useCallback(() => {
    setTutorialOpen(false);
    window.requestAnimationFrame(() => tutorialButtonRef.current?.focus());
  }, []);
  const [roomMode, setRoomMode] = useState<RoomMode>("STANDARD");
  const [teamSize, setTeamSize] = useState<4 | 5>(5);
  const [privateDuration, setPrivateDuration] = useState(15);
  const [quickPlayDuration, setQuickPlayDuration] = useState<QuickPlaySettings["matchDurationSeconds"]>(900);
  const testRoomModesEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_ROOM_MODES === "true";
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
    const name = nickname.trim();
    if (!name) {
      setNameMissing(true);
      document.getElementById("nickname")?.focus();
      return;
    }
    setNameMissing(false);
    const effectiveTeamSize = roomMode === "TEST_1V1" ? 1 : roomMode === "TEST_2V2" ? 2 : teamSize;
    onCreate(name, roomMode, { teamSize: effectiveTeamSize, matchDurationSeconds: privateDuration * 60 });
  }

  function submitJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setNameMissing(true);
      document.getElementById("nickname")?.focus();
      return;
    }
    if (roomCode.trim().length !== 6) return;
    setNameMissing(false);
    onJoin(name, roomCode.trim().toUpperCase());
  }

  function submitQuickPlay(action: "solo" | "party") {
    const name = nickname.trim();
    if (!name) {
      setNameMissing(true);
      document.getElementById("nickname")?.focus();
      return;
    }
    setNameMissing(false);
    const settings: QuickPlaySettings = { teamSize, matchDurationSeconds: quickPlayDuration };
    if (action === "solo") onQuickPlay(name, settings);
    else onCreateParty(name, settings);
  }

  function submitJoinParty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setNameMissing(true);
      document.getElementById("nickname")?.focus();
      return;
    }
    if (partyCode.trim().length !== 6) return;
    setNameMissing(false);
    onJoinParty(name, partyCode.trim().toUpperCase());
  }

  function changePoints(playerId: string, delta: number) {
    if (!lobby) return;
    const values = Object.fromEntries(lobby.ownTeamAllocation.map((entry) => [entry.playerId, entry.points ?? 0]));
    const donor = ownTeamPlayers.find((player) => player.id !== playerId && (delta > 0
      ? (values[player.id] ?? 0) >= GAME_RULES.minimumStartingPointsPerPlayer + delta
      : true));
    if (!donor) return;
    if (delta < 0 && (values[playerId] ?? 0) + delta < GAME_RULES.minimumStartingPointsPerPlayer) return;
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
        ) : <div className="lobby-header-actions"><div className="lobby-kicker">A LITTLE SPACE. A LOT OF TEAMWORK.</div><button ref={tutorialButtonRef} className="tutorial-open-button" aria-label="How to play" aria-haspopup="dialog" aria-expanded={tutorialOpen} title="How to play" onClick={() => setTutorialOpen(true)}>?</button></div>}
      </header>

      {!lobby ? (
        <section className="welcome-layout">
          <div className="welcome-copy">
            <div className="welcome-scene" aria-hidden="true"><img className="welcome-scene-image" src="/assets/tutorial/explore.png" alt="" /><div className="welcome-scene-shade" /><div className="welcome-star star-one">✦</div><div className="welcome-star star-two">✦</div><div className="welcome-crew-stack"><span className="welcome-crew crew-blue"><img src="/assets/characters/astronaut.png" alt="" /></span><span className="welcome-crew crew-yellow"><img src="/assets/characters/astronaut.png" alt="" /></span><span className="welcome-crew crew-coral"><img src="/assets/characters/astronaut.png" alt="" /></span></div><span className="welcome-scene-label">SOMEWHERE IN THE OSMOSIS ARENA</span></div>
            <p className="mini-label">READY, CREWMATE?</p>
            <h1>OSMOSIS<br /><span>CREW UP.</span></h1>
            <p className="welcome-subtitle">Team up, share the points, and take over the arena together.</p>
          </div>
          <div className="welcome-card">
            <div className="card-tab">YOUR CREW STARTS HERE</div>
            <form onSubmit={submitCreate}>
              <label className="field-label" htmlFor="nickname">CREWMATE NAME · REQUIRED</label>
              <input id="nickname" className="lobby-input" value={nickname} maxLength={24} placeholder="e.g. Starbean" required aria-required="true" aria-invalid={nameMissing && !nickname.trim()} aria-describedby={nameMissing && !nickname.trim() ? "nickname-error" : undefined} onInvalid={() => setNameMissing(true)} onChange={(event) => { setNickname(event.target.value); if (event.target.value.trim()) setNameMissing(false); }} />
              {nameMissing && !nickname.trim() && <p id="nickname-error" className="field-validation" role="alert">ENTER A CREWMATE NAME TO CONTINUE.</p>}
              <label className="field-label room-mode-label" htmlFor="room-mode">ROOM MODE</label>
              <select id="room-mode" className="lobby-input" value={roomMode} onChange={(event) => setRoomMode(event.target.value as RoomMode)}>
                <option value="STANDARD">Standard match</option>
                {testRoomModesEnabled && <>
                  <option value="TEST_1V1">Test match · 1v1</option>
                  <option value="TEST_2V2">Test match · 2v2</option>
                </>}
              </select>
              {roomMode === "STANDARD" && <div className="lobby-settings-row">
                <label className="field-label" htmlFor="private-team-size">TEAM SIZE</label>
                <select id="private-team-size" className="lobby-input" value={teamSize} onChange={(event) => setTeamSize(Number(event.target.value) as 4 | 5)}><option value={4}>4 versus 4</option><option value={5}>5 versus 5</option></select>
              </div>}
              <label className="field-label room-mode-label" htmlFor="private-duration">MATCH LENGTH</label>
              <select id="private-duration" className="lobby-input" value={privateDuration} onChange={(event) => setPrivateDuration(Number(event.target.value))}>
                {Array.from({ length: 26 }, (_, index) => index + 5).map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}
              </select>
              <button type="submit" className="play-button" disabled={networkStatus.state === "connecting"}>
                {networkStatus.state === "connecting" ? "CONNECTING…" : "CREATE A ROOM"}<span>→</span>
              </button>
            </form>
            <div className="or-divider"><span /> OR JOIN YOUR FRIENDS <span /></div>
            <form onSubmit={submitJoin} className="join-form">
              <label className="field-label" htmlFor="room-code">ROOM CODE</label>
              <div className="join-row"><input id="room-code" className="lobby-input code-input" value={roomCode} maxLength={6} placeholder="6 LETTERS" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} /><button className="join-button" disabled={roomCode.length !== 6}>JOIN</button></div>
            </form>
            <section className="quickplay-entry">
              <div className="or-divider"><span /> QUICK PLAY <span /></div>
              <div className="quickplay-settings-row">
                <label className="field-label" htmlFor="quickplay-team-size">TEAM SIZE</label>
                <select id="quickplay-team-size" className="lobby-input" value={teamSize} onChange={(event) => setTeamSize(Number(event.target.value) as 4 | 5)}><option value={4}>4v4</option><option value={5}>5v5</option></select>
                <label className="field-label" htmlFor="quickplay-duration">MATCH LENGTH</label>
                <select id="quickplay-duration" className="lobby-input" value={quickPlayDuration} onChange={(event) => setQuickPlayDuration(Number(event.target.value) as QuickPlaySettings["matchDurationSeconds"])}>
                  {[300, 600, 900, 1200].map((seconds) => <option value={seconds} key={seconds}>{seconds / 60} minutes</option>)}
                </select>
              </div>
              <button type="button" className="play-button quickplay-button" disabled={networkStatus.state === "connecting"} onClick={() => submitQuickPlay("solo")}>PLAY QUICK PLAY <span>✦</span></button>
              <button type="button" className="join-button quickplay-party-button" disabled={networkStatus.state === "connecting"} onClick={() => submitQuickPlay("party")}>CREATE A CREW PARTY</button>
              <form onSubmit={submitJoinParty} className="join-form party-code-form">
                <label className="field-label" htmlFor="party-code">JOIN A CREW PARTY</label>
                <div className="join-row"><input id="party-code" className="lobby-input code-input" value={partyCode} maxLength={6} placeholder="6 LETTERS" onChange={(event) => setPartyCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} /><button className="join-button" disabled={partyCode.length !== 6 || networkStatus.state === "connecting"}>JOIN</button></div>
              </form>
              <p className="matchmaking-entry-note">Parties stay together. Quick Play fills open crew spots with compatible players.</p>
            </section>
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
          <div className="invite-strip"><span>{lobby.teamSelectionLocked ? "Quick Play · crew assignments are locked" : lobby.roomMode === "TEST_1V1" ? "Test match · one player on each crew" : lobby.roomMode === "TEST_2V2" ? "Test match · two players on each crew" : "Send your friends the room code"}</span>{!lobby.teamSelectionLocked && <><strong>{lobby.roomCode}</strong><button className="copy-button" onClick={() => void copyInvite()}>{copied ? "COPIED! ✓" : "COPY INVITE ↗"}</button></>}<span className="player-count">{lobby.connectedPlayerCount}/{lobby.matchSettings.teamSize * 2} PLAYERS</span></div>

          <div className="lobby-grid">
            {teams.map((team) => {
              const roster = lobby.players.filter((player) => player.teamId === team.id);
              const captainId = lobby.captainIds[team.id];
              return <section className={`team-card team-card-${team.color}`} key={team.id}>
                <header className="team-card-heading"><span className="team-emblem"><img src="/assets/characters/astronaut.png" alt="" /></span><div><p>{team.id === "BLUE" ? "COOL AS COSMOS" : "A LITTLE BIT BOLD"}</p><h2>{team.label}</h2></div><strong>{roster.length}/{lobby.matchSettings.teamSize}</strong></header>
                <div className="roster-list">{Array.from({ length: lobby.matchSettings.teamSize }, (_, index) => {
                  const player = roster[index];
                  return <div className={`roster-slot ${player ? "occupied" : "empty"}`} key={player?.id ?? `${team.id}-${index}`}>
                    <span className="crew-avatar">{player ? <img src="/assets/characters/astronaut.png" alt="" /> : "+"}</span>
                    <span className="crew-name">{player?.nickname ?? "Waiting for a crewmate"}</span>
                    {player?.isHost && <small className="role-badge host-badge">HOST</small>}
                    {player?.isCaptain && <small className="role-badge captain-badge">CAPTAIN</small>}
                    {player && !player.connected && <small className="offline-badge">RECONNECTING</small>}
                    {player?.ready && <small className="ready-badge">READY ✓</small>}
                  </div>;
                })}</div>
                {self && self.teamId !== team.id && lobby.phase === "LOBBY" && !lobby.allocationComplete && !lobby.teamSelectionLocked && <button className="team-action" onClick={() => onCommand({ type: "chooseTeam", teamId: team.id })}>JOIN THIS CREW</button>}
                {self?.teamId === team.id && !captainId && lobby.phase === "LOBBY" && !lobby.allocationComplete && <button className="team-action" onClick={() => onCommand({ type: "captain", action: "claim" })}>BECOME CAPTAIN</button>}
                {self?.isCaptain && captainId === self.id && lobby.phase === "LOBBY" && !lobby.allocationComplete && <button className="team-action secondary-action" onClick={() => onCommand({ type: "captain", action: "release" })}>STEP DOWN AS CAPTAIN</button>}
              </section>;
            })}
          </div>

          <section className="control-card">
            <div className="control-copy">
              <p className="mini-label">{lobby.phase === "ALLOCATION" ? "CAPTAIN'S TABLE" : lobby.phase === "COUNTDOWN" ? "AIRLOCK CLOSING" : "NEXT UP"}</p>
              <h2>{lobby.phase === "ALLOCATION" ? "Share the team points." : lobby.phase === "COUNTDOWN" ? "Launching soon!" : lobby.allocationComplete ? "Ready for liftoff?" : "Pick your captains."}</h2>
              <p>{lobby.phase === "ALLOCATION" ? `Your crew's captain can split ${totalPoints.toLocaleString()} points, with at least 500 for each crewmate. The other crew's plan stays private.` : lobby.phase === "COUNTDOWN" ? "The host can cancel if someone needs another moment." : lobby.allocationComplete ? `${lobby.players.filter((player) => player.ready).length}/${lobby.matchSettings.teamSize * 2} crewmates ready to launch.` : `Fill both crews (${lobby.matchSettings.teamSize} each), then each side picks a captain to plan its opening points.`}</p>
              {error && <p className="lobby-error" role="alert">{error}</p>}
            </div>
            <div className="control-actions">
              {lobby.phase === "ALLOCATION" && <>
                <div className="allocation-list">{ownTeamPlayers.map((player) => {
                  const points = pointsByPlayer.get(player.id) ?? 0;
                  const step = GAME_RULES.allocationIncrement;
                  const hasTeammate = ownTeamPlayers.some((candidate) => candidate.id !== player.id);
                  const hasDonor = ownTeamPlayers.some((candidate) => candidate.id !== player.id && (pointsByPlayer.get(candidate.id) ?? 0) >= GAME_RULES.minimumStartingPointsPerPlayer + step);
                  return <div className="allocation-row" key={player.id}><span className="allocation-player"><span className="allocation-avatar"><img src="/assets/characters/astronaut.png" alt="" /></span>{player.nickname}{player.isCaptain ? " ✦" : ""}</span><button className="stepper" disabled={!isCaptain || lobby.ownTeamLocked || points <= GAME_RULES.minimumStartingPointsPerPlayer || !hasTeammate} onClick={() => changePoints(player.id, -step)} aria-label={`Remove ${step} points from ${player.nickname}`}>−</button><strong>{points.toLocaleString()}</strong><button className="stepper" disabled={!isCaptain || lobby.ownTeamLocked || !hasDonor} onClick={() => changePoints(player.id, step)} aria-label={`Add ${step} points to ${player.nickname}`}>+</button></div>;
                })}</div>
                {isCaptain && !lobby.ownTeamLocked && <button className="play-button compact-button" disabled={totalPoints !== 10_000} onClick={() => onCommand({ type: "lockAllocation" })}>LOCK MY CREW <span>✓</span></button>}
                {lobby.ownTeamLocked && <div className="locked-note">YOUR CREW'S PLAN IS LOCKED ✓</div>}
              </>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && isHost && <button className="play-button compact-button" disabled={lobby.connectedPlayerCount !== lobby.matchSettings.teamSize * 2 || lobby.captainIds.BLUE === null || lobby.captainIds.RED === null} onClick={() => onCommand({ type: "beginAllocation" })}>OPEN POINT ALLOCATION <span>→</span></button>}
              {lobby.phase === "LOBBY" && lobby.allocationComplete && <>
                <button className={`ready-button ${self?.ready ? "ready-on" : ""}`} onClick={() => onCommand({ type: "ready", ready: !self?.ready })}>{self?.ready ? "I'M READY ✓" : "READY UP"}</button>
                {isHost && <button className="play-button compact-button" disabled={lobby.connectedPlayerCount !== lobby.matchSettings.teamSize * 2 || lobby.players.some((player) => !player.ready)} onClick={() => onCommand({ type: "startCountdown" })}>START MATCH <span>→</span></button>}
              </>}
              {lobby.phase === "COUNTDOWN" && <><div className="countdown-number">{lobby.countdownSecondsRemaining ?? 0}</div>{isHost && <button className="quiet-button" onClick={() => onCommand({ type: "cancelCountdown" })}>CANCEL COUNTDOWN</button>}</>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && <div className="requirement-note">{lobby.connectedPlayerCount < lobby.matchSettings.teamSize * 2 ? `Waiting for ${lobby.matchSettings.teamSize * 2 - lobby.connectedPlayerCount} more players` : "Both captains need to be selected"}</div>}
            </div>
          </section>
          <footer className="lobby-footer"><span className="online-dot" /> SERVER CONNECTED <span>·</span> {networkStatus.connectedPlayerCount}/{lobby.matchSettings.teamSize * 2} PLAYERS</footer>
        </section>
      )}
      {tutorialOpen && !lobby && <TutorialBook onClose={closeTutorial} />}
    </main>
  );
}
