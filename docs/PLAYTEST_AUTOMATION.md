# Automated 5v5 playtest

Run a headful 5v5 spectator scenario with:

```sh
pnpm --filter @osmosis/server playtest:spectator
```

The playtest starts an isolated Colyseus server and Vite client on free local ports, then opens Chromium with a visible window. It joins nine SDK-controlled players and one real browser client to a standard ten-player room. The nine bots complete the lobby flow and send normal sequenced movement messages while the match is running. It also captures a confirmed tag, raid start/completion, and pole-elimination presentation in the real Phaser scene.

The scenario starts each Blue player with 2,000 points, then uses server-owned room methods to stage a tag and base raid. To make pole contact repeatable, it places a 500-point Blue holder on the Blue pole and the browser player in contact range. The point balance remains positive while guarding. The room's normal pole reconciliation and contact resolution eliminate the attacker and clear their remaining points. This positioning is test setup; it does not add a gameplay command or HTTP endpoint.

The browser URL enables the development-only `spectatorDebug=1` probe. The run checks that the browser player becomes permanently eliminated, the HUD displays `ELIMINATED` and `SPECTATING`, the eliminated avatar is hidden, a living teammate is visible, and the Phaser camera follows that teammate as their normal movement input changes position. The match must remain in `PLAYING` while that player spectates. With LiveKit configured, Chromium joins the team voice room using a fake audio device, verifies the initial muted state and `V` mute/unmute cycle, and checks that the voice dock sits above the minimap. At the end, it opens the results screen and checks both team totals and every player's final balance against authoritative room state.

On success it prints a JSON summary and saves screenshots to `/tmp/osmosis-headful-tag-feedback.png`, `/tmp/osmosis-headful-raid-feedback.png`, `/tmp/osmosis-headful-raid-complete-feedback.png`, `/tmp/osmosis-headful-pole-feedback.png`, `/tmp/osmosis-headful-spectator.png`, and `/tmp/osmosis-headful-results.png`. Chromium must be installed as `chromium` or selected with `CHROMIUM_PATH`, and the process needs a desktop `DISPLAY`. The `.env` file must contain working LiveKit development credentials for the voice-toggle part of the run.

The run is deterministic and focused on movement, elimination/spectating, results, and one-client voice controls; it does not run a full 15-minute match, verify audio delivery to a second player, or simulate randomized strategies and network impairment. Collision, pickup, raid, privacy, status, and result edge cases remain covered by the server/shared integration and unit tests.

## Headful reconnect and explicit-leave check

Run the reconnect flow with:

```sh
pnpm --filter @osmosis/server playtest:reconnect
```

This starts an isolated Colyseus server and Vite client, creates a 1v1 room from a visible Chromium window, and joins a companion SDK client. It stages a live match state with a known player balance, gracefully closes the full Chromium process, then launches a new Chromium process against the same temporary browser profile and room URL. The run checks persistent-token recovery, the same player ID/status/points, host handoff without reclaiming the role, and that the connected-player count does not grow into a duplicate seat. It then clicks the in-game Leave Match control and verifies the confirmation, token removal, and absence of a reconnect reservation.

The script requires a desktop `DISPLAY` and Chromium (or `CHROMIUM_PATH`). It uses temporary local ports and removes its browser profile afterward. The successful reconnect HUD screenshot is written to `/tmp/osmosis-headful-reconnect.png`. This local run does not validate behavior through a Cloudflare tunnel or wait out the full 120-second expiry.
