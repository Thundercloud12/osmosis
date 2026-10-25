# OSMOSIS

Browser-based private-room 5v5 strategy game. Product behavior is defined by [`PRD.md`](./PRD.md); technical constraints are defined by [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Current milestone

- **M0 Foundations:** pnpm workspace, shared rules/constants, validated command contracts, canonical map geometry and Vitest tests.
- **M1 Visual prototype:** local Phaser 3 arena with WASD movement, follow camera, Arcade Physics collisions, wall-occluded fog and dummy players.
- **M2 Multiplayer skeleton:** Colyseus room with a 10-player cap, server-authoritative movement and container collision, 20 Hz snapshots, client-side remote smoothing, and server-filtered enemy visibility.
- **M3 Pre-match lobby:** private six-character room codes and invite links, balanced 5v5 teams, captains, private team point allocation, ready checks, and host-controlled launch countdown.
- **M4 Rules:** server-owned match timer, points, contact battles, team links, seeded pickups, base raids/defense, results, and rematch.
- **M5 Voice and resilience:** opt-in LiveKit team voice, scoped server tokens, push-to-talk/mute/deafen controls, and a 60-second reconnect reservation.
- **Expanded arena:** 2,800 × 1,600 mirrored shipping-container map with wider connected lanes and a minimap that uses the canonical arena geometry.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.33.2 (via Corepack)

## Commands

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` starts the web client and Colyseus server. Open the Vite URL shown in the terminal, enter a crewmate name, and create a room. Share the six-character code or copy the invite link so friends can join. The host can open point allocation after ten players have joined and each team has a captain. Each captain assigns exactly 10,000 points to their own five players in 100-point steps; teammates can see their crew's allocation, while the other crew's points stay hidden. After both captains lock their plans, all ten players ready up and the host starts the five-second countdown. During a match, use WASD to move, hold F near a teammate to link, and hold E inside the enemy base to raid. Tag opponents by contact; return to your own base to re-arm after a tag. Collect glowing stars to earn points. The host can start a rematch from the results screen. The game server health endpoint is available at `http://localhost:2567/health`.

To connect from another device on the same network, set `VITE_GAME_SERVER_URL` to the server's reachable HTTP address and add the web origin to `CLIENT_ORIGINS` before starting the processes.

Team voice is opt-in. To enable it, copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and a persistent random `RECONNECT_SECRET`. Without LiveKit settings, creating and playing a match still works; the voice panel reports that voice is unavailable. Join voice from the in-game dock, allow microphone access, and hold **V** to talk. The microphone stays muted until push-to-talk is held; manual mute and deafen are available in the dock. A room link reload attempts to restore the same seat for up to 60 seconds using a browser session token.
