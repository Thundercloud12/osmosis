import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GAME_RULES, QUICK_PLAY_SETTINGS, type LobbyCommand, type LobbySnapshot, type MatchSettings, type OpenRoomListing, type RoomMode, type RoomSnapshot } from "@osmosis/shared";
import type { NetworkStatus } from "../net/MultiplayerClient";
import { TutorialBook } from "./TutorialBook";
import { MatchDurationSlider } from "./MatchDurationSlider";
import { OpenRoomsPanel } from "./OpenRoomsPanel";
import { buildCrewRoster, getLobbyPermissions, getLobbyStage, summarizeAllocation } from "./lobbyPresentation";

interface LobbyScreenProps {
  lobby: LobbySnapshot | null;
  networkStatus: NetworkStatus;
  error: string | undefined;
  latestRoomSnapshot: RoomSnapshot | null;
  onCreate: (nickname: string, roomMode: RoomMode, matchSettings: MatchSettings) => void;
  onJoin: (nickname: string, code: string) => void;
  onQuickPlay: (nickname: string) => void;
  onCreateParty: (nickname: string) => void;
  onJoinParty: (nickname: string, code: string) => void;
  onJoinOpenRoom: (nickname: string, code: string) => void;
  onListOpenRooms: (signal?: AbortSignal) => Promise<OpenRoomListing[]>;
  onCommand: (command: LobbyCommand) => void;
  onLeave: () => void;
}

