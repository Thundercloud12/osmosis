# Implementation backlog

This tracks the gameplay and architecture work discussed on 2026-10-26 and 2026-10-27. `PRD.md` owns product behavior; `ARCHITECTURE.md` owns technical boundaries. See [IMPLEMENTATION_GAPS.md](IMPLEMENTATION_GAPS.md) for the implementation state and verification gaps.

## Recommended execution order

| Order | Work | Status |
|---|---|---|
| 1 | Capture movement diagnostics for jumps, consecutive stars and HQ battles. Trace input acknowledgments, snapshot timing, authoritative/predicted/rendered positions, corrections, status and pickup distance. | Implemented behind `?movementDebug=1`. Chromium trace confirmed inputs, snapshots, rendered frames, acknowledged movement and a 195 px authoritative displacement during a 1v1 run. A reproducible tunneled baseline is still useful for diagnosing future reports. |
| 2 | Split shared rules, server gameplay systems and snapshot projection; separate client net simulation and renderers. Keep the room and scene as composition layers. | Implemented. Shared movement and server gameplay/privacy modules have focused tests. Client prediction, interpolation, trace, map, fog and crewmate rendering are separate modules. Lobby/session orchestration and scene input/camera composition remain adapters. |
| 3 | Implement prediction/reconciliation with shared movement, numbered history, server acknowledgments, replay, bounded history and render-only correction smoothing. | Implemented and covered by shared and browser netcode tests; Chromium networked match confirmed the movement trace and authoritative movement. |
| 4 | Buffer/interpolate remote snapshots, reset buffers across lifecycle changes, and measure camera behavior. | Implemented; interpolation test passes, buffers reset on state transitions or visibility loss, and browser match rendering/camera was visually reviewed. A jitter benchmark remains a separate measurement task. |
| 5 | Verify consecutive stars, re-arm, contention and network distance behavior. | Consecutive collection and contention are covered by system and room integration tests. A live two-client contested-pickup latency measurement remains open. |
| 6 | Enforce score and temporary inactivity privacy in snapshots, contracts and UI. | Live opponent scores remain absent; result snapshots now disclose both team totals and every player's final balance. Projector and room integration tests cover both privacy phases and team-total reconciliation. |
| 7 | Apply ordinary battle rules inside HQ unless a pole-holder contact takes precedence; preserve existing raids. | Battle and raid systems are extracted and tested; room integration covers ordinary HQ transfer/inactivity and raid interruption. |
| 8 | Enforce exclusive pole ownership, permanent attacker elimination and gameplay-action rejection. | Implemented with shared collision blockers, server holder state, zero-balance elimination after battle settlement, and focused/integration coverage. Pole elimination clears remaining points without transferring them. |
| 9 | Add filtered spectator camera/view, reconnect persistence, rematch reset, Team/Global voice and team-wipe result. | Projection, spectator camera follow, score retention, private Team voice, optional match-wide Global listening/transmission and immediate team-wipe logic are implemented. Reconnect reserves seats for 120 seconds, persists Colyseus tokens across browser closure, restores identity and points without duplicate seats, transfers host, and clears explicit leaves. Unit, room integration, headful voice delivery and full-Chromium-restart checks pass. Public-tunnel behavior remains unverified. |
| 10 | Add server-confirmed tag, pole-elimination and raid feedback while keeping enemy inactivity and live scores private. | Typed recipient-scoped events, Phaser tweens and selected Kenney effects are implemented and visually reviewed in a headful 5v5 run. |
| 11 | Run focused checks and final Chromium scenarios in 1v1, 2v2 and 5v5, including local/tunneled movement traces. | Completed locally: 1v1, 2v2 and 10-player 5v5 rooms launched in Chromium. A separate headful 5v5 run used nine SDK bots plus one browser player and verified movement, pole elimination, spectator target, avatar visibility and camera tracking. See remaining limitations in `IMPLEMENTATION_GAPS.md` and the repeatable commands in the sibling `osmosis-stresstester` project. |
| 12 | Keep INACTIVE players mobile, freeze an ACTIVE opponent for 3 seconds on contact, and preserve inactivity privacy. | Implemented and covered by unit, room integration and headful Chromium 5v5 checks. |

These are follow-up gates within M2–M6, not a new stack or a restart of completed milestones.

## Resolved pole/elimination decisions

- A full-team elimination ends the round immediately; the other team wins.
- Every player starts with at least 500 of their team's 10,000 points.
- Eliminated players have zero points. Pole contact clears the attacker's remaining points without transferring them to the pole holder; a battle that reduces a balance to zero also eliminates that player.
- Live opposing scores stay hidden; the result screen shows both team totals and every player's final balance.
- V toggles the selected Team or Global microphone, which starts muted; Global receive is independent and DEAFEN silences all incoming voice.
- Tag, pole and raid effects play only after server-confirmed events and never affect game rules.
- One holder owns each pole, and teammates are kept outside its occupied zone.
- A spotted opponent may see permanent elimination; temporary enemy inactivity stays hidden.
- Any non-eliminated enemy who physically contacts the holder is eliminated, including an INACTIVE player; linked partners get no pole protection.
- Spectators follow the next roster-ordered living teammate and can use private Team voice or opt into Global voice. Manual spectator target selection is deferred.

## Remaining original product scope to audit

The M6 audit found the following PRD scope not included in this gameplay repair: load/fairness testing, privacy notice, and abuse reporting before public matchmaking. Contextual in-match hints, key remapping, a broad UI contrast pass, separate volume controls, and reduced-motion support for game effects are deferred in [NOT_NEEDED_NOW.md](NOT_NEEDED_NOW.md). The landing-page field guide, team-only Help pings, and match connection-quality indicator are implemented; their behavior and verification are recorded in `IMPLEMENTATION_GAPS.md`. Test rooms remain behind development-only UI and a production server policy; production can enable them explicitly with `ENABLE_TEST_ROOM_MODES=true` for a controlled test deployment.

## Boundaries for this work

- Keep React, Phaser, Colyseus, shared TypeScript and LiveKit. Separation of concerns happens within the existing applications.
- Preserve the UI style and authored map. Movement correction is not authorization to retune speed, pickup radius or scoring to conceal synchronization errors.
- Keep canonical mutable match state under one owner; use small explicit module interfaces, not a global service locator or cross-module access to room internals.
- Do not predict score awards, battles or elimination on the client. Replay only movement inputs.
- Treat reported star misses and teleports as symptoms until correlated with measured server/client state.
