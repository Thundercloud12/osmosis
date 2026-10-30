# Remaining Work

**Updated:** 2026-10-29  
**Purpose:** Separate work that still needs implementation from existing behavior that still needs verification. The PRD remains the source of truth for product behavior, and the Architecture document remains the source of truth for technical choices.

The core match systems are implemented according to the current backlog. The work below is primarily M6 polish, playtesting, and launch preparation.

## 1. Implementation work

These items require new or changed product/code behavior.

| Priority | Work | Notes |
|---|---|---|
| Next | Add network-quality feedback | Give players a clear indication when their connection is degraded or reconnecting. |
| Launch | Add privacy notice and abuse-reporting path | Disclose the hosted voice provider and provide a reporting path before public matchmaking. Consider in-game mute/report controls as part of that flow. |
| Operations | Prepare persistent hosting and monitoring | Replace temporary Quick Tunnels for a real deployment. Keep the documented single Node/Colyseus instance for v1; add graceful shutdown and extend the private runtime stats with the remaining operational signals before deployment. |

## 2. Verification work

These items test behavior that is already implemented or confirm quality on real browsers/networks. Fix any defects found and record the outcome here.

| Priority | Scenario | Evidence still needed |
|---|---|---|
| Next | Public-tunnel reconnect and rematch | Repeat reconnect and rematch through a public link, including browser closure, and confirm the same seat/state returns without a duplicate. |
| Next | Natural browser gameplay edge cases | Use real browser clients to verify contested star pickups, ordinary collisions inside HQ, pole-holder contact, and simultaneous contact. Existing unit and room tests cover core rule resolution; this checks the full client/server experience. |
| Next | Ten-player fairness and performance | Run a full 5v5 match under latency/loss impairment and assess fairness, the 20 Hz server tick, movement corrections, and client rendering over a longer session. |
| Polish | Movement and camera stability | Run longer seeded movement routes and capture movement traces under jitter; compare authoritative, predicted, and rendered positions and review camera smoothness. |
| Polish | Elimination feedback | Review the zero-balance elimination animation and result transition in a browser. Pole, tag, and raid feedback already received a headful visual review. |
| Voice | Real microphone behavior | Verify physical microphone capture, permission denial, device changes, and voice quality on supported browsers/devices. Existing synthetic-audio tests verify LiveKit delivery and channel isolation, not physical capture. |

## Deferred scope

Manual spectator target selection is deferred. An eliminated player currently follows a living teammate selected by deterministic roster order; spectators cannot choose or switch targets. This is a known product limitation, not a missing implementation of the current spectating behavior.

Contextual in-match hints are deferred; the landing-page field guide covers controls and core mechanics. This is recorded in [NOT_NEEDED_NOW.md](NOT_NEEDED_NOW.md).

Reduced-motion support for Phaser feedback is deferred. The tutorial page turn and Help radar pulse already honor the browser preference; no further animation changes are currently planned.

## Suggested order

1. Add network-quality feedback.
2. Close the public-tunnel and natural-browser gameplay verification gaps.
3. Run ten-player testing under network impairment and review movement traces.
4. Finish real-microphone checks.
5. Complete privacy, reporting, and persistent-hosting preparation before public matchmaking.
