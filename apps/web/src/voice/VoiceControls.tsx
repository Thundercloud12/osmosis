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
type VoiceRetry = { kind: "team" } | { kind: "global"; listen: boolean } | { kind: "microphone" };
type VoiceError = { message: string; retry: VoiceRetry | null };

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
  const [voiceError, setVoiceError] = useState<VoiceError | null>(null);

  const reportError = useCallback((message: string, retry: VoiceRetry | null = null) => {
    setVoiceError({ message, retry });
  }, []);
  const clearError = useCallback(() => setVoiceError(null), []);

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
        let retry: VoiceRetry;
        if (channel === "TEAM") {
          teamOptInRef.current = false;
          setTeamJoined(false);
          setTeamSpeaking(false);
          retry = { kind: "team" };
        } else {
          const shouldListen = globalListenRef.current;
          globalListenRef.current = false;
          setGlobalListen(false);
          setGlobalConnected(false);
          setGlobalSpeaking(false);
          retry = { kind: "global", listen: shouldListen };
        }
        micEnabledRef.current = false;
        setMicEnabled(false);
        reportError(`${channel === "TEAM" ? "Team" : "Global"} voice disconnected. Retry the connection.`, retry);
      },
    });
    session.setDeafened(deafenedRef.current);
    if (channel === "GLOBAL") session.setListening(globalListenRef.current);
    return session;
  }, [reportError]);

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
      clearError();
      return session;
    }).catch((connectError: unknown) => {
      if (sessionsRef.current[channel] === session) delete sessionsRef.current[channel];
      throw connectError;
    }).finally(() => {
      if (pendingRef.current[channel] === request) delete pendingRef.current[channel];
    });
    pendingRef.current[channel] = request;
    return request;
  }, [clearError, createSession, roomCode, voiceCredential]);

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
    const channels: VoiceChannel[] = [];
    if (teamOptInRef.current) channels.push("TEAM");
    if (globalListenRef.current || talkTargetRef.current === "GLOBAL") channels.push("GLOBAL");
    const results = await Promise.allSettled(channels.map((channel) => ensureSession(channel)));
    const failedIndex = results.findIndex((result) => result.status === "rejected");
    if (failedIndex < 0) return;
    const failure = results[failedIndex];
    if (failure?.status !== "rejected") return;
    const channel = channels[failedIndex] ?? "GLOBAL";
    const retry: VoiceRetry = channel === "TEAM"
      ? { kind: "team" }
      : { kind: "global", listen: globalListenRef.current };
    reportError(failure.reason instanceof Error ? failure.reason.message : "Voice could not reconnect.", retry);
  }, [ensureSession, reportError]);

  useEffect(() => {
    const roundChanged = roomNameRef.current !== voiceRoomName;
    roomNameRef.current = voiceRoomName;
    if (!connected || roundChanged) {
      void disconnectAll().then(() => {
        if (!connected) {
          if (teamOptInRef.current || globalListenRef.current || talkTargetRef.current === "GLOBAL") {
            reportError("Voice is paused until the game reconnects.");
          }
          return;
        }
        void restoreOptedInChannels();
      });
    } else {
      void restoreOptedInChannels();
    }
  }, [connected, voiceRoomName, disconnectAll, reportError, restoreOptedInChannels]);

  useEffect(() => () => { void disconnectAll(); }, [disconnectAll]);

  const joinTeamVoice = async () => {
    if (!connected || teamBusy) return;
    teamOptInRef.current = true;
    setTeamBusy(true);
    try {
      await ensureSession("TEAM");
    } catch (joinError) {
      teamOptInRef.current = false;
      reportError(joinError instanceof Error ? joinError.message : "Could not join Team voice.", { kind: "team" });
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
      clearError();
    } catch (listenError) {
      globalListenRef.current = false;
      setGlobalListen(false);
      reportError(listenError instanceof Error ? listenError.message : "Could not connect to Global voice.", enabled ? { kind: "global", listen: true } : null);
    } finally {
      setGlobalBusy(false);
    }
  };

  const selectTalkTarget = async (channel: VoiceChannel) => {
    if (talkTargetRef.current === channel || globalBusy) return;
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
        const session = await ensureSession("GLOBAL");
        session.setListening(globalListenRef.current);
      } else if (channel === "TEAM" && !globalListenRef.current) {
        await disconnectChannel("GLOBAL");
      }
      clearError();
    } catch (targetError) {
      reportError(targetError instanceof Error ? targetError.message : `Could not select ${channel === "TEAM" ? "Team" : "Global"} for your microphone.`,
        channel === "GLOBAL" ? { kind: "global", listen: globalListenRef.current } : null);
    } finally {
      setGlobalBusy(false);
    }
  };

  const setTargetMicEnabled = async (enabled: boolean) => {
    if (!connected || !enabled && !micEnabledRef.current) return;
    const channel = talkTargetRef.current;
    if (channel === "TEAM" && !teamOptInRef.current) {
      reportError("Join Team voice before sending your microphone to your team.");
      return;
    }
    try {
      if (enabled && channel === "GLOBAL") await ensureSession("GLOBAL");
      const otherChannel: VoiceChannel = channel === "TEAM" ? "GLOBAL" : "TEAM";
      await sessionsRef.current[otherChannel]?.setMicrophoneEnabled(false);
      await sessionsRef.current[channel]?.setMicrophoneEnabled(enabled);
      micEnabledRef.current = enabled;
      setMicEnabled(enabled);
      clearError();
    } catch (micError) {
      micEnabledRef.current = false;
      setMicEnabled(false);
      reportError(micError instanceof Error ? micError.message : "Microphone permission was denied.", enabled ? { kind: "microphone" } : null);
    }
  };

  const retryVoice = async () => {
    if (!voiceError?.retry) return;
    const retry = voiceError.retry;
    if (retry.kind === "team") {
      await joinTeamVoice();
      return;
    }
    if (retry.kind === "microphone") {
      await setTargetMicEnabled(true);
      return;
    }

    if (!connected || globalBusy) return;
    globalListenRef.current = retry.listen;
    setGlobalListen(retry.listen);
    setGlobalBusy(true);
    try {
      const session = await ensureSession("GLOBAL");
      session.setListening(retry.listen);
      clearError();
    } catch (retryError) {
      reportError(retryError instanceof Error ? retryError.message : "Could not reconnect to Global voice.", retry);
    } finally {
      setGlobalBusy(false);
    }
  };

  const leaveVoice = async () => {
    teamOptInRef.current = false;
    globalListenRef.current = false;
    talkTargetRef.current = "TEAM";
    setGlobalListen(false);
    setTalkTarget("TEAM");
    await disconnectAll();
    clearError();
  };

  const canTransmit = connected && (talkTarget === "GLOBAL" ? globalConnected : teamJoined);

  useEffect(() => {
    if (!canTransmit) return;
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
      if (event.code !== "KeyV" || event.repeat || editing) return;
      event.preventDefault();
      void setTargetMicEnabled(!micEnabledRef.current);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [canTransmit, setTargetMicEnabled]);

  const toggleDeafened = () => {
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafened(next);
    sessionsRef.current.TEAM?.setDeafened(next);
    sessionsRef.current.GLOBAL?.setDeafened(next);
  };

  const remoteSpeaking = teamSpeaking || (globalListen && globalSpeaking);
  const voiceStatus = remoteSpeaking
    ? "CREWMATE SPEAKING"
    : !connected
      ? "GAME RECONNECTING"
      : teamJoined || globalConnected
        ? "VOICE CONNECTED"
        : "VOICE NOT CONNECTED";

  return <aside className={`voice-dock ${inMatch ? "is-match" : ""} ${teamId === "RED" ? "voice-red" : ""}`} aria-label="Voice controls">
    <header className="voice-dock-header">
      <span className={`voice-dot ${remoteSpeaking ? "is-speaking" : ""}`} aria-hidden="true" />
      <strong>VOICE</strong>
      <span className="voice-overall-status" role="status" aria-live="polite">{voiceStatus}</span>
    </header>

    <section className="voice-control-section" aria-label="Listening channels">
      <h2>LISTEN</h2>
      <div className="voice-listen-actions">
        {teamJoined
          ? <span className="voice-channel-connected"><span>Team voice</span><strong>Joined</strong></span>
          : <button className="voice-channel-button" disabled={!connected || teamBusy} onClick={() => void joinTeamVoice()}>
            {teamBusy ? "Connecting to Team…" : "Join Team voice"}
          </button>}
        <button className="voice-channel-button" disabled={!connected || globalBusy} onClick={() => void setGlobalListening(!globalListen)} aria-pressed={globalListen}>
          <span>Listen to Global</span><strong>{globalBusy ? "Connecting…" : globalListen ? "On" : "Off"}</strong>
        </button>
      </div>
    </section>

    <section className="voice-control-section" aria-label="Microphone controls">
      <h2>MIC SENDS TO</h2>
      <div className="voice-transmit-row">
        <div className="voice-destination" role="group" aria-label="Microphone destination">
          <button className={talkTarget === "TEAM" ? "is-selected" : ""} aria-pressed={talkTarget === "TEAM"} disabled={!connected || globalBusy} onClick={() => void selectTalkTarget("TEAM")}>Team</button>
          <button className={talkTarget === "GLOBAL" ? "is-selected" : ""} aria-pressed={talkTarget === "GLOBAL"} disabled={!connected || globalBusy} onClick={() => void selectTalkTarget("GLOBAL")}>Global</button>
        </div>
        <button className={`voice-mic-button ${micEnabled ? "voice-active" : ""}`} disabled={!canTransmit || teamBusy || globalBusy} onClick={() => void setTargetMicEnabled(!micEnabled)} aria-pressed={micEnabled}>
          {micEnabled ? "Mute microphone" : "Enable microphone"}
        </button>
      </div>
      <p className="voice-mic-hint">
        {!connected
          ? "Reconnect to the game to use voice."
          : talkTarget === "TEAM" && !teamJoined
            ? "Join Team voice above to send your mic to your crew."
            : talkTarget === "GLOBAL" && !globalConnected
              ? "Connecting to Global voice before your mic can send."
              : micEnabled
                ? `Your microphone is live on ${talkTarget === "TEAM" ? "Team" : "Global"}. Press V or the button to mute.`
                : `Your microphone is muted. Enable it to talk on ${talkTarget === "TEAM" ? "Team" : "Global"}. Press V to toggle.`}
      </p>
    </section>

    {(teamJoined || globalConnected) && <div className="voice-utility-actions">
      <button className={`voice-utility-button ${deafened ? "voice-active" : ""}`} onClick={toggleDeafened} aria-pressed={deafened}>
        {deafened ? "Audio deafened" : "Deafen audio"}
      </button>
      <button className="voice-leave" disabled={teamBusy || globalBusy} onClick={() => void leaveVoice()}>Leave voice</button>
    </div>}

    {voiceError && <div className="voice-error" role="alert">
      <p><strong>Voice connection issue</strong><span>{voiceError.message}</span></p>
      {voiceError.retry && <button className="voice-retry" disabled={!connected || teamBusy || globalBusy} onClick={() => void retryVoice()}>Retry</button>}
      <button className="voice-dismiss" aria-label="Dismiss voice error" onClick={clearError}>×</button>
    </div>}
  </aside>;
}
