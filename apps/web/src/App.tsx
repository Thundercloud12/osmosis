import { useCallback, useEffect, useRef, useState } from "react";

import { LobbyScreen } from "./lobby/LobbyScreen";
import { MatchmakingScreen } from "./lobby/MatchmakingScreen";
import { ArenaCanvas } from "./game/ArenaCanvas";
import { ResultsScreen } from "./lobby/ResultsScreen";
import { MultiplayerClient, type NetworkStatus } from "./net/MultiplayerClient";
import type { LobbyCommand, LobbySnapshot, MatchmakingCommand, MatchmakingSnapshot, MatchSettings, QuickPlaySettings, RoomMode, RoomSnapshot } from "@osmosis/shared";
import { VoiceControls } from "./voice/VoiceControls";

export function App() {
  const [network] = useState(() => new MultiplayerClient());
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    state: "disconnected",
    connectedPlayerCount: 0,
  });
  const [error, setError] = useState<string>();
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [matchmakingSnapshot, setMatchmakingSnapshot] = useState<MatchmakingSnapshot | null>(null);
  const [matchmakingActive, setMatchmakingActive] = useState(false);
  const [reportNotice, setReportNotice] = useState<string>();
  const autoJoinStarted = useRef(false);
  const errorTimer = useRef<number | undefined>(undefined);

  const receiveLobbySnapshot = useCallback((snapshot: LobbySnapshot) => {
    setMatchmakingActive(false);
    setMatchmakingSnapshot(null);
    setLobby(snapshot);
    if (snapshot.phase !== "PLAYING" && snapshot.phase !== "RESULTS") setRoomSnapshot(null);
    const currentUrl = new URL(window.location.href);
    const currentCode = currentUrl.searchParams.get("room");
    if (currentCode !== snapshot.roomCode) {
      currentUrl.searchParams.set("room", snapshot.roomCode);
      window.history.replaceState(null, "", currentUrl);
    }
  }, []);
  const receiveNetworkStatus = useCallback((status: NetworkStatus) => {
    setNetworkStatus(status);
    if (status.state === "disconnected") {
      setLobby(null);
      setRoomSnapshot(null);
    }
  }, []);
  const receiveCommandError = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current !== undefined) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(undefined), 3_500);
  }, []);
  const receiveRoomSnapshot = useCallback((snapshot: RoomSnapshot) => setRoomSnapshot(snapshot), []);
  const receiveMatchmakingSnapshot = useCallback((snapshot: MatchmakingSnapshot) => {
    setMatchmakingSnapshot(snapshot);
    setMatchmakingActive(true);
  }, []);
  const receiveMatchmakingClosed = useCallback(() => {
    setMatchmakingActive(false);
    setMatchmakingSnapshot(null);
  }, []);
  const receiveReportAccepted = useCallback((message: string) => {
    setReportNotice(message);
    window.setTimeout(() => setReportNotice(undefined), 3_500);
  }, []);

  useEffect(() => {
    const unsubscribeLobby = network.onLobbySnapshot(receiveLobbySnapshot);
    const unsubscribeStatus = network.onStatus(receiveNetworkStatus);
    const unsubscribeError = network.onCommandError(receiveCommandError);
    const unsubscribeRoom = network.onSnapshot(receiveRoomSnapshot);
    const unsubscribeMatchmaking = network.onMatchmakingSnapshot(receiveMatchmakingSnapshot);
    const unsubscribeMatchmakingClosed = network.onMatchmakingClosed(receiveMatchmakingClosed);
    const unsubscribeReport = network.onReportAccepted(receiveReportAccepted);
    return () => {
      unsubscribeLobby();
      unsubscribeStatus();
      unsubscribeError();
      unsubscribeRoom();
      unsubscribeMatchmaking();
      unsubscribeMatchmakingClosed();
      unsubscribeReport();
      if (errorTimer.current !== undefined) window.clearTimeout(errorTimer.current);
    };
  }, [network, receiveCommandError, receiveLobbySnapshot, receiveNetworkStatus, receiveRoomSnapshot, receiveMatchmakingSnapshot, receiveMatchmakingClosed, receiveReportAccepted]);

  useEffect(() => {
    const roomCode = new URLSearchParams(window.location.search).get("room");
    if (autoJoinStarted.current) return;

    if (!roomCode) {
      autoJoinStarted.current = true;
      void network.resumeMatchmaking().then((resumed) => { if (resumed) setMatchmakingActive(true); });
      return;
    }

    const timer = window.setTimeout(() => {
      autoJoinStarted.current = true;
      void network.joinRoom(roomCode, "Crew").catch((joinError: unknown) => {
        setError(joinError instanceof Error ? joinError.message : "Could not join that room.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [network]);

  const createRoom = useCallback(async (nickname: string, roomMode: RoomMode, matchSettings: MatchSettings) => {
    setError(undefined);
    try {
      await network.createRoom(nickname, roomMode, matchSettings);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a room.");
    }
  }, [network]);

  const startSoloQuickPlay = useCallback(async (nickname: string, settings: QuickPlaySettings) => {
    setError(undefined);
    setMatchmakingActive(true);
    try { await network.queueSolo(nickname, settings); }
    catch (queueError) {
      setMatchmakingActive(false);
      setError(queueError instanceof Error ? queueError.message : "Could not join Quick Play.");
    }
  }, [network]);

  const createParty = useCallback(async (nickname: string, settings: QuickPlaySettings) => {
    setError(undefined);
    setMatchmakingActive(true);
    try { await network.createParty(nickname, settings); }
    catch (partyError) {
      setMatchmakingActive(false);
      setError(partyError instanceof Error ? partyError.message : "Could not create a crew party.");
    }
  }, [network]);

  const joinParty = useCallback(async (nickname: string, code: string) => {
    setError(undefined);
    setMatchmakingActive(true);
    try { await network.joinParty(nickname, code); }
    catch (partyError) {
      setMatchmakingActive(false);
      setError(partyError instanceof Error ? partyError.message : "Could not join that crew party.");
    }
  }, [network]);

  const joinRoom = useCallback(async (nickname: string, roomCode: string) => {
    setError(undefined);
    try {
      await network.joinRoom(roomCode, nickname);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not join that room.");
    }
  }, [network]);

  const sendCommand = useCallback((command: LobbyCommand) => {
    setError(undefined);
    network.sendCommand(command);
  }, [network]);

  const leaveRoom = useCallback(async () => {
    await network.disconnect();
    setLobby(null);
    setRoomSnapshot(null);
    setMatchmakingActive(false);
    setMatchmakingSnapshot(null);
    setNetworkStatus({ state: "disconnected", connectedPlayerCount: 0 });
    window.history.replaceState(null, "", window.location.pathname);
  }, [network]);

  let screen;
  if (matchmakingActive && !lobby && !roomSnapshot) {
    screen = <MatchmakingScreen snapshot={matchmakingSnapshot} error={error}
      onCommand={(command: MatchmakingCommand) => { setError(undefined); network.sendMatchmakingCommand(command); }}
      onLeave={() => { void network.leaveMatchmaking(); setMatchmakingActive(false); setMatchmakingSnapshot(null); window.history.replaceState(null, "", window.location.pathname); }} />;
  } else if (roomSnapshot?.phase === "RESULTS" && roomSnapshot.result) {
    const fallbackHost = lobby?.players.find((player) => player.id === lobby.selfPlayerId)?.isHost ?? false;
    const isHost = roomSnapshot.hostPlayerId ? roomSnapshot.hostPlayerId === roomSnapshot.selfPlayerId : fallbackHost;
    screen = <ResultsScreen result={roomSnapshot.result} isHost={isHost} error={error}
      onRematch={() => network.sendCommand({ type: "rematch" })} onLeave={leaveRoom} />;
  } else if (lobby?.phase === "PLAYING" || roomSnapshot?.phase === "PLAYING") {
    screen = <ArenaCanvas network={network} snapshot={roomSnapshot} error={error} reportNotice={reportNotice} onLeave={() => void leaveRoom()} onNetworkStatus={receiveNetworkStatus} networkStatus={networkStatus} />;
  } else screen = (
    <LobbyScreen
      lobby={lobby}
      networkStatus={networkStatus}
      error={error}
      latestRoomSnapshot={roomSnapshot}
      onCreate={createRoom}
      onJoin={joinRoom}
      onQuickPlay={startSoloQuickPlay}
      onCreateParty={createParty}
      onJoinParty={joinParty}
      onCommand={sendCommand}
      onLeave={leaveRoom}
    />
  );
  return <>{screen}{lobby && networkStatus.state === "connecting" && <div className="connection-banner" role="status">Reconnecting to your crew… your seat is reserved for 120 seconds.</div>}{lobby && <VoiceControls roomCode={lobby.roomCode} voiceCredential={lobby.voiceCredential}
    voiceRoomName={lobby.voiceRoomName} connected={networkStatus.state === "connected"}
    inMatch={roomSnapshot?.phase === "PLAYING"}
    {...(networkStatus.teamId ? { teamId: networkStatus.teamId } : {})} />}</>;
}
