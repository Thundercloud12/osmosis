# OSMOSIS — Product Requirements Document (PRD)

**Version:** 1.4 · **Status:** Approved target rules · **Mode:** Browser-adapted, private-room 5v5 · **Match duration:** 15 minutes

> This document defines **what to build, the player's experience, and acceptance criteria**. `ARCHITECTURE.md` defines **how to build it**. If they conflict, resolve the discrepancy in writing before implementing. Game mechanics below are original browser adaptations, not claims about exact TV-show rules. This revision records the approved 120-second reconnect window and intentional-leave behavior discussed on 2026-10-28, along with the scoring, results, voice and feedback rules approved on 2026-10-27.

## 1. Product goal

A polished, browser-based, real-time, top-down 2D team strategy game inspired by point-based territory competitions. Ten friends can join by link, distribute points, coordinate over private Team voice or an optional match-wide Global voice channel, and compete in a 15-minute arena match. No account or installation required.

### Success criteria for v1
- Ten players can join one private lobby (5 per team), ready up, play, view results and rematch.
- All scoring, movement validity, visibility and timers are verified by an authoritative server.
- During play, opponents never receive the other crew's numeric points or a spotted enemy's temporary inactivity status. The results screen reveals both final team totals and every player's final points.
- A pole holder can permanently eliminate an attacker who touches them; the eliminated player remains connected as a spectator.
- The map, collisions, camera and sight restrictions feel responsive on a mainstream laptop browser.
- Voice chat keeps Blue and Red team channels private, with an optional match-wide Global channel. Players choose Global reception independently from Team voice; Global transmission is explicit, full deafen silences every incoming channel, and voice failure never blocks gameplay.
- A dropped connection can rejoin its reserved player slot for up to 120 seconds, including after closing and reopening the browser.

### Non-goals (v1)
Public matchmaking, ranked play, accounts, mobile touchscreen controls, free spectator access for people who were not eliminated in the match, cosmetics, inventory, persistent profile/statistics, replay, monetization, AI players, full 3D, cross-match progression and microservices.

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
| 6. Match | Move, scout, collect items, tag enemies, link teammates, threaten bases, coordinate over private Team voice or opt-in Global voice; pole-eliminated players spectate | 15-minute timer expires or every player on one team is permanently eliminated |
| 7. Results | Winning team, both final team totals and every player's final points | Result shown to all players |
| 8. Rematch | Same lobby/team membership; fresh scores, positions and items; captains allocate again | New round ready |

### What the player sees during a match
- **Phaser arena:** industrial containers/walls, top-down characters with team colors, camera follows local player.
- **Near-field view:** local character and nearby visible players; walls block sight; unseen region is dimmed/fogged.
- **Team awareness:** teammate icons and position on minimap regardless of distance; enemies only appear locally when in line-of-sight, never on global minimap.
- **HUD:** own points, own crew's aggregate score, match clock, own status (ACTIVE/INACTIVE/ELIMINATED), interaction prompts, voice/mute/deafen controls, minimap. The opposing crew's numeric score is hidden until results.
- **Enemy information:** enemy identity and team are visible when spotted. Enemy exact points and aggregate score remain secret. A spotted enemy's temporary INACTIVE status is hidden. A permanent elimination may be shown as an elimination presentation, never as point data.
- **Spectating:** a permanently eliminated player can follow a living teammate and receives only that teammate's normal visibility-filtered view. No free camera may reveal hidden enemies.
- **Voice:** private Team room plus optional shared Global room, V-key toggle for the selected transmit channel, independent Global receive control, and full deafen; clear mic indicator. Denied mic permission -> gameplay continues with team pings.

## 4. Gameplay rules — v1 authoritative specification

These are chosen rules for the browser adaptation. Constants belong in one shared configuration module; no frontend hard-coding.

