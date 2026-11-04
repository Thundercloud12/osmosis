import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceChannelSession, type VoiceChannel } from "./VoiceChannelSession";
import { readVoicePanelCollapsed, writeVoicePanelCollapsed } from "./voicePanelPreference";

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

function getInitialCollapsedState(): boolean {
  if (typeof window === "undefined") return false;
  const narrowViewport = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
  try {
    return readVoicePanelCollapsed(window.localStorage, narrowViewport);
  } catch {
    return narrowViewport;
  }
}

function describeMicrophoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow microphone access in this site’s browser permissions, then retry.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Connect a microphone and try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your microphone is busy in another app. Close that app and try again.";
  }
  return error instanceof Error ? error.message : "Could not access your microphone. Check browser permissions and try again.";
}

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
  const [collapsed, setCollapsed] = useState(getInitialCollapsedState);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      writeVoicePanelCollapsed(window.localStorage, next);
    } catch {
      writeVoicePanelCollapsed(undefined, next);
    }
  };

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
      reportError(describeMicrophoneError(micError), enabled ? { kind: "microphone" } : null);
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
  const microphoneUnavailable = voiceError?.retry?.kind === "microphone";
  const voiceConnecting = (teamBusy && !teamJoined) || (globalBusy && !globalConnected);
  const voiceStatus = !connected
    ? "GAME RECONNECTING"
    : microphoneUnavailable
      ? "MICROPHONE UNAVAILABLE"
      : voiceConnecting
        ? "CONNECTING TO VOICE"
        : remoteSpeaking
          ? "CREWMATE SPEAKING"
          : teamJoined || globalConnected
            ? "VOICE CONNECTED"
            : "VOICE NOT CONNECTED";
  const listeningSummary = teamJoined && globalListen
    ? "Team + Global"
    : teamJoined
      ? "Team voice"
      : globalListen
        ? "Global voice"
        : globalConnected && talkTarget === "GLOBAL"
          ? "Mic → Global"
          : "Voice Chat";
  const hasVoiceSession = teamJoined || globalConnected;
  const voiceStateClass = !connected ? "is-reconnecting" : microphoneUnavailable ? "has-error" : voiceConnecting ? "is-connecting" : hasVoiceSession ? "is-connected" : "is-disconnected";

  return <aside className={`voice-dock ${inMatch ? "is-match" : ""} ${teamId === "RED" ? "voice-red" : ""} ${collapsed ? "is-collapsed" : ""}`} aria-label="Voice controls">
    {collapsed ? <div className="voice-collapsed-content">
      <svg className="voice-headphones-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></svg>
      <span className="voice-collapsed-copy"><strong>{listeningSummary}</strong><small><i className={`voice-dot ${voiceStateClass} ${remoteSpeaking ? "is-speaking" : ""}`} aria-hidden="true" />{voiceStatus}</small></span>
      <span className={`voice-mic-indicator ${micEnabled ? "is-live" : "is-muted"}`} aria-label={micEnabled ? "Microphone on" : "Microphone muted"}>{micEnabled ? "MIC ON" : "MIC OFF"}</span>
      <button className="voice-expand-button" onClick={toggleCollapsed} aria-label="Expand voice controls" aria-expanded="false">⌃</button>
    </div> : <>
      <header className="voice-dock-header">
        <span className={`voice-dot ${voiceStateClass} ${remoteSpeaking ? "is-speaking" : ""}`} aria-hidden="true" />
        <strong>VOICE</strong>
        <span className="voice-overall-status" role="status" aria-live="polite">{voiceStatus}</span>
        <button className="voice-collapse-button" onClick={toggleCollapsed} aria-label="Collapse voice controls" aria-expanded="true">⌄</button>
      </header>

      <section className="voice-primary-section" aria-label="Voice actions">
        <div className="voice-listening-summary"><span>LISTENING</span><strong>{listeningSummary}</strong>{remoteSpeaking && <small className="speaking-label">Crewmate speaking</small>}</div>
        <div className="voice-primary-actions">
          {!teamJoined && <button className="voice-join-button" disabled={!connected || teamBusy} onClick={() => void joinTeamVoice()}>
            {teamBusy ? "Connecting…" : "Join Team voice"}
          </button>}
          {canTransmit && <button className={`voice-mic-button ${micEnabled ? "voice-active" : ""}`} disabled={teamBusy || globalBusy || microphoneUnavailable} onClick={() => void setTargetMicEnabled(!micEnabled)} aria-pressed={micEnabled}>
            {micEnabled ? "Mute microphone" : "Turn mic on"}
          </button>}
          {hasVoiceSession && <>
            <button className={`voice-utility-button ${deafened ? "voice-active" : ""}`} onClick={toggleDeafened} aria-pressed={deafened} aria-label={deafened ? "Undeafen audio" : "Deafen audio"}>{deafened ? "Undeafen" : "Deafen"}</button>
            <button className="voice-leave" disabled={teamBusy || globalBusy} onClick={() => void leaveVoice()}>Leave voice</button>
          </>}
        </div>
        <p className="voice-mic-hint" role="status" aria-live="polite">
          {!connected ? "Reconnect to the game to use voice."
            : microphoneUnavailable ? "Microphone access needs attention. Check the message below and retry."
              : micEnabled ? `Your microphone is live on ${talkTarget === "TEAM" ? "Team" : "Global"}. Press V to mute.`
                : canTransmit ? `Your microphone is muted. Turn it on to talk on ${talkTarget === "TEAM" ? "Team" : "Global"}.`
                  : "Join Team voice to hear and talk with your crew."}
        </p>
      </section>

      <details className="voice-advanced-settings">
        <summary>Channel options</summary>
        <div className="voice-advanced-content">
          <div className="voice-channel-settings">
            <span>Global voice</span>
            <button className="voice-global-toggle" disabled={!connected || globalBusy} onClick={() => void setGlobalListening(!globalListen)} aria-pressed={globalListen}>
              {globalBusy ? "Connecting…" : globalListen ? "Listening" : "Listen to Global"}
            </button>
          </div>
          <div className="voice-channel-settings">
            <span>Microphone sends to</span>
            <div className="voice-destination" role="group" aria-label="Microphone destination">
              <button className={talkTarget === "TEAM" ? "is-selected" : ""} aria-pressed={talkTarget === "TEAM"} disabled={!connected || globalBusy} onClick={() => void selectTalkTarget("TEAM")}>Team</button>
              <button className={talkTarget === "GLOBAL" ? "is-selected" : ""} aria-pressed={talkTarget === "GLOBAL"} disabled={!connected || globalBusy} onClick={() => void selectTalkTarget("GLOBAL")}>Global</button>
            </div>
          </div>
          <p className="voice-mic-hint">Only one channel receives your microphone at a time.</p>
        </div>
      </details>

      {voiceError && <div className="voice-error" role="alert">
        <p><strong>{microphoneUnavailable ? "Microphone unavailable" : "Voice connection issue"}</strong><span>{voiceError.message}</span></p>
        {voiceError.retry && <button className="voice-retry" disabled={!connected || teamBusy || globalBusy} onClick={() => void retryVoice()}>Retry</button>}
        <button className="voice-dismiss" aria-label="Dismiss voice error" onClick={clearError}>×</button>
      </div>}
    </>}
  </aside>;
}
