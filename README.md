# OSMOSIS

Browser-based private-room 5v5 strategy game. Product behavior is defined by [`PRD.md`](./PRD.md); technical constraints are defined by [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Current milestone

- **M0 Foundations:** pnpm workspace, shared rules/constants, validated command contracts, canonical map geometry and Vitest tests.
- **M1 Visual prototype:** local Phaser 3 arena with WASD movement, follow camera, Arcade Physics collisions, wall-occluded fog and dummy players.
- **M2 Multiplayer skeleton:** Colyseus room with a 10-player cap, server-authoritative movement and container collision, 20 Hz snapshots, client-side remote smoothing, and server-filtered enemy visibility.
- **M3 Pre-match lobby:** private six-character room codes and invite links, balanced 5v5 teams, captains, private team point allocation, ready checks, and host-controlled launch countdown.
- **M4 Rules:** server-owned match timer, points, contact battles, team links, seeded pickups, base raids/defense, results, and rematch.
- **M5 Voice and resilience:** opt-in LiveKit Team rooms plus a match-wide Global channel, channel-scoped server tokens, independent Global listening, single-target mic routing, full deafen, and a 120-second reconnect reservation.
- **Test rooms:** create temporary 1v1 or 2v2 rooms from the home screen to exercise the same match systems without filling a ten-player lobby; standard rooms remain 5v5.
- **Warehouse Complex:** 11,232 × 5,376 hand-authored warehouse with distinct zones, connected north/central/south routes, asset-based props, server-shared collision/visibility geometry, and an aspect-correct team minimap.

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

`pnpm dev` starts the web client and Colyseus server. Open the Vite URL shown in the terminal, enter a crewmate name, and create a room. In development, choose **Test match · 1v1** or **Test match · 2v2** for a smaller session, or leave **Standard match · 5v5** selected. Production servers reject test modes unless `ENABLE_TEST_ROOM_MODES=true` is explicitly set. Share the six-character code or copy the invite link so friends can join. The host can open point allocation once the room is full and each team has a captain. Each captain assigns exactly 10,000 points to their crew in 100-point steps; teammates can see their crew's allocation, while the other crew's points stay hidden. After both captains lock their plans, all players ready up and the host starts the five-second countdown. During a match, use WASD to move, hold F near a teammate to link, and hold E inside the enemy base to raid. Tag opponents by contact; re-arm after 15 seconds or return to your own base to recover early. The first active player to hold their HQ pole is protected there; an active opponent who touches them is permanently eliminated. Teammates cannot enter an occupied pole zone. Collect glowing stars to earn points. Opponent numeric scores stay hidden. The host can start a rematch from the results screen. The game server health endpoint is available at `http://localhost:2567/health`.

## Docker

The root Compose file starts the Node/Colyseus server and the built web client as separate containers:

```sh
docker compose up --build
```

Open `http://localhost:5173`. The game server is on port `2567`; set `VITE_GAME_SERVER_URL` at build time when the browser must reach it at a different address. Copy `.env.example` to `.env` and set a persistent `RECONNECT_SECRET` and `METRICS_TOKEN` for containerized runs. The web image uses Vite's preview server for local/containerized play; use a static hosting service for a public production deployment.

For the single-instance EC2 deployment using a static web host and a named Cloudflare Tunnel, follow [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). It uses a separate production Compose file and leaves the local `compose.yaml` flow unchanged.

To capture movement diagnostics while testing, append `?movementDebug=1` to the match URL. The browser stores up to 10,000 input, snapshot and frame records in `window.__osmosisMovementTrace` for inspection or comparison between local and tunneled sessions.

To connect from another device on the same network, set `VITE_GAME_SERVER_URL` to the server's reachable HTTP address and add the web origin to `CLIENT_ORIGINS` before starting the processes.

Team and Global voice are opt-in. To enable them, copy `.env.example` to `.env` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and a persistent random `RECONNECT_SECRET`. Without LiveKit settings, creating and playing a match still works; the voice panel reports that voice is unavailable. Join Team voice from the in-game dock. Global listening is a separate toggle and does not interrupt Team audio. Choose Team or Global as the mic target; only one channel transmits at a time, and the microphone starts muted. Press **V** to toggle the selected microphone. Muting Global preserves Team audio; **DEAFEN** silences both. A room link reload attempts to restore the same seat for up to 120 seconds using a browser-persistent reconnection token. Explicitly leaving clears that token.
