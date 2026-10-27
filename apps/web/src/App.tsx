import { useCallback, useEffect, useRef, useState } from "react";

import { LobbyScreen } from "./lobby/LobbyScreen";
import { ArenaCanvas } from "./game/ArenaCanvas";
import { ResultsScreen } from "./lobby/ResultsScreen";
import { MultiplayerClient, type NetworkStatus } from "./net/MultiplayerClient";
import type { LobbyCommand, LobbySnapshot, RoomMode, RoomSnapshot } from "@osmosis/shared";
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
  const autoJoinStarted = useRef(false);
  const errorTimer = useRef<number | undefined>(undefined);

  const receiveLobbySnapshot = useCallback((snapshot: LobbySnapshot) => {
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

  useEffect(() => {
    const unsubscribeLobby = network.onLobbySnapshot(receiveLobbySnapshot);
    const unsubscribeStatus = network.onStatus(receiveNetworkStatus);
    const unsubscribeError = network.onCommandError(receiveCommandError);
    const unsubscribeRoom = network.onSnapshot(receiveRoomSnapshot);
    return () => {
      unsubscribeLobby();
      unsubscribeStatus();
      unsubscribeError();
      unsubscribeRoom();
      if (errorTimer.current !== undefined) window.clearTimeout(errorTimer.current);
    };
  }, [network, receiveCommandError, receiveLobbySnapshot, receiveNetworkStatus, receiveRoomSnapshot]);

  useEffect(() => {
    const roomCode = new URLSearchParams(window.location.search).get("room");
    if (!roomCode || autoJoinStarted.current) return;

    const timer = window.setTimeout(() => {
      autoJoinStarted.current = true;
      void network.joinRoom(roomCode, "Crew").catch((joinError: unknown) => {
        setError(joinError instanceof Error ? joinError.message : "Could not join that room.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [network]);

  const createRoom = useCallback(async (nickname: string, roomMode: RoomMode) => {
    setError(undefined);
    try {
      await network.createRoom(nickname, roomMode);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a room.");
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
    setNetworkStatus({ state: "disconnected", connectedPlayerCount: 0 });
    window.history.replaceState(null, "", window.location.pathname);
  }, [network]);

  let screen;
  if (roomSnapshot?.phase === "RESULTS" && roomSnapshot.result) {
    const fallbackHost = lobby?.players.find((player) => player.id === lobby.selfPlayerId)?.isHost ?? false;
    const isHost = roomSnapshot.hostPlayerId ? roomSnapshot.hostPlayerId === roomSnapshot.selfPlayerId : fallbackHost;
    screen = <ResultsScreen result={roomSnapshot.result} isHost={isHost} error={error}
      onRematch={() => network.sendCommand({ type: "rematch" })} onLeave={leaveRoom} />;
  } else if (lobby?.phase === "PLAYING" || roomSnapshot?.phase === "PLAYING") {
    screen = <ArenaCanvas network={network} snapshot={roomSnapshot} error={error} onLeave={() => void leaveRoom()} onNetworkStatus={receiveNetworkStatus} />;
  } else screen = (
    <LobbyScreen
      lobby={lobby}
      networkStatus={networkStatus}
      error={error}
      latestRoomSnapshot={roomSnapshot}
      onCreate={createRoom}
      onJoin={joinRoom}
      onCommand={sendCommand}
      onLeave={leaveRoom}
    />
  );
  return <>{screen}{lobby && networkStatus.state === "connecting" && <div className="connection-banner" role="status">Reconnecting to your crew… your seat is reserved for 120 seconds.</div>}{lobby && <VoiceControls roomCode={lobby.roomCode} voiceCredential={lobby.voiceCredential}
    voiceRoomName={lobby.voiceRoomName} connected={networkStatus.state === "connected"}
    inMatch={roomSnapshot?.phase === "PLAYING"}
    {...(networkStatus.teamId ? { teamId: networkStatus.teamId } : {})} />}</>;
}