| Rule | v1 decision |
|---|---|
| Teams | Blue vs Red; 5 players per team |
| Length | 900 seconds, server-measured |
| Starting points | Each team allocates exactly 10,000 in integer increments of 100; every player must start with at least 500 |
| Team score | Sum of members' current points; may change due to pickups, battles and base raids |
| Movement | WASD; constant walk speed; solid walls/containers and arena boundary |
| Battles | Active opponents tag by contact. Unless a pole-holder rule applies, greater effective points wins; winner gains up to 500 and loser loses the same amount, limited by the loser's balance |
| Battle tie | Equal effective points: no transfer; both become INACTIVE |
| Negative balance | Never allowed; points floor at 0 |
| After ordinary battle | All battle participants become INACTIVE for 15 seconds; they can move but cannot initiate battles, collect pickups, link, or raid while INACTIVE. They automatically re-arm when that server timer expires, or immediately when they move into their own team's base |
| Inactivity privacy | Self and teammates may see INACTIVE status. Opponents do not receive or render an enemy's temporary inactivity status |
| Contact with an inactive player | An INACTIVE player can move and does not trigger a battle by contact. If an ACTIVE opponent touches them, that ACTIVE player is movement-frozen for 3 seconds; no points transfer and neither player's status changes. Continuous contact does not repeatedly apply or extend the freeze |
| Permanent elimination | Any non-eliminated enemy who touches an active pole holder becomes ELIMINATED for the rest of the round, including an INACTIVE player. Only the touching attacker is eliminated; no points transfer to the holder, and the eliminated player's remaining points are removed from their team's score. A player whose points reach zero after battle settlement is also immediately ELIMINATED. Pole contact takes precedence over the inactive-contact freeze. ELIMINATED is not cleared by a timer, base entry, or reconnect; the player remains connected as a spectator with zero points |
| Score privacy | Opponents' numeric scores and per-player points are absent from all PLAYING snapshots. At RESULTS, all players receive both final team totals and every player's final point balance |
| Linked teammates | Press/hold interaction within link radius; connected allies combine points for battle comparison, but remain independently owned point balances |
| Linked battle settlement | Winning side gains up to 500 split equally among linked participants (remainder assigned by stable player ID); losing side pays up to 500 proportionally to available balances; all participants become INACTIVE |
| Item pickup | Each item adds **+200** points to collector; item disappears; server spawns a fixed seeded set at match start; no respawn in v1 |
| Base raid | ACTIVE attacker reaching and interacting with enemy base for **3 uninterrupted seconds** earns **+2,000** personal points; raid then has a **90-second cooldown per team** |
| Base combat | The HQ zone itself provides no battle immunity. If neither participant is a pole holder, a collision in an HQ resolves using ordinary battle rules and point transfer. A battle interrupts an active raid |
| HQ pole | This replaces the earlier five-second combat charge. Each team has one exclusive pole-holder slot. While an active player physically occupies their own pole, any non-eliminated opponent who touches that holder is permanently ELIMINATED; the holder stays ACTIVE. This bypasses ordinary score comparison and point transfer. Only one player may physically occupy the pole zone; teammates are kept outside until it is free |
| Simultaneous contacts | Process with deterministic server event ordering; prevent double scoring within the same tick or cooldown window |
| Win condition | If every rostered player on one team is ELIMINATED, the other team wins immediately. Otherwise, the higher team score at timeout wins; equal scores = draw |
| Match exits | An unexpected disconnect does not delete points or end the match; freeze the player in a safe, non-interactable state and reserve their slot for at most 120 seconds. An explicit Leave Room action is final for that round and clears the reconnect credential |

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
| FR-04 | Point allocation | Invalid totals, any player below 500, non-integer points and edits after locking rejected by server |
| FR-05 | Server countdown and 15-minute timer | All clients see near-identical remaining time; no client can change clock |
| FR-06 | WASD movement + camera + wall collision | Characters cannot cross solid walls or arena bounds |
| FR-07 | Limited visibility | Enemy behind a container is neither drawn nor disclosed via client network state |
| FR-08 | Tag battles + mobile inactivity, contact freeze and timed re-arm | Deterministic point changes; any player reduced to zero is eliminated in the same tick; no repeated farming on overlap; ordinary HQ battles resolve normally; INACTIVE players can move but cannot score or start interactions; an ACTIVE player touching an INACTIVE opponent is movement-frozen for 3 seconds without a battle; own-base entry re-arms immediately and the 15-second server deadline re-arms elsewhere; enemy clients receive no temporary inactivity or freeze timer |
| FR-09 | Team linking | Two-player group compares combined points and resolves transfer once |
| FR-10 | Pickups and raids | Server validates distance, activity, pickup ownership and raid cooldown |
| FR-11 | HUD and team minimap | Own points and own crew score shown; opponent numeric points and score absent from every live payload; unseen enemy positions absent |
| FR-12 | Match results and rematch | Both final team totals and every player's final points are shown; score ties resolve to draw; second match begins from reset state |
| FR-13 | Team and Global voice | Blue and Red Team channels remain isolated. Any connected player may opt into Global audio without leaving Team voice; Global transmissions reach only Global listeners. Muting Global preserves Team reception, full DEAFEN silences both, and the microphone transmits to only one selected channel at a time. |
| FR-14 | Reconnect and host/captain reassignment | Rejoin within 120 seconds restores the same identity/state even after browser closure; after expiry the player remains unavailable for the rest of the match. A failed saved-token reconnect never silently creates a duplicate seat |
| FR-15 | Exclusive HQ pole and permanent elimination | One holder per pole; opponent contact eliminates the attacker for the round and clears their remaining points without transferring them; holder stays active; eliminated client can spectate without bypassing visibility filters |

