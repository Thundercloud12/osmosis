import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceChannelSession, type VoiceChannel } from "./VoiceChannelSession";

type Props = {
  roomCode: string;
  voiceCredential: string;
  voiceRoomName: string;
  connected: boolean;
  inMatch?: boolean;
  teamId?: "BLUE" | "RED";
};

type Sessions = Partial<Record<VoiceChannel, VoiceChannelSession>>;

export function VoiceControls({ roomCode, voiceCredential, voiceRoomName, connected, inMatch = false, teamId }: Props) {
  const sessionsRef = useRef<Sessions>({});
  const pendingRef = useRef<Partial<Record<VoiceChannel, Promise<VoiceChannelSession>>>>({});
  const teamOptInRef = useRef(false);
  const globalListenRef = useRef(false);
  const talkTargetRef = useRef<VoiceChannel>("TEAM");
  const micEnabledRef = useRef(false);
  const deafenedRef = useRef(false);
  const roomNameRef = useRef(voiceRoomName);
  const [teamJoined, setTeamJoined] = useState(false);
  const [globalConnected, setGlobalConnected] = useState(false);
  const [globalListen, setGlobalListen] = useState(false);
  const [talkTarget, setTalkTarget] = useState<VoiceChannel>("TEAM");
  const [micEnabled, setMicEnabled] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [teamSpeaking, setTeamSpeaking] = useState(false);
  const [globalSpeaking, setGlobalSpeaking] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [error, setError] = useState("");

  const createSession = useCallback((channel: VoiceChannel) => {
    let session: VoiceChannelSession;
    session = new VoiceChannelSession(channel, {
      onRemoteSpeaking: (speaking) => {
        if (channel === "TEAM") setTeamSpeaking(speaking);
        else setGlobalSpeaking(speaking);
      },
      onUnexpectedDisconnect: () => {
        if (sessionsRef.current[channel] !== session) return;
        delete sessionsRef.current[channel];
        if (channel === "TEAM") {
          teamOptInRef.current = false;
          setTeamJoined(false);
          setTeamSpeaking(false);
        } else {
          globalListenRef.current = false;
          setGlobalListen(false);
          setGlobalConnected(false);
          setGlobalSpeaking(false);
          if (talkTargetRef.current === "GLOBAL") {
            talkTargetRef.current = "TEAM";
            setTalkTarget("TEAM");
          }
        }
        micEnabledRef.current = false;
        setMicEnabled(false);
        setError(`${channel === "TEAM" ? "Team" : "Global"} voice disconnected. Rejoin to continue.`);
      },
    });
    session.setDeafened(deafenedRef.current);
    if (channel === "GLOBAL") session.setListening(globalListenRef.current);
    return session;
  }, []);

  const ensureSession = useCallback(async (channel: VoiceChannel): Promise<VoiceChannelSession> => {
    const current = sessionsRef.current[channel];
    if (current?.isConnected) return current;
    const pending = pendingRef.current[channel];
    if (pending) return pending;

    const session = current ?? createSession(channel);
    sessionsRef.current[channel] = session;
    const request = session.connect(
      import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567",
      roomCode,
      voiceCredential,
    ).then(() => {
      if (!session.isConnected || sessionsRef.current[channel] !== session) {
        throw new Error("Voice connection was cancelled.");
      }
      session.setDeafened(deafenedRef.current);
      if (channel === "TEAM") setTeamJoined(true);
      else {
        session.setListening(globalListenRef.current);
        setGlobalConnected(true);
      }
      setError("");
      return session;
    }).catch((connectError: unknown) => {
      if (sessionsRef.current[channel] === session) delete sessionsRef.current[channel];
      throw connectError;
    }).finally(() => {
      if (pendingRef.current[channel] === request) delete pendingRef.current[channel];
    });
    pendingRef.current[channel] = request;
    return request;
  }, [createSession, roomCode, voiceCredential]);

  const disconnectChannel = useCallback(async (channel: VoiceChannel) => {
    const session = sessionsRef.current[channel];
    delete sessionsRef.current[channel];
    await session?.disconnect();
    if (channel === "TEAM") {
      setTeamJoined(false);
      setTeamSpeaking(false);
    } else {
      setGlobalConnected(false);
      setGlobalSpeaking(false);
    }
  }, []);

  const disconnectAll = useCallback(async () => {
    const pending = Object.values(pendingRef.current).filter((request): request is Promise<VoiceChannelSession> => request !== undefined);
    await Promise.all([disconnectChannel("TEAM"), disconnectChannel("GLOBAL")]);
    await Promise.allSettled(pending);
    micEnabledRef.current = false;
    setMicEnabled(false);
  }, [disconnectChannel]);

  const restoreOptedInChannels = useCallback(async () => {
    const restore: Promise<VoiceChannelSession>[] = [];
    if (teamOptInRef.current) restore.push(ensureSession("TEAM"));
    if (globalListenRef.current || talkTargetRef.current === "GLOBAL") restore.push(ensureSession("GLOBAL"));
    const results = await Promise.allSettled(restore);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) setError(failure.reason instanceof Error ? failure.reason.message : "Voice could not reconnect.");
  }, [ensureSession]);

  useEffect(() => {
    const roundChanged = roomNameRef.current !== voiceRoomName;
    roomNameRef.current = voiceRoomName;
    if (!connected || roundChanged) {
      void disconnectAll().then(() => {
        if (!connected) {
          setError("Voice paused while reconnecting to the game.");
          return;
        }
        void restoreOptedInChannels();
      });
    } else {
      void restoreOptedInChannels();
    }
  }, [connected, voiceRoomName, disconnectAll, restoreOptedInChannels]);

  useEffect(() => () => { void disconnectAll(); }, [disconnectAll]);

  const joinTeamVoice = async () => {
    if (!connected || teamBusy) return;
    teamOptInRef.current = true;
    setTeamBusy(true);
    try {
      await ensureSession("TEAM");
    } catch (joinError) {
      teamOptInRef.current = false;
      setError(joinError instanceof Error ? joinError.message : "Could not join team voice.");
    } finally {
      setTeamBusy(false);
    }
  };

  const setGlobalListening = async (enabled: boolean) => {
    if (!connected || globalBusy) return;
    globalListenRef.current = enabled;
    setGlobalListen(enabled);
    setGlobalBusy(true);
    try {
      if (enabled) {
        const session = await ensureSession("GLOBAL");
        session.setListening(true);
      } else {
        sessionsRef.current.GLOBAL?.setListening(false);
        if (talkTargetRef.current !== "GLOBAL") await disconnectChannel("GLOBAL");
      }
      setError("");
    } catch (listenError) {
      globalListenRef.current = false;
      setGlobalListen(false);
      setError(listenError instanceof Error ? listenError.message : "Could not join Global voice.");
    } finally {
      setGlobalBusy(false);
    }
  };

  const selectTalkTarget = async (channel: VoiceChannel) => {
    if (talkTargetRef.current === channel) return;
    const previous = talkTargetRef.current;
    const previousSession = sessionsRef.current[previous];
    try {
      await previousSession?.setMicrophoneEnabled(false);
      micEnabledRef.current = false;
      setMicEnabled(false);
      talkTargetRef.current = channel;
      setTalkTarget(channel);
      if (channel === "GLOBAL" && connected) {
        setGlobalBusy(true);
        await ensureSession("GLOBAL");
        sessionsRef.current.GLOBAL?.setListening(globalListenRef.current);
      } else if (channel === "TEAM" && !globalListenRef.current) {
        await disconnectChannel("GLOBAL");
      }
      setError("");
    } catch (targetError) {
      talkTargetRef.current = previous;
      setTalkTarget(previous);
      setError(targetError instanceof Error ? targetError.message : "Could not switch voice channel.");
    } finally {
      setGlobalBusy(false);
    }
  };

  const setTargetMicEnabled = async (enabled: boolean) => {
    if (!connected || !enabled && !micEnabledRef.current) return;
    const channel = talkTargetRef.current;
    if (channel === "TEAM" && !teamOptInRef.current) {
      setError("Join Team voice before transmitting to your team.");
      return;
    }
    try {
      if (enabled && channel === "GLOBAL") await ensureSession("GLOBAL");
      const otherChannel: VoiceChannel = channel === "TEAM" ? "GLOBAL" : "TEAM";
      await sessionsRef.current[otherChannel]?.setMicrophoneEnabled(false);
      await sessionsRef.current[channel]?.setMicrophoneEnabled(enabled);
      micEnabledRef.current = enabled;
      setMicEnabled(enabled);
      setError("");
    } catch (micError) {
      micEnabledRef.current = false;
      setMicEnabled(false);
      setError(micError instanceof Error ? micError.message : "Microphone permission was denied.");
    }
  };

  const leaveVoice = async () => {
    teamOptInRef.current = false;
    globalListenRef.current = false;
    talkTargetRef.current = "TEAM";
    setGlobalListen(false);
    setTalkTarget("TEAM");
    await disconnectAll();
    setError("");
  };

  useEffect(() => {
    if (!teamJoined && !globalConnected) return;
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
      if (event.code !== "KeyV" || event.repeat || editing) return;
      event.preventDefault();
      void setTargetMicEnabled(!micEnabledRef.current);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [teamJoined, globalConnected]);

  const toggleDeafened = () => {
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafened(next);
    sessionsRef.current.TEAM?.setDeafened(next);
    sessionsRef.current.GLOBAL?.setDeafened(next);
  };

  const canTransmit = talkTarget === "GLOBAL" ? globalConnected : teamJoined;
  const remoteSpeaking = teamSpeaking || (globalListen && globalSpeaking);

  return <aside className={`voice-dock ${inMatch ? "is-match" : ""} ${teamId === "RED" ? "voice-red" : ""}`} aria-label="Voice channels">
    <span className={`voice-dot ${remoteSpeaking ? "is-speaking" : ""}`} />
    <span className="voice-label">{remoteSpeaking ? "CREWMATE TALKING" : "VOICE"}</span>
    {!teamJoined
      ? <button disabled={teamBusy || !connected} onClick={() => void joinTeamVoice()}>{teamBusy ? "CONNECTING…" : "JOIN TEAM"}</button>
      : <span className="voice-channel-status">TEAM READY</span>}
    <button disabled={globalBusy || !connected} onClick={() => void setGlobalListening(!globalListen)} aria-pressed={globalListen}>
      {globalBusy ? "CONNECTING…" : globalListen ? "GLOBAL ON" : "GLOBAL OFF"}
    </button>
    <button disabled={globalBusy || !connected} onClick={() => void selectTalkTarget(talkTarget === "TEAM" ? "GLOBAL" : "TEAM")} aria-pressed={talkTarget === "GLOBAL"}>
      TALK: {talkTarget}
    </button>
    {canTransmit && <button className={micEnabled ? "voice-active" : ""} onClick={() => void setTargetMicEnabled(!micEnabled)} title={`Toggle ${talkTarget.toLowerCase()} microphone`} aria-pressed={micEnabled}>
      {micEnabled ? "MIC ON" : "MIC OFF"}
    </button>}
    {(teamJoined || globalConnected) && <>
      <button className={deafened ? "voice-active" : ""} onClick={toggleDeafened} aria-pressed={deafened}>{deafened ? "DEAFENED" : "DEAFEN"}</button>
      <button className="voice-leave" disabled={teamBusy || globalBusy} onClick={() => void leaveVoice()}>LEAVE</button>
    </>}
    {(teamJoined || globalConnected) && <small>V toggles {talkTarget.toLowerCase()} mic</small>}
    {error && <small className="voice-error" title={error}>VOICE ISSUE</small>}
  </aside>;
}
