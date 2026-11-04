import { useState } from "react";

import type { MatchmakingCommand, MatchmakingSnapshot } from "@osmosis/shared";

interface MatchmakingScreenProps {
  snapshot: MatchmakingSnapshot | null;
  error: string | undefined;
  onCommand: (command: MatchmakingCommand) => void;
  onLeave: () => void;
}

export function MatchmakingScreen({ snapshot, error, onCommand, onLeave }: MatchmakingScreenProps) {
  const [copied, setCopied] = useState(false);
  const party = snapshot?.party;
  const queue = snapshot?.queue;
  const isLeader = Boolean(party && party.leaderId === snapshot?.selfPlayerId);
  const partyOnlineCount = party?.members.filter((member) => member.connected).length ?? 0;
  const partyReconnectingCount = (party?.members.length ?? 0) - partyOnlineCount;

  async function copyInvite(): Promise<void> {
    if (!party) return;
    const invite = new URL(window.location.href);
    invite.searchParams.delete("room");
    invite.searchParams.set("party", party.code);
    await navigator.clipboard.writeText(invite.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return <main className="lobby-shell">
    <header className="lobby-header">
      <a className="lobby-brand" href="/" onClick={(event) => { event.preventDefault(); onLeave(); }}>
        <span className="brand-planet">✦</span><span>OSMOSIS</span><small>CREW UP!</small>
      </a>
      <button className="quiet-button" onClick={onLeave}>LEAVE QUICK PLAY</button>
    </header>

    <section className="matchmaking-layout">
      <div className="room-heading"><div><p className="mini-label">QUICK PLAY AIRLOCK</p><h1>{queue ? "Finding your " : party ? "Gather your " : "Ready to "}<span>{queue ? "match." : party ? "crew." : "crew up?"}</span></h1></div></div>

      {!snapshot ? <section className="welcome-card matchmaking-loading"><div className="card-tab">CONNECTING TO QUICK PLAY</div><p className="connecting-note">Finding your airlock…</p></section> : <>
        {party && <>
          <div className="invite-strip"><span>YOUR CREW INVITE CODE</span><strong>{party.code}</strong><button className="copy-button" onClick={() => void copyInvite()}>{copied ? "COPIED! ✓" : "COPY INVITE ↗"}</button><span className="player-count">{party.members.length}/{party.settings.teamSize} CREW</span></div>
          <section className="matchmaking-party-card">
            <header className="team-card-heading"><span className="team-emblem"><img src="/assets/characters/astronaut.png" alt="" /></span><div><p>THESE CREWMATES STAY TOGETHER</p><h2>Queue as one crew</h2></div><strong>{party.members.length}/{party.settings.teamSize}</strong></header>
            <div className="team-presence-summary" role="group" aria-label={`${partyOnlineCount} of ${party.settings.teamSize} party players online${partyReconnectingCount ? `, ${partyReconnectingCount} reconnecting` : ""}`}>
              <span className="presence-online"><i aria-hidden="true" />{partyOnlineCount}/{party.settings.teamSize} online</span>
              {partyReconnectingCount > 0 && <span className="presence-reconnecting"><i aria-hidden="true" />{partyReconnectingCount} reconnecting</span>}
            </div>
            <div className="roster-list">{Array.from({ length: party.settings.teamSize }, (_, index) => {
              const member = party.members[index];
              return <div className={`roster-slot ${member ? "occupied" : "empty"}`} key={member?.id ?? `empty-${index}`}>
                <span className="crew-avatar">{member ? <img src="/assets/characters/astronaut.png" alt="" /> : "+"}</span>
                <span className="crew-name">{member?.nickname ?? "Open for a crewmate"}</span>
                {member?.id === party.leaderId && <small className="role-badge host-badge">LEADER</small>}
                {member && !member.connected && <small className="offline-badge">RECONNECTING</small>}
                {member?.connected && <small className="online-badge">ONLINE</small>}
              </div>;
            })}</div>
            <div className="matchmaking-fixed-settings"><span>QUICK PLAY</span><strong>{party.settings.teamSize}v{party.settings.teamSize} · {party.settings.matchDurationSeconds / 60} MINUTES</strong></div>
            <p className="matchmaking-party-note">Your party stays together. We assign the oldest eligible crews and players first.</p>
            {isLeader && !queue && <button className="play-button compact-button" disabled={party.members.some((member) => !member.connected)} onClick={() => onCommand({ type: "queueParty" })}>QUEUE WITH MY CREW <span>→</span></button>}
            {!isLeader && !queue && <p className="requirement-note">The crew leader will start Quick Play.</p>}
          </section>
        </>}

        {queue && <section className="welcome-card queue-status-card">
          <div className="card-tab">{queue.status === "MATCH_FOUND" ? "MATCH FOUND · ENTERING AIRLOCK" : party ? "YOUR CREW IS IN THE QUEUE" : "YOU’RE IN THE QUEUE"}</div>
          {queue.status === "SEARCHING" ? <>
            {queue.isPaused ? <div className="queue-paused-note">SEARCH PAUSED WHILE A CREWMATE RECONNECTS</div> : <div className="queue-progress"><strong>{queue.estimatedPlayersWaiting}</strong><span>players waiting in Quick Play</span></div>}
            <p>{queue.isPaused ? "Your crew is held together for up to 120 seconds." : queue.playersNeeded > 0 ? `Waiting for ${queue.playersNeeded} more player${queue.playersNeeded === 1 ? "" : "s"} to fill the next match.` : "Enough players are queued. Arranging complete teams now."}</p>
            {!queue.isPaused && <p>Shared queue · {queue.settings.teamSize}v{queue.settings.teamSize} · {queue.settings.matchDurationSeconds / 60} minutes</p>}
            <p className="queue-wait">Waiting {Math.floor(queue.waitSeconds / 60)}:{String(queue.waitSeconds % 60).padStart(2, "0")}</p>
            <p className="matchmaking-party-note">Your crew stays together while the oldest eligible players are placed into complete teams.</p>
          </> : <p className="matchmaking-party-note">Your team assignments are reserved. Connecting everyone to the existing lobby…</p>}
          <button className="quiet-button queue-cancel-button" onClick={() => onCommand({ type: "cancelQueue" })}>CANCEL SEARCH</button>
        </section>}

        {!party && !queue && <section className="welcome-card matchmaking-loading">
          <div className="card-tab">QUICK PLAY CLOSED</div>
          <p>You’re no longer in a crew or queue.</p>
          <button className="quiet-button" onClick={onLeave}>BACK TO HOME</button>
        </section>}
      </>}
      {error && <p className="lobby-error matchmaking-error" role="alert">{error}</p>}
      <footer className="lobby-footer"><span className="online-dot" /> SERVER CONNECTED <span>·</span> QUICK PLAY</footer>
    </section>
  </main>;
}
