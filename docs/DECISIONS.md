# OSMOSIS implementation decisions

## 2026-10-25 — M0/M1 prototype tuning values

The PRD explicitly leaves map dimensions, movement speed and view radius open for configuration and playtesting. The first visual prototype uses a 2400×1400 arena, 260 px/s movement, a 22 px player radius and a 430 px view radius. These values live only in the shared configuration and can be tuned without changing rules or module boundaries.

Phaser is pinned to 3.90.0 even though Phaser 4 is available because the binding Architecture document explicitly requires Phaser 3 and Arcade Physics.

## 2026-10-25 — M2 filtered snapshots

M2 uses Colyseus 0.18 and sends explicit per-client snapshots over room messages rather than a shared schema. Each snapshot is assembled from server-owned positions and includes only the local player, teammates, and enemies that pass the shared view-radius and line-of-sight checks. This follows the Architecture document's allowed client-specific snapshot path and prevents hidden enemy coordinates from entering the client payload. Full reconnection identity and lobby/team selection remain later milestones.

## 2026-10-26 — Isolated 1v1 and 2v2 test rooms

Room creation accepts explicit `TEST_1V1` and `TEST_2V2` modes for browser smoke testing. Standard rooms remain 5v5. The room's mode determines capacity and per-team roster checks; all modes use the same allocation total, movement, collision, visibility, scoring, timer, results, reconnect, and team voice systems. These are temporary testing affordances and do not change the PRD's 5v5 product rules.

## 2026-10-26 — Warehouse Complex map source

The arena is authored in `packages/shared/src/map/` at 11,232 × 5,376 world units (48-unit gameplay cells). The warehouse core is shifted 1,008 units east, leaving equal 1,008-unit HQ approach lanes; this puts the shortest base-to-base route above 35 seconds at the existing speed. Enclosed room perimeters and extended corridor flanks make the authored doors and tunnels the traversable connections between adjacent rooms. Shared rectangles define opaque movement/LOS blockers and transparent movement-only glass; zones, props, team bases, spawn anchors and pickup candidates use the same coordinate system. Phaser floor tiles, obstacle art, camera bounds, server collision/visibility, and the React minimap read this shared geometry. The minimap shows only self and teammates from the existing filtered snapshot.

The visual base is Kenney Tiny Factory (16 × 16 pixel tiles, CC0) stored locally under `apps/web/public/assets/warehouse/kenney-tiny-factory/`; the source archive and license are recorded in `assets/third-party/README.md`. World-to-art scale is 3×. Route tests use the existing 260-unit/s speed and authored collision geometry, including diagonal movement, to check the 35–60 second HQ-to-HQ target through north, central, and south gates. Spawn anchors match the server's original base-relative spawn coordinates; additional players retain the 65-unit spacing.

## 2026-10-26 — Timed battle recovery and HQ pole charge (superseded)

The game follows the requested update to the PRD's original re-arm rule: battle participants recover after 15 server-measured seconds, while entering their own base still re-arms them immediately. The timed pole boost described in this entry was replaced by exclusive pole ownership and permanent attacker elimination in the 2026-10-26 pole/elimination decision below.

## 2026-10-26 — Shared movement authority and pole elimination

The server and client now call the same pure movement/collision step. This replaces Phaser Arcade Physics as the gameplay movement owner because two independently implemented collision paths can put the predicted player at a different location from the server, causing visible corrections and apparent pickup misses. Phaser remains the renderer; the Colyseus server remains authoritative. Ordinary HQ contact follows normal battle rules unless an active home-pole holder is involved. One active player holds each pole; any non-eliminated enemy who touches that holder is permanently eliminated, with no point transfer. The holder remains active; teammates cannot enter the occupied pole zone. Eliminated players spectate through a visibility-filtered teammate view and do not re-arm. The point-retention rule in this entry was superseded on 2026-10-27.

## 2026-10-26 — Mobile inactivity and contact freeze

INACTIVE is a temporary interaction restriction, not an incapacitated movement state: the player can move, but cannot collect stars, link, raid or participate in ordinary battles. When an ACTIVE player contacts an INACTIVE opponent, only the ACTIVE player's movement stops for three server-measured seconds; neither score nor status changes. The consequence applies once per contact edge, and its timer is sent only to the frozen player. Pole-holder contact takes precedence, so an INACTIVE enemy who touches an active pole holder is still eliminated.

## 2026-10-27 — Starting minimum, elimination accounting and match feedback

Each player must receive at least 500 of their team's 10,000 starting points. Battle settlement still transfers at most 500 points; when an individual balance reaches zero, that player is eliminated immediately. Pole elimination clears the attacker's remaining balance without awarding it to the holder, so the eliminated player's points leave the team total. Live opponent scores remain private. At RESULTS, both final team totals and every player's final balance are disclosed. V toggles the microphone and the control reflects LiveKit's actual state. Phaser plays short, server-confirmed tag, pole and raid effects using Phaser tweens and selected Kenney Particle Pack textures; effects do not modify gameplay or reveal hidden score data.

## 2026-10-28 — Reconnect grace and intentional leave

Unexpected disconnects reserve the player's room slot for up to 120 server-measured seconds. A reconnect restores the same identity, team, points, and status; an eliminated player remains an eliminated spectator. After expiry, match records and points remain through results, while lobby slots are released. Explicit Leave Room is final for the current round and clears reconnect credentials; when online it releases a lobby seat immediately, while an already-offline reservation expires within the grace window. The Colyseus reconnection token is stored in `localStorage` because the supported recovery case includes closing and reopening the browser; a failed saved-token reconnect must never silently create a second player. A connected eliminated host remains host; disconnecting or leaving hands host to the oldest connected player.

## 2026-10-27 — Optional Global voice alongside private Team voice

Keep the two private LiveKit Team rooms and add one match-wide Global room per round. Players may listen to Global without leaving their Team room; Global receive can be switched off independently. The microphone routes to exactly one selected target at a time and stays muted when switching targets. Full DEAFEN silences incoming audio from both channels. This uses the existing LiveKit service and server-minted channel-scoped tokens; it adds no voice provider or game-server media relay.
