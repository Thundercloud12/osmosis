# OSMOSIS implementation decisions

## 2026-10-25 — M0/M1 prototype tuning values

The PRD explicitly leaves map dimensions, movement speed and view radius open for configuration and playtesting. The first visual prototype uses a 2400×1400 arena, 260 px/s movement, a 22 px player radius and a 430 px view radius. These values live only in the shared configuration and can be tuned without changing rules or module boundaries.

Phaser is pinned to 3.90.0 even though Phaser 4 is available because the binding Architecture document explicitly requires Phaser 3 and Arcade Physics.

## 2026-10-25 — M2 filtered snapshots

M2 uses Colyseus 0.18 and sends explicit per-client snapshots over room messages rather than a shared schema. Each snapshot is assembled from server-owned positions and includes only the local player, teammates, and enemies that pass the shared view-radius and line-of-sight checks. This follows the Architecture document's allowed client-specific snapshot path and prevents hidden enemy coordinates from entering the client payload. Full reconnection identity and lobby/team selection remain later milestones.
