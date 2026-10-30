import { useState } from "react";

import type { MatchmakingCommand, MatchmakingSnapshot, QuickPlaySettings } from "@osmosis/shared";

interface MatchmakingScreenProps {
  snapshot: MatchmakingSnapshot | null;
  error: string | undefined;
  onCommand: (command: MatchmakingCommand) => void;
  onLeave: () => void;
}

const durations = [300, 600, 900, 1_200] as const;

export function MatchmakingScreen({ snapshot, error, onCommand, onLeave }: MatchmakingScreenProps) {
  const [copied, setCopied] = useState(false);
  const party = snapshot?.party;
  const queue = snapshot?.queue;
  const isLeader = Boolean(party && party.leaderId === snapshot?.selfPlayerId);

  async function copyInvite(): Promise<void> {
    if (!party) return;
    const invite = new URL(window.location.href);
    invite.searchParams.delete("room");
    invite.searchParams.set("party", party.code);
    await navigator.clipboard.writeText(invite.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  function updateSettings(change: Partial<QuickPlaySettings>): void {
    if (!party) return;
    onCommand({ type: "updatePartySettings", settings: { ...party.settings, ...change } });
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
            <header className="team-card-heading"><span className="team-emblem"><img src="/assets/characters/astronaut.png" alt="" /></span><div><p>THESE CREWMATES STAY TOGETHER</p><h2>Open spots fill with players in Quick Play</h2></div><strong>{party.members.length}/{party.settings.teamSize}</strong></header>
            <div className="roster-list">{Array.from({ length: party.settings.teamSize }, (_, index) => {
              const member = party.members[index];
              return <div className={`roster-slot ${member ? "occupied" : "empty"}`} key={member?.id ?? `empty-${index}`}>
                <span className="crew-avatar">{member ? <img src="/assets/characters/astronaut.png" alt="" /> : "+"}</span>
                <span className="crew-name">{member?.nickname ?? "Open for a crewmate"}</span>
                {member?.id === party.leaderId && <small className="role-badge host-badge">LEADER</small>}
                {member && !member.connected && <small className="offline-badge">RECONNECTING</small>}
              </div>;
            })}</div>
            <div className="matchmaking-settings">
              <label className="field-label" htmlFor="party-size">TEAM SIZE</label>
              <select id="party-size" className="lobby-input" value={party.settings.teamSize} disabled={!isLeader || Boolean(queue)} onChange={(event) => updateSettings({ teamSize: Number(event.target.value) as 4 | 5 })}>
                <option value={4}>4 versus 4</option><option value={5}>5 versus 5</option>
              </select>
              <label className="field-label" htmlFor="party-duration">MATCH LENGTH</label>
              <select id="party-duration" className="lobby-input" value={party.settings.matchDurationSeconds} disabled={!isLeader || Boolean(queue)} onChange={(event) => updateSettings({ matchDurationSeconds: Number(event.target.value) as QuickPlaySettings["matchDurationSeconds"] })}>
                {durations.map((seconds) => <option value={seconds} key={seconds}>{seconds / 60} minutes</option>)}
              </select>
            </div>
            <p className="matchmaking-party-note">Quick Play pairs compatible teams and match lengths. Your party will never be split.</p>
            {isLeader && !queue && <button className="play-button compact-button" disabled={party.members.some((member) => !member.connected)} onClick={() => onCommand({ type: "queueParty" })}>QUEUE WITH MY CREW <span>→</span></button>}
            {!isLeader && !queue && <p className="requirement-note">The crew leader will start Quick Play.</p>}
          </section>
        </>}

        {queue && <section className="welcome-card queue-status-card">
          <div className="card-tab">{queue.status === "MATCH_FOUND" ? "MATCH FOUND · ENTERING AIRLOCK" : party ? "YOUR CREW IS IN THE QUEUE" : "YOU’RE IN THE QUEUE"}</div>
          {queue.status === "SEARCHING" ? <>
            {queue.isPaused ? <div className="queue-paused-note">SEARCH PAUSED WHILE A CREWMATE RECONNECTS</div> : <div className="queue-progress"><strong>{Math.max(0, queue.settings.teamSize * 2 - queue.playersNeeded)}/{queue.settings.teamSize * 2}</strong><span>players found for a compatible match</span></div>}
            <p>{queue.isPaused ? "Your crew is held together for up to 120 seconds." : `Searching for ${queue.settings.teamSize}v${queue.settings.teamSize} · ${queue.settings.matchDurationSeconds / 60} minutes`}</p>
            <p className="queue-wait">Waiting {Math.floor(queue.waitSeconds / 60)}:{String(queue.waitSeconds % 60).padStart(2, "0")}</p>
            <p className="matchmaking-party-note">The match begins when two complete teams are ready. Your crew’s open spots can be filled by solo players or another party.</p>
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
