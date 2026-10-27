import {
  ParticipantEvent,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";

export type VoiceChannel = "TEAM" | "GLOBAL";

type VoiceTokenResponse = {
  serverUrl?: string;
  token?: string;
  error?: string;
};

type Callbacks = {
  onRemoteSpeaking: (speaking: boolean) => void;
  onUnexpectedDisconnect: () => void;
};

export class VoiceChannelSession {
  private room: Room | undefined;
  private listening = true;
  private deafened = false;
  private intentionalDisconnect = false;
  private generation = 0;

  constructor(private readonly channel: VoiceChannel, private readonly callbacks: Callbacks) {}

  get isConnected(): boolean {
    return this.room !== undefined;
  }

  async connect(gameServerUrl: string, roomCode: string, credential: string): Promise<void> {
    if (this.room) return;
    const generation = ++this.generation;
    const response = await fetch(`${gameServerUrl.replace(/\/$/, "")}/voice/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode, credential, channel: this.channel }),
    });
    const data = await response.json() as VoiceTokenResponse;
    if (generation !== this.generation) return;
    if (!response.ok || !data.serverUrl || !data.token) {
      throw new Error(data.error || "Voice service is unavailable.");
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    this.intentionalDisconnect = false;
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      this.callbacks.onRemoteSpeaking(speakers.some((speaker) => speaker.identity !== room.localParticipant.identity));
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => this.watchParticipant(participant));
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.autoplay = true;
      element.dataset.voiceIdentity = participant.identity;
      element.dataset.voiceChannel = this.channel;
      element.muted = this.deafened;
      document.body.append(element);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) this.room = undefined;
      this.removeAudioElements();
      this.callbacks.onRemoteSpeaking(false);
      if (!this.intentionalDisconnect) this.callbacks.onUnexpectedDisconnect();
    });

    try {
      await room.connect(data.serverUrl, data.token, { autoSubscribe: this.channel === "TEAM" });
      if (generation !== this.generation) {
        this.intentionalDisconnect = true;
        await room.disconnect();
        return;
      }
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(false);
      if (this.channel === "GLOBAL") {
        for (const participant of room.remoteParticipants.values()) this.watchParticipant(participant);
      }
    } catch (error) {
      if (this.room === room) this.room = undefined;
      this.intentionalDisconnect = true;
      await room.disconnect().catch(() => undefined);
      this.removeAudioElements();
      throw error;
    }
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.room) throw new Error("Join this voice channel before turning on the microphone.");
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  setListening(enabled: boolean): void {
    if (this.channel !== "GLOBAL") return;
    this.listening = enabled;
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of participant.trackPublications.values()) this.setPublicationListening(publication);
    }
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    document.querySelectorAll<HTMLAudioElement>(`audio[data-voice-channel="${this.channel}"]`)
      .forEach((audio) => { audio.muted = deafened; });
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    const room = this.room;
    this.room = undefined;
    this.intentionalDisconnect = true;
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect();
    }
    this.removeAudioElements();
    this.callbacks.onRemoteSpeaking(false);
  }

  private watchParticipant(participant: RemoteParticipant): void {
    if (this.channel !== "GLOBAL") return;
    participant.on(ParticipantEvent.TrackPublished, (publication) => this.setPublicationListening(publication));
    for (const publication of participant.trackPublications.values()) this.setPublicationListening(publication);
  }

  private setPublicationListening(publication: RemoteTrackPublication): void {
    if (publication.kind === Track.Kind.Audio) publication.setSubscribed(this.listening);
  }

  private removeAudioElements(): void {
    document.querySelectorAll<HTMLAudioElement>(`audio[data-voice-channel="${this.channel}"]`)
      .forEach((audio) => audio.remove());
  }
}
