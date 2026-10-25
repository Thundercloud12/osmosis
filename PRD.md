# OSMOSIS — Product Requirements Document (PRD)

**Version:** 1.0 · **Status:** Implementation baseline · **Mode:** Browser-adapted, private-room 5v5 · **Match duration:** 15 minutes

> This document defines **what to build, the player's experience, and acceptance criteria**. `ARCHITECTURE.md` defines **how to build it**. If they conflict, resolve the discrepancy in writing before implementing. Game mechanics below are original browser adaptations, not claims about exact TV-show rules.

## 1. Product goal

A polished, browser-based, real-time, top-down 2D team strategy game inspired by point-based territory competitions. Ten friends can join by link, distribute points, coordinate over built-in team voice, and compete in a 15-minute arena match. No account or installation required.

### Success criteria for v1
- Ten players can join one private lobby (5 per team), ready up, play, view results and rematch.
- All scoring, movement validity, visibility and timers are verified by an authoritative server.
- The map, collisions, camera and sight restrictions feel responsive on a mainstream laptop browser.
- Voice chat is team-isolated, works with mute/deafen, and never prevents gameplay if permissions are denied.
- A dropped connection can rejoin its reserved player slot during the grace period.

### Non-goals (v1)
Public matchmaking, ranked play, accounts, mobile touchscreen controls, spectator mode, cosmetics, inventory, persistent profile/statistics, replay, monetization, AI players, full 3D, cross-match progression and microservices.

## 2. Target player and platform
- **Players:** Groups of friends; exactly ten active participants in a full match.
- **Platform:** Desktop Chrome/Firefox/Edge; keyboard + mouse; responsive menus, desktop-first arena.
- **Room:** Invite code and shareable link; optional nickname; no registration.
- **Access:** Private unlisted lobby; anyone with the link can attempt to join while capacity allows.

## 3. End-to-end player journey

| Phase | Player experience | Completion condition |
|---|---|---|
| 1. Landing | Choose **Create Room** or **Join Room**, see **How to Play** | Room created/joined |
| 2. Lobby | Enter nickname, choose Blue/Red (max five each), see player list and readiness, copy invite | Five players on each team |
| 3. Captain selection | Each team chooses one captain; room creator is host but need not be captain | One captain per team |
| 4. Allocation | Captain assigns their team's 10,000 starting points; teammates see and discuss; enemy allocation hidden | Both teams' allocations total exactly 10,000; both captains lock |
| 5. Ready/countdown | Players confirm ready; host presses Start; 5-second countdown | Match transitions to playing atomically |
| 6. Match | Move, scout, collect items, tag enemies, link teammates, threaten bases, coordinate over private voice | 15-minute server timer expires |
| 7. Results | Winning team, team score, individual contribution and event breakdown | Result shown to all players |
| 8. Rematch | Same lobby/team membership; fresh scores, positions and items; captains allocate again | New round ready |

### What the player sees during a match
- **Phaser arena:** industrial containers/walls, top-down characters with team colors, camera follows local player.
- **Near-field view:** local character and nearby visible players; walls block sight; unseen region is dimmed/fogged.
- **Team awareness:** teammate icons and position on minimap regardless of distance; enemies only appear locally when in line-of-sight, never on global minimap.
- **HUD:** own points, match clock, team score, current status (ACTIVE/INACTIVE), interaction prompts, voice/mute/deafen controls, minimap.
- **Enemy information:** enemy identity and team are visible when spotted; **enemy exact points remain secret**, even during a battle (only outcome is shown).
- **Voice:** team-only room, push-to-talk preferred (configurable), mute/deafen and per-user volume; clear mic indicator. Denied mic permission -> gameplay continues with team pings.

## 4. Gameplay rules — v1 authoritative specification

These are chosen rules for the browser adaptation. Constants belong in one shared configuration module; no frontend hard-coding.