### P1: polish after core play is stable
- Ready-check and roster transitions with clear reasons why Start is disabled.
- Short rule tutorial; contextual hints for tagging, linking, re-arming, raiding.
- Camera shake/screen flash and sound on wins/losses, with reduced-motion and volume controls.
- Clear server-confirmed tag, elimination and raid animations; smooth, measured movement reconciliation and remote interpolation.
- Server-confirmed tag, elimination and raid feedback uses short Phaser tweens and a small, curated set of licensed 2D effects; visual feedback never determines gameplay outcomes or exposes hidden points.
- Voice speaking indicators, pings for attack/defend/need help, network quality indicator.
- Keyboard remapping and accessibility contrast improvements.

## 6. Coordination and communication
- Team voice is separate for Blue and Red; opponent audio must never be routable through a Team channel. One match-wide Global voice channel is available to connected players who opt in to receive it.
- Global reception is an independent choice: turning it off leaves Team reception active. Players explicitly select whether their microphone transmits to their Team or to Global; only one transmit target is active at once, and changing target mutes the previous channel.
- DEAFEN silences incoming Team and Global audio together. Muting Global alone does not silence teammates. Voice starts muted, and mic denial or service failure does not block gameplay.
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
| Host disconnects or leaves | Host reassigned to the oldest connected player; a running match continues. A connected eliminated host remains host while spectating |
| Rejoin mid-match | A room-scoped reconnect token restores the same avatar, score/team/status for up to 120s; no duplicate players. An eliminated player returns as a spectator and remains eliminated |
| 10th player joins during countdown | Already full: reject; countdown remains valid |
| Player disconnects in match | Server removes avatar from interactions, freezes movement, retains score and reserves their slot for 120s; state is restored only with the matching reconnect token |
| Player is eliminated at a pole | Player cannot move, collect, raid, link or re-arm for the remainder of the round; remaining points are cleared without transferring them to the holder; retains team voice and stays connected in spectator mode |
| Pole already has a holder | Teammates cannot enter the occupied pole zone until its holder leaves or becomes unavailable |
| Entire crew is eliminated | Other team wins immediately; the round enters results |
| Enemy is temporarily inactive | Opposing clients receive no INACTIVE status or timer; team/self status remains available to authorized viewers |
| Entire team disconnects | Timer continues, other team can complete match; no instant forfeiture in v1 |
| Mic rejected / voice service fails | Show voice unavailable; keep full gameplay and ping controls functional |
| High latency / lost packets | Local player predicts movement; server corrects divergences; never predict scoring |
| Page reload or browser closure | Attempt token-based rejoin for up to 120s; if the credential is expired or invalid, explain the failure and require an explicit new join |
| Player chooses Leave Room | Clear the saved reconnect token and leave permanently for this round. If still connected, release the lobby seat immediately; if already offline, the server frees its reserved seat when the 120-second window expires |
| Battle reduces player to 0 points | Player is immediately ELIMINATED, their score remains zero, and they spectate for the rest of the round |
| INACTIVE player touches ACTIVE player | No battle or point transfer; the ACTIVE player is movement-frozen for 3 seconds. INACTIVE contact does not trigger a tag |
| ACTIVE player touches INACTIVE player | Apply the same 3-second movement freeze to the ACTIVE player; do not reveal the target's INACTIVE state to opponents |
| INACTIVE touches INACTIVE | No battle, freeze or point change |
| Contact pair remains overlapped | Apply contact consequences once on contact entry; no repeated or extended freeze until the players separate and make contact again |
| Both players touch simultaneously | One deterministic result; one transfer; no duplicate events |
| Game clock expires during raid | Raid cancels; finish and score using server state at timeout |
| Equal team scores | DRAW screen, no tiebreaker |
| Offensive nickname / abuse | Nickname length/character limits, in-game mute; invite-only launch; abuse report tooling before public matchmaking |
| Empty room | Dispose in-memory room after grace timeout; invite becomes invalid |

