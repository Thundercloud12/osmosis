import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

type Props = { roomCode: string; voiceCredential: string; voiceRoomName: string; connected: boolean; teamId?: "BLUE" | "RED" };

export function VoiceControls({ roomCode, voiceCredential, voiceRoomName, connected, teamId }: Props) {
  const roomRef = useRef<Room | undefined>(undefined);
  const voiceOptIn = useRef(false);
  const joining = useRef(false);
  const activeVoiceRoomName = useRef(voiceRoomName);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room) await room.disconnect();
    setJoined(false);
    setSpeaking(false);
  }, []);

  useEffect(() => () => { void disconnect(); }, [disconnect]);
  useEffect(() => {
    if (!connected && roomRef.current) {
      void disconnect();
      setError("Voice paused while reconnecting to the game.");
    }
  }, [connected, disconnect]);

  const joinVoice = useCallback(async () => {
    if (joining.current || roomRef.current || !connected) return;
    joining.current = true;
    setBusy(true); setError("");
    try {
      const baseUrl = (import.meta.env.VITE_GAME_SERVER_URL || "http://localhost:2567").replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/voice/token`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode, credential: voiceCredential }),
      });
      const data = await response.json() as { serverUrl?: string; token?: string; error?: string };
      if (!response.ok || !data.serverUrl || !data.token) throw new Error(data.error || "Voice service is unavailable.");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setSpeaking(speakers.some((speaker) => speaker.identity !== room.localParticipant.identity)));
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.dataset.voiceIdentity = participant.identity;
        document.body.append(element);
        element.muted = deafened;
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = undefined; setJoined(false); setSpeaking(false);
        document.querySelectorAll<HTMLAudioElement>("audio[data-voice-identity]").forEach((audio) => audio.remove());
      });
      roomRef.current = room;
      await room.connect(data.serverUrl, data.token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(false);
      setMuted(false); setJoined(true);
    } catch (joinError) {
      await disconnect();
      setError(joinError instanceof Error ? joinError.message : "Could not join team voice.");
    } finally { joining.current = false; setBusy(false); }
  }, [connected, disconnect, roomCode, voiceCredential, deafened]);

  useEffect(() => {
    if (activeVoiceRoomName.current === voiceRoomName) return;
    activeVoiceRoomName.current = voiceRoomName;
    if (!roomRef.current) return;
    void disconnect().then(() => {
      if (voiceOptIn.current && connected) void joinVoice();
    });
  }, [voiceRoomName, connected, disconnect, joinVoice]);

  useEffect(() => {
    if (!voiceOptIn.current || !connected || roomRef.current || joining.current) return;
    void joinVoice();
  }, [connected, voiceRoomName, joinVoice]);

  const setMic = async (enabled: boolean) => {
    if (muted && enabled) return;
    try { await roomRef.current?.localParticipant.setMicrophoneEnabled(enabled); }
    catch (micError) { setError(micError instanceof Error ? micError.message : "Microphone permission was denied."); }
  };

  const toggleMute = async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (nextMuted) await setMic(false);
  };

  useEffect(() => {
    if (!joined) return;
    const down = (event: KeyboardEvent) => { if (event.code === "KeyV" && !event.repeat && !(event.target instanceof HTMLInputElement)) void setMic(true); };
    const up = (event: KeyboardEvent) => { if (event.code === "KeyV") void setMic(false); };
    const blur = () => void setMic(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [joined, muted]);

  useEffect(() => {
    document.querySelectorAll<HTMLAudioElement>("audio[data-voice-identity]").forEach((audio) => { audio.muted = deafened; });
  }, [deafened]);

  return <aside className={`voice-dock ${teamId === "RED" ? "voice-red" : ""}`} aria-label="Team voice">
    <span className={`voice-dot ${speaking ? "is-speaking" : ""}`} />
    <span className="voice-label">{joined ? (speaking ? "CREWMATE TALKING" : "TEAM VOICE") : "VOICE"}</span>
    {!joined ? <button disabled={busy || !connected} onClick={() => { voiceOptIn.current = true; void joinVoice(); }}>{busy ? "CONNECTING…" : "JOIN"}</button> : <>
      <button onClick={() => void toggleMute()} title="Manual microphone mute">{muted ? "MIC MUTED" : "MIC READY"}</button>
      <button className={deafened ? "voice-active" : ""} onClick={() => setDeafened(!deafened)}>{deafened ? "DEAFENED" : "DEAFEN"}</button>
      <button className="voice-leave" onClick={() => { voiceOptIn.current = false; void disconnect(); }}>LEAVE</button>
    </>}
    {joined && <small>Hold V to talk</small>}
    {error && <small className="voice-error" title={error}>VOICE UNAVAILABLE</small>}
  </aside>;
}