| Rule | v1 decision |
|---|---|
| Teams | Blue vs Red; 5 players per team |
| Length | 900 seconds, server-measured |
| Starting points | Each team allocates exactly 10,000, in nonnegative integer increments of 100 |
| Team score | Sum of members' current points; may change due to pickups, battles and base captures |
| Movement | WASD; constant walk speed; solid walls/containers and arena boundary |
| Battles | Players **tag** by contact while ACTIVE; greater effective points wins; winner gains 500, loser loses 500, limited by loser's balance |
| Battle tie | Equal effective points: no transfer; both become INACTIVE |
| Negative balance | Never allowed; points floor at 0 |
| After battle | Both involved players become INACTIVE until reaching their own team's base (re-arm) |
| Linked teammates | Press/hold interaction within link radius; connected allies combine points for battle comparison, but remain independently owned point balances |
| Linked battle settlement | Winning side gains up to 500 split equally among linked participants (remainder assigned by stable player ID); losing side pays up to 500 proportionally to available balances; all participants become INACTIVE |
| Item pickup | Each item adds **+200** points to collector; item disappears; server spawns a fixed seeded set at match start; no respawn in v1 |
| Base raid | ACTIVE attacker reaching and interacting with enemy base for **3 uninterrupted seconds** earns **+2,000** personal points; raid then has a **90-second cooldown per team** |
| Base defense | Defender within their own base zone cannot lose an ordinary tag battle; tagging an attacker there interrupts its raid and makes attacker INACTIVE; defenders gain no extra points automatically |
| Simultaneous contacts | Process with deterministic server event ordering; prevent double scoring within the same tick or cooldown window |
| Win condition | Higher team score at timeout wins; equal scores = draw |
| Match exits | Disconnect does not delete player's points or end the match; player freezes in a safe, non-interactable disconnected state until reconnection |

**Why raids differ from the source material:** +10,000 repeated captures would dominate a 15-minute browser match. A lower reward, channel time and cooldown should create meaningful choices. Tune after playtesting, not during initial implementation.

**Linking UX:** The server accepts link requests only between ACTIVE same-team players within radius, with no intervening wall. A group is maximum **two players** in v1. The link breaks automatically if either moves beyond radius, becomes inactive/disconnected or releases the link. Only one battle fires per contact event. Split settlement and link grouping must be tested with zero-balance cases.

**Map model:** One symmetrical shipping-container arena, two opposing bases, several loops/flanking routes, collision shapes and sight-blocker shapes. No hiding inside solid obstacles. Spawn players in protected zones at their own base; pickups stay away from spawn zones.

## 5. Functional requirements and acceptance criteria

### P0: mandatory for first fully playable match

| ID | Requirement | Acceptance test |
|---|---|---|
| FR-01 | Private rooms + 6-character codes / invite link | Two isolated rooms cannot see one another |
| FR-02 | Nicknames and roster, max ten, max five per team | Eleventh participant rejected; team overfill rejected |
| FR-03 | Captain + host roles | Host and captain can be different players; only authorized actions succeed |
| FR-04 | Point allocation | Invalid totals, negative/non-integer points and edits after locking rejected by server |
| FR-05 | Server countdown and 15-minute timer | All clients see near-identical remaining time; no client can change clock |
| FR-06 | WASD movement + camera + wall collision | Characters cannot cross solid walls or arena bounds |
| FR-07 | Limited visibility | Enemy behind a container is neither drawn nor disclosed via client network state |
| FR-08 | Tag battles + inactive/re-arm | Deterministic point changes; no repeated farming on overlap |
| FR-09 | Team linking | Two-player group compares combined points and resolves transfer once |
| FR-10 | Pickups and raids | Server validates distance, activity, pickup ownership and raid cooldown |
| FR-11 | HUD and team minimap | Own points shown; hidden enemy points/positions absent |
| FR-12 | Match results and rematch | Score ties resolve to draw; second match begins from reset state |
| FR-13 | Voice per team | Blue members cannot hear Red audio; voice works without exposing server secret |
| FR-14 | Reconnect and host/captain reassignment | Rejoin within 60 seconds restores identity; otherwise player remains unavailable this round |

### P1: polish after core play is stable
- Ready-check and roster transitions with clear reasons why Start is disabled.
- Short rule tutorial; contextual hints for tagging, linking, re-arming, raiding.
- Camera shake/screen flash and sound on wins/losses, with reduced-motion and volume controls.
- Voice speaking indicators, pings for attack/defend/need help, network quality indicator.
- Keyboard remapping and accessibility contrast improvements.