const teams = [
  { id: "BLUE", label: "Blue Crew", color: "blue" },
  { id: "RED", label: "Red Crew", color: "red" },
] as const;
export function LobbyScreen({ lobby, networkStatus, error, onCreate, onJoin, onQuickPlay, onCreateParty, onJoinParty, onJoinOpenRoom, onListOpenRooms, onCommand, onLeave }: LobbyScreenProps) {
  const [nickname, setNickname] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "");
  const [partyCode, setPartyCode] = useState(new URLSearchParams(window.location.search).get("party")?.toUpperCase() ?? "");
  const [copied, setCopied] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [lockPending, setLockPending] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const tutorialButtonRef = useRef<HTMLButtonElement>(null);
  const closeTutorial = useCallback(() => {
    setTutorialOpen(false);
    window.requestAnimationFrame(() => tutorialButtonRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!lockPending) return;
    if (lobby?.ownTeamLocked || lobby?.phase !== "ALLOCATION" || error) {
      setLockPending(false);
      setConfirmLock(false);
      return;
    }
    const timeout = window.setTimeout(() => setLockPending(false), 8_000);
    return () => window.clearTimeout(timeout);
  }, [error, lobby?.ownTeamLocked, lobby?.phase, lockPending]);
  const [roomMode, setRoomMode] = useState<RoomMode>("STANDARD");
  const [entryMode, setEntryMode] = useState<"PRIVATE" | "QUICK_PLAY" | "OPEN_ROOMS">("PRIVATE");
  const [teamSize, setTeamSize] = useState<4 | 5>(5);
  const [privateDuration, setPrivateDuration] = useState(15);
  const [openRooms, setOpenRooms] = useState<OpenRoomListing[]>([]);
  const [openRoomsLoading, setOpenRoomsLoading] = useState(false);
  const [openRoomsError, setOpenRoomsError] = useState<string>();
  const [openRoomsRefresh, setOpenRoomsRefresh] = useState(0);
  const testRoomModesEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_ROOM_MODES === "true";
  const self = lobby?.players.find((player) => player.id === lobby.selfPlayerId);
  const ownTeamPlayers = useMemo(
    () => lobby?.players.filter((player) => player.teamId === self?.teamId) ?? [],
    [lobby, self?.teamId],
  );
  const isCaptain = self?.isCaptain ?? false;
  const isHost = self?.isHost ?? false;
  const pointsByPlayer = new Map(lobby?.ownTeamAllocation.map((entry) => [entry.playerId, entry.points ?? 0]) ?? []);
  const allocationSummary = summarizeAllocation(
    lobby?.ownTeamAllocation.map((entry) => entry.points) ?? [],
    GAME_RULES.startingTeamPoints,
    GAME_RULES.minimumStartingPointsPerPlayer,
    GAME_RULES.allocationIncrement,
  );
  const totalPoints = allocationSummary.allocated;
  const permissions = lobby ? getLobbyPermissions(lobby, self) : null;
  useEffect(() => {
    if (lobby || entryMode !== "OPEN_ROOMS") return;
    let active = true;
    let inFlight = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      setOpenRoomsLoading(true);
      try {
        const rooms = await onListOpenRooms(controller.signal);
        if (!active) return;
        setOpenRooms(rooms);
        setOpenRoomsError(undefined);
      } catch (roomListError) {
        if (!active || (roomListError instanceof DOMException && roomListError.name === "AbortError")) return;
        setOpenRoomsError(roomListError instanceof Error ? roomListError.message : "Could not load open rooms.");
      } finally {
        inFlight = false;
        if (active) setOpenRoomsLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [entryMode, lobby, onListOpenRooms, openRoomsRefresh]);

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

  function requiredNickname(): string | undefined {
    const name = nickname.trim();
    if (!name) {
      setNameMissing(true);
      document.getElementById("nickname")?.focus();
      return undefined;
    }
    setNameMissing(false);
    return name;
  }

  function submitQuickPlay() {
    const name = requiredNickname();
    if (name) onQuickPlay(name);
  }

  function submitCreateParty() {
    const name = requiredNickname();
    if (name) onCreateParty(name);
  }

  function submitJoinParty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = requiredNickname();
    if (!name) return;
    if (partyCode.trim().length !== 6) return;
    onJoinParty(name, partyCode.trim().toUpperCase());
  }

  function joinListedRoom(code: string) {
    const name = requiredNickname();
    if (name) onJoinOpenRoom(name, code);
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
          <div className="room-chip"><span className="online-dot" /> CREW LOBBY</div>
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
            <div className="card-tab">CHOOSE YOUR NEXT MATCH</div>
            <div className="entry-name-field">
              <label className="field-label" htmlFor="nickname">CREWMATE NAME · REQUIRED</label>
              <input id="nickname" className="lobby-input" value={nickname} maxLength={24} placeholder="e.g. Starbean" required aria-required="true" aria-invalid={nameMissing && !nickname.trim()} aria-describedby={nameMissing && !nickname.trim() ? "nickname-error" : undefined} onInvalid={() => setNameMissing(true)} onChange={(event) => { setNickname(event.target.value); if (event.target.value.trim()) setNameMissing(false); }} />
              {nameMissing && !nickname.trim() && <p id="nickname-error" className="field-validation" role="alert">ENTER A CREWMATE NAME TO CONTINUE.</p>}
            </div>
            <div className="entry-mode-picker" role="group" aria-label="Choose how to play">
              <button type="button" className={entryMode === "PRIVATE" ? "is-selected" : ""} aria-pressed={entryMode === "PRIVATE"} onClick={() => setEntryMode("PRIVATE")}>Private Match</button>
              <button type="button" className={entryMode === "QUICK_PLAY" ? "is-selected" : ""} aria-pressed={entryMode === "QUICK_PLAY"} onClick={() => setEntryMode("QUICK_PLAY")}>Quick Play</button>
              <button type="button" className={entryMode === "OPEN_ROOMS" ? "is-selected" : ""} aria-pressed={entryMode === "OPEN_ROOMS"} onClick={() => setEntryMode("OPEN_ROOMS")}>Open Rooms</button>
            </div>

            <section id="entry-options" className="entry-mode-panel" aria-label={entryMode === "PRIVATE" ? "Private match options" : entryMode === "QUICK_PLAY" ? "Quick Play options" : "Open room list"}>
              {entryMode === "PRIVATE" && <>
                <div className="entry-panel-copy"><strong>HOST A PRIVATE MATCH</strong><span>Invite your crew with a room code.</span></div>
                <form id="private-entry-form" onSubmit={submitCreate}>
                  <div className="entry-field">
                    <label className="field-label" htmlFor="room-mode">ROOM MODE</label>
                    <select id="room-mode" className="lobby-input" value={roomMode} onChange={(event) => setRoomMode(event.target.value as RoomMode)}>
                      <option value="STANDARD">Standard match</option>
                      {testRoomModesEnabled && <>
                        <option value="TEST_1V1">Test match · 1v1</option>
                        <option value="TEST_2V2">Test match · 2v2</option>
                      </>}
                    </select>
                  </div>
                  <div className={`entry-settings-grid ${roomMode !== "STANDARD" ? "single-setting" : ""}`}>
                    {roomMode === "STANDARD" && <div className="entry-field">
                      <label className="field-label" htmlFor="private-team-size">TEAM SIZE</label>
                      <select id="private-team-size" className="lobby-input" value={teamSize} onChange={(event) => setTeamSize(Number(event.target.value) as 4 | 5)}><option value={4}>4 versus 4</option><option value={5}>5 versus 5</option></select>
                    </div>}
                    <MatchDurationSlider id="private-duration" label="MATCH LENGTH" valueMinutes={privateDuration} minimumMinutes={GAME_RULES.minimumMatchDurationSeconds / 60} maximumMinutes={GAME_RULES.maximumMatchDurationSeconds / 60} onChange={setPrivateDuration} />
                  </div>
                  <button type="submit" className="play-button entry-submit" disabled={networkStatus.state === "connecting"}>
                    {networkStatus.state === "connecting" ? "CONNECTING…" : "CREATE PRIVATE ROOM"}<span>→</span>
                  </button>
                </form>
                <div className="entry-divider"><span>OR JOIN A PRIVATE ROOM</span></div>
                <form id="join-room-form" onSubmit={submitJoin} className="entry-code-form">
                  <label className="field-label" htmlFor="room-code">ROOM CODE · 6 LETTERS</label>
                  <div className="join-row"><input id="room-code" className="lobby-input code-input" value={roomCode} maxLength={6} placeholder="ABC123" onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} /><button className="join-button" disabled={roomCode.length !== 6 || networkStatus.state === "connecting"}>JOIN ROOM</button></div>
                </form>
              </>}

              {entryMode === "QUICK_PLAY" && <>
                <div className="entry-panel-copy"><strong>ONE CLICK. FIRST FAIR MATCH.</strong><span>Quick Play puts you in one FIFO {QUICK_PLAY_SETTINGS.teamSize}v{QUICK_PLAY_SETTINGS.teamSize} queue. The oldest compatible players are assigned first · {QUICK_PLAY_SETTINGS.matchDurationSeconds / 60} minutes per match.</span></div>
                <button type="button" className="play-button entry-submit quickplay-button" disabled={networkStatus.state === "connecting"} onClick={submitQuickPlay}>
                  {networkStatus.state === "connecting" ? "CONNECTING…" : "PLAY QUICK PLAY"}<span>✦</span>
                </button>
                <div className="entry-divider"><span>PLAY WITH FRIENDS</span></div>
                <button type="button" className="secondary-entry-button" disabled={networkStatus.state === "connecting"} onClick={submitCreateParty}>CREATE A CREW PARTY</button>
                <form id="join-party-form" onSubmit={submitJoinParty} className="entry-code-form">
                  <label className="field-label" htmlFor="party-code">HAVE A PARTY CODE?</label>
                  <div className="join-row"><input id="party-code" className="lobby-input code-input" value={partyCode} maxLength={6} placeholder="ABC123" onChange={(event) => setPartyCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} /><button className="join-button" disabled={partyCode.length !== 6 || networkStatus.state === "connecting"}>JOIN CREW</button></div>
                </form>
              </>}

              {entryMode === "OPEN_ROOMS" && <>
                <div className="entry-panel-copy"><strong>FIND AN OPEN CREW LOBBY</strong><span>Join a room whose host has opened it to everyone.</span></div>
                <OpenRoomsPanel rooms={openRooms} loading={openRoomsLoading} error={openRoomsError}
                  disabled={networkStatus.state === "connecting"} onRefresh={() => setOpenRoomsRefresh((value) => value + 1)}
                  onJoin={joinListedRoom} />
              </>}
            </section>

            {error && <p className="lobby-error" role="alert">{error}</p>}
            {networkStatus.state === "connecting" && <p className="connecting-note">Finding your airlock…</p>}
          </div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-heading">
            <div className="room-heading-copy">
              <p className="mini-label">PRE-MATCH AIRLOCK</p>
              <h1>Gather your <span>crew.</span></h1>
              <p className="room-context">{lobby.teamSelectionLocked ? "Quick Play · crews are assigned" : lobby.roomMode === "TEST_1V1" ? "Test match · one player on each crew" : lobby.roomMode === "TEST_2V2" ? "Test match · two players on each crew" : "Invite your friends, then get both crews ready."} <span>{lobby.connectedPlayerCount}/{lobby.matchSettings.teamSize * 2} players connected</span></p>
            </div>
            <div className="lobby-room-actions">
              {!lobby.teamSelectionLocked && <div className="room-invite-chip"><span>ROOM CODE</span><strong>{lobby.roomCode}</strong><button className="copy-button" onClick={() => void copyInvite()} aria-label={copied ? "Invite link copied" : "Copy room invite link"}>{copied ? "COPIED ✓" : "COPY INVITE"}</button></div>}
              {!lobby.teamSelectionLocked && lobby.phase === "LOBBY" && (isHost
                ? <button type="button" className={`room-visibility-toggle ${lobby.isPublic ? "is-open" : ""}`} aria-pressed={lobby.isPublic} onClick={() => onCommand({ type: "setRoomPublic", isPublic: !lobby.isPublic })}>
                  <span aria-hidden="true">{lobby.isPublic ? "◉" : "◎"}</span>{lobby.isPublic ? "CLOSE TO PUBLIC" : "OPEN TO PUBLIC"}
                </button>
                : <span className={`room-visibility-label ${lobby.isPublic ? "is-open" : ""}`}><i aria-hidden="true" />{lobby.isPublic ? "OPEN TO PUBLIC" : "PRIVATE ROOM"}</span>)}
              <button className="quiet-button" onClick={onLeave}>LEAVE ROOM</button>
            </div>
          </div>

          <ol className="lobby-steps" aria-label="Pre-match progress">
            {["Assemble crews", "Allocate points", "Ready for match"].map((step, index) => {
              const currentStage = getLobbyStage(lobby);
              const isComplete = index < currentStage;
              const isCurrent = index === currentStage;
              return <li className={`${isComplete ? "is-complete" : ""} ${isCurrent ? "is-current" : ""}`} aria-current={isCurrent ? "step" : undefined} key={step}>
                <span>{isComplete ? "✓" : index + 1}</span>{step}
              </li>;
            })}
          </ol>

          <div className="lobby-grid">
            {teams.map((team) => {
              const rosterSlots = buildCrewRoster(lobby.players, team.id, lobby.matchSettings.teamSize, lobby.selfPlayerId);
              const roster = rosterSlots.flatMap((slot) => slot.player ? [slot.player] : []);
              const onlineCount = roster.filter((player) => player.connected).length;
              const reconnectingCount = roster.length - onlineCount;
              const readyCount = roster.filter((player) => player.ready).length;
              const captainId = lobby.captainIds[team.id];
              const isYourCrew = self?.teamId === team.id;
              return <section className={`team-card team-card-${team.color} ${isYourCrew ? "is-your-crew" : ""}`} key={team.id} aria-labelledby={`crew-${team.id}-title`}>
                <header className="team-card-heading">
                  <span className="team-emblem"><img src="/assets/characters/astronaut.png" alt="" /></span>
                  <div className="team-heading-copy"><p>{team.id === "BLUE" ? "COOL AS COSMOS" : "A LITTLE BIT BOLD"}</p><h2 id={`crew-${team.id}-title`}>{team.label}</h2></div>
                  {isYourCrew && <span className="your-crew-label">YOUR CREW</span>}
                  <strong className="crew-count">{roster.length}/{lobby.matchSettings.teamSize}</strong>
                </header>
                <div className="team-presence-summary" aria-label={`${onlineCount} online${reconnectingCount ? `, ${reconnectingCount} reconnecting` : ""}${lobby.allocationComplete ? `, ${readyCount} ready` : ""}`}>
                  <span className="presence-online"><i aria-hidden="true" />{onlineCount} online</span>
                  {reconnectingCount > 0 && <span className="presence-reconnecting"><i aria-hidden="true" />{reconnectingCount} reconnecting</span>}
                  {lobby.allocationComplete && <span className="presence-ready">{readyCount}/{lobby.matchSettings.teamSize} ready</span>}
                  {!lobby.allocationComplete && <span>{captainId ? "Captain selected" : "Captain needed"}</span>}
                </div>
                <ul className="roster-list" aria-label={`${team.label} roster`} aria-live="polite" aria-relevant="all">{rosterSlots.map(({ player, isLocalPlayer }, index) =>
                  <li className={`roster-slot ${player ? "occupied" : "empty"} ${isLocalPlayer ? "is-local-player" : ""}`} key={player?.id ?? `${team.id}-${index}`}>
                    <span className="crew-avatar">{player ? <img src="/assets/characters/astronaut.png" alt="" /> : "+"}</span>
                    {player ? <>
                      <span className="crew-player-info">
                        <span className="crew-name">{player.nickname}</span>
                        <span className="crew-player-meta">
                          {isLocalPlayer && <span className="local-player-label">You</span>}
                          {player.isHost && <span>Host</span>}
                          {player.isCaptain && <span>Captain</span>}
                          {player.ready && lobby.allocationComplete && <span className="ready-label">Ready</span>}
                        </span>
                      </span>
                      <span className={`roster-connection ${player.connected ? "is-online" : "is-reconnecting"}`} aria-label={player.connected ? "Online" : "Reconnecting"}>
                        <i aria-hidden="true" />{player.connected ? "Online" : "Reconnecting"}
                      </span>
                    </> : <span className="crew-name">Waiting for player…</span>}
                  </li>,
                )}</ul>
                {self && permissions?.canJoinCrew(team.id) && <button className="team-action" onClick={() => onCommand({ type: "chooseTeam", teamId: team.id })}>JOIN THIS CREW</button>}
                {isYourCrew && !captainId && permissions?.canClaimCaptain && <button className="team-action" onClick={() => onCommand({ type: "captain", action: "claim" })}>BECOME CAPTAIN</button>}
                {isYourCrew && self?.isCaptain && permissions?.canReleaseCaptain && captainId === self.id && <button className="team-action secondary-action" onClick={() => onCommand({ type: "captain", action: "release" })}>STEP DOWN AS CAPTAIN</button>}
              </section>;
            })}
          </div>

          <section className="control-card">
            <div className="control-copy">
              <p className="mini-label">{lobby.phase === "ALLOCATION" ? "CAPTAIN'S TABLE" : lobby.phase === "COUNTDOWN" ? "AIRLOCK CLOSING" : "NEXT UP"}</p>
              <h2>{lobby.phase === "ALLOCATION" ? "Share the team points." : lobby.phase === "COUNTDOWN" ? "Launching soon!" : lobby.allocationComplete ? "Ready for liftoff?" : "Build your crews."}</h2>
              <p>{lobby.phase === "ALLOCATION"
                ? lobby.ownTeamLocked ? "Your crew has locked its plan. The other captain is finishing their allocation." : isCaptain ? `Distribute ${GAME_RULES.startingTeamPoints.toLocaleString()} points among your crew. The other crew's plan stays private.` : "Your captain is distributing your crew's points. The other crew's plan stays private."
                : lobby.phase === "COUNTDOWN" ? "The host can cancel if someone needs another moment."
                  : lobby.allocationComplete ? `${lobby.players.filter((player) => player.ready).length}/${lobby.matchSettings.teamSize * 2} crewmates ready to launch. Ready up when your crew is set.`
                  : permissions?.bothCrewsFull && permissions.bothCaptainsSelected ? isHost ? "Both crews are set. Open point allocation when you’re ready." : "Both crews are set. Waiting for the host to open point allocation."
                      : `Fill both crews (${lobby.matchSettings.teamSize} each) and choose one captain per crew.`}</p>
              {error && <p className="lobby-error" role="alert">{error}</p>}
            </div>
            <div className="control-actions">
              {lobby.phase === "ALLOCATION" && <>
                <div className="allocation-list">{ownTeamPlayers.map((player) => {
                  const points = pointsByPlayer.get(player.id) ?? 0;
                  const step = GAME_RULES.allocationIncrement;
                  const hasTeammate = ownTeamPlayers.some((candidate) => candidate.id !== player.id);
                  const hasDonor = ownTeamPlayers.some((candidate) => candidate.id !== player.id && (pointsByPlayer.get(candidate.id) ?? 0) >= GAME_RULES.minimumStartingPointsPerPlayer + step);
                  return <div className="allocation-row" key={player.id}><span className="allocation-player"><span className="allocation-avatar"><img src="/assets/characters/astronaut.png" alt="" /></span><span>{player.nickname}{player.isCaptain ? <small>CAPTAIN</small> : null}</span></span><button className="stepper" disabled={!permissions?.canAdjustAllocation || points <= GAME_RULES.minimumStartingPointsPerPlayer || !hasTeammate} onClick={() => changePoints(player.id, -step)} aria-label={`Remove ${step} points from ${player.nickname}`}>−</button><strong>{points.toLocaleString()}</strong><button className="stepper" disabled={!permissions?.canAdjustAllocation || !hasDonor} onClick={() => changePoints(player.id, step)} aria-label={`Add ${step} points to ${player.nickname}`}>+</button></div>;
                })}</div>
                <div className="allocation-summary" aria-live="polite" aria-label={`Total points ${GAME_RULES.startingTeamPoints.toLocaleString()}, allocated ${totalPoints.toLocaleString()}, remaining ${allocationSummary.remaining.toLocaleString()}`}>
                  <div><span>Total points</span><strong>{GAME_RULES.startingTeamPoints.toLocaleString()}</strong></div>
                  <div><span>Allocated</span><strong>{totalPoints.toLocaleString()}</strong></div>
                  <div className={allocationSummary.remaining < 0 ? "has-allocation-error" : ""}><span>Remaining</span><strong>{allocationSummary.remaining.toLocaleString()}</strong></div>
                </div>
                {!allocationSummary.valid && <p className="allocation-wait-note" role="status">{allocationSummary.hasAllValues ? `Your allocation must total ${GAME_RULES.startingTeamPoints.toLocaleString()} points, with at least ${GAME_RULES.minimumStartingPointsPerPlayer.toLocaleString()} per crewmate.` : "Waiting for the crew allocation to sync…"}</p>}
                {isCaptain && !lobby.ownTeamLocked && !confirmLock && <button className="play-button compact-button" disabled={!permissions?.canLockAllocation || !allocationSummary.valid} onClick={() => setConfirmLock(true)}>REVIEW CREW ALLOCATION <span>→</span></button>}
                {confirmLock && !lobby.ownTeamLocked && <div className="allocation-lock-confirm" role="group" aria-label="Confirm crew allocation lock" aria-busy={lockPending}>
                  <p>Locking is final. Your crew’s points can’t be changed after confirmation.</p>
                  <div><button className="quiet-button" disabled={lockPending} onClick={() => setConfirmLock(false)}>GO BACK</button><button className="play-button compact-button" disabled={lockPending || !permissions?.canLockAllocation || !allocationSummary.valid} onClick={() => { setLockPending(true); onCommand({ type: "lockAllocation" }); }}>{lockPending ? "LOCKING…" : "LOCK MY CREW"}</button></div>
                </div>}
                {!isCaptain && !lobby.ownTeamLocked && <p className="allocation-wait-note">Your captain is in charge of this allocation.</p>}
                {lobby.ownTeamLocked && <div className="locked-note" role="status">YOUR CREW'S PLAN IS LOCKED ✓</div>}
              </>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && isHost && <button className="play-button compact-button" disabled={!permissions?.canOpenAllocation} onClick={() => onCommand({ type: "beginAllocation" })}>OPEN POINT ALLOCATION <span>→</span></button>}
              {lobby.phase === "LOBBY" && lobby.allocationComplete && <>
                <button className={`ready-button ${self?.ready ? "ready-on" : ""}`} disabled={!permissions?.canReady} onClick={() => onCommand({ type: "ready", ready: !self?.ready })}>{self?.ready ? "I'M READY ✓" : "READY UP"}</button>
                {isHost && <button className="play-button compact-button" disabled={!permissions?.canStartMatch} onClick={() => onCommand({ type: "startCountdown" })}>START MATCH <span>→</span></button>}
              </>}
              {lobby.phase === "COUNTDOWN" && <><div className="countdown-number">{lobby.countdownSecondsRemaining ?? 0}</div>{permissions?.canCancelCountdown && <button className="quiet-button" onClick={() => onCommand({ type: "cancelCountdown" })}>CANCEL COUNTDOWN</button>}</>}
              {lobby.phase === "LOBBY" && !lobby.allocationComplete && <div className="requirement-note">{!permissions?.bothCrewsFull ? `Waiting for ${lobby.matchSettings.teamSize * 2 - lobby.players.length} more player${lobby.matchSettings.teamSize * 2 - lobby.players.length === 1 ? "" : "s"}` : !permissions.bothCaptainsSelected ? "Choose a captain for each crew" : "Waiting for the host to open point allocation"}</div>}
            </div>
          </section>
          <footer className="lobby-footer"><span className="online-dot" /> SERVER CONNECTED</footer>
        </section>
      )}
      {tutorialOpen && !lobby && <TutorialBook onClose={closeTutorial} />}
    </main>
  );
}