## 8. Screens and core controls

1. **Home:** create/join, rules, audio preferences.
2. **Lobby:** room link/code, team columns, captain selector, ready toggle, host Start.
3. **Allocation:** captain sliders/fields with remaining counter; team read-only view; Lock.
4. **Arena:** Phaser canvas + React HUD; `WASD` move, `E` interact / start raid, `F` link (hold), `G` team ping, `V` toggle the selected Team or Global microphone; voice dock controls Team/Global reception, transmit target and full DEAFEN; `Esc` settings.
5. **Spectator:** eliminated players follow an eligible teammate using that teammate's visibility-filtered view.
6. **Results:** winner, both final team totals, all players' final points, pickups, raids, rematch.

**Gameplay readability:** characters should have name labels and team-color outlines; containers visibly block movement and sight; clear indicator distinguishes player inactivity from being disconnected.

## 9. Delivery plan and implementation gates

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0 — Foundations | Monorepo, contracts, config, test runner | Dev commands work; domain types compile |
| M1 — Visual prototype | One Phaser map, player movement, camera, collision, local fog and dummy sprites | Fun movement; no walking through walls |
| M2 — Multiplayer skeleton | Colyseus room, 10 connected clients, movement interpolation, per-client visibility and score/status filtering | Two browsers see correct synced players; hidden enemy, enemy inactivity status and opposing numeric scores are not sent |
| M3 — Pre-match | React lobby, roles, teams, allocation, server countdown | Ten players can start a valid match |
| M4 — Rules | Tags, linking, pickups, ordinary HQ battles, exclusive pole holder, permanent pole elimination/spectating, score, timer, result | Deterministic automated unit/integration tests pass; pole contact eliminates only the attacker and no-pole HQ contact settles normally |
| M5 — Voice and resilience | Private Team LiveKit rooms, optional match-wide Global room, channel-scoped secure tokens, independent reception, one outgoing mic target, full deafen, 120-second reconnect including browser closure and explicit leave | Team isolation and Global opt-in boundaries verified; Global mute preserves Team audio; reconnect preserves identity/state and never duplicates a player; explicit leave cancels rejoin; eliminated players never re-arm on reconnect |
| M6 — Polish and playtest | UX hints, pole/elimination feedback, measured movement reconciliation/interpolation, ping system, asset/audio polish, load and fairness testing | Complete 5v5 session without critical blockers; movement and privacy checks pass |

## 10. Open questions (do not silently invent during implementation)
- The next implementation work is tracked in [docs/IMPLEMENTATION_BACKLOG.md](docs/IMPLEMENTATION_BACKLOG.md), with observed behavior in [docs/IMPLEMENTATION_GAPS.md](docs/IMPLEMENTATION_GAPS.md).
- V toggles the selected Team or Global microphone; voice starts muted and the UI reflects the actual LiveKit microphone state.
- Eliminated players have zero points and remain in team voice. A full team wipe ends the match; the other team wins immediately.
- Spectators automatically follow the next living teammate in deterministic roster order; manual target selection is deferred.
- Team voice remains available to eliminated members through the existing per-team room. They may also opt into Global voice under the same channel controls as other connected players.
- A linked pole holder alone receives pole protection; only the enemy who physically contacts the holder is eliminated. The contact ends any link belonging to the eliminated attacker.
- Exact map dimensions, move speed, view radius and scoring balance (configuration + playtest).
- Whether partially complete lobbies should have a **demo** mode (v1 multiplayer requires ten).
- Whether to rename final product and create fully original artwork/branding before public release.

**Agent implementation directive:** Execute milestones in order; do not introduce out-of-scope systems to “future-proof” v1. Implement decisions above unless recorded as open questions. Keep product behavior testable rather than implied.