## 6. Coordination and communication
- Team voice is separate for Blue and Red; opponent audio must never be routable to the other side.
- The allocation screen exposes only own team's distribution; captain is the only editor.
- Mid-match players may place short-lived team-only pings on the map (no persistent enemy tracking).
- Mute, deafen and browser permissions are under each player's control.
- Do not autoplay captured microphone without clear opt-in; show microphone status.
- If using a hosted voice provider, disclose voice provider in privacy notice; do not record voice in v1.

## 7. Edge cases (explicit behavior)

| Case | Behavior |
|---|---|
| Lobby player leaves | Slot freed; team state/ready resets; captain is reassigned if needed |
| Captain disconnects before match | After 15s, select connected teammate deterministically; uncommitted allocation remains editable |
| Host leaves | Host reassigned to oldest connected player; match already running continues |
| Rejoin mid-match | Session token restores same avatar, score/team/status for 60s; no duplicate players |
| 10th player joins during countdown | Already full: reject; countdown remains valid |
| Player disconnects in match | Server removes avatar from interactions, retains score, prevents exploitation; restored on reconnect |
| Entire team disconnects | Timer continues, other team can complete match; no instant forfeiture in v1 |
| Mic rejected / voice service fails | Show voice unavailable; keep full gameplay and ping controls functional |
| High latency / lost packets | Local player predicts movement; server corrects divergences; never predict scoring |
| Page reload | Attempt token-based rejoin; else return to join page with explanation |
| Player at 0 points | Can move, pick up items and raid; cannot lose points below 0 |
| Contact while inactive | No battle; pass through/block according to collision setting (v1: no player-body blocking) |
| Both players touch simultaneously | One deterministic result; one transfer; no duplicate events |
| Game clock expires during raid | Raid cancels; finish and score using server state at timeout |
| Equal team scores | DRAW screen, no tiebreaker |
| Offensive nickname / abuse | Nickname length/character limits, in-game mute; invite-only launch; abuse report tooling before public matchmaking |
| Empty room | Dispose in-memory room after grace timeout; invite becomes invalid |

## 8. Screens and core controls

1. **Home:** create/join, rules, audio preferences.
2. **Lobby:** room link/code, team columns, captain selector, ready toggle, host Start.
3. **Allocation:** captain sliders/fields with remaining counter; team read-only view; Lock.
4. **Arena:** Phaser canvas + React HUD; `WASD` move, `E` interact / start raid, `F` link (hold), `G` team ping, `V` push-to-talk (when enabled), `Esc` settings.
5. **Results:** team totals, transfers, pickups, raids, rematch.

**Gameplay readability:** characters should have name labels and team-color outlines; containers visibly block movement and sight; clear indicator distinguishes player inactivity from being disconnected.

## 9. Delivery plan and implementation gates

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0 — Foundations | Monorepo, contracts, config, test runner | Dev commands work; domain types compile |
| M1 — Visual prototype | One Phaser map, player movement, camera, collision, local fog and dummy sprites | Fun movement; no walking through walls |
| M2 — Multiplayer skeleton | Colyseus room, 10 connected clients, movement interpolation, per-client visibility filtering | Two browsers see correct synced players; hidden enemy not sent |
| M3 — Pre-match | React lobby, roles, teams, allocation, server countdown | Ten players can start a valid match |
| M4 — Rules | Tags, linking, pickups, bases, score, timer, result | Deterministic automated unit/integration tests pass |
| M5 — Voice and resilience | Team LiveKit rooms, secure tokens, reconnect, mute/deafen | Team isolation verified; mic denial handled |
| M6 — Polish and playtest | UX hints, ping system, asset/audio polish, load and fairness testing | Complete 5v5 session without critical blockers |

## 10. Open questions (do not silently invent during implementation)
- Whether default voice is open-mic or push-to-talk (proposed: push-to-talk).
- Exact map dimensions, move speed, view radius and scoring balance (configuration + playtest).
- Whether partially complete lobbies should have a **demo** mode (v1 multiplayer requires ten).
- Whether to rename final product and create fully original artwork/branding before public release.

**Agent implementation directive:** Execute milestones in order; do not introduce out-of-scope systems to “future-proof” v1. Implement decisions above unless recorded as open questions. Keep product behavior testable rather than implied.
