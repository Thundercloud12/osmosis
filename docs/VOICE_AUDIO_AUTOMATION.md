# Voice channel audio delivery check

Run the focused headful check with:

```sh
pnpm --filter @osmosis/server playtest:voice-audio
```

The script starts an isolated game server and Vite client, creates a 2v2 test room, and opens three Chromium clients in separate browser storage contexts: two Blue teammates and one Red opponent. It joins Team voice for all players and injects a modulated synthetic signal into the Blue sender's microphone path.

The check verifies that the Red player receives no Team audio, then switches the Blue sender to Global and verifies non-silent Global audio reaches an opted-in Red listener. A Blue teammate who has not opted in receives no Global track; after opting in, that teammate receives Global audio. Turning Global off unsubscribes the Global track while the Team session remains connected. Full DEAFEN mutes all subscribed Team and Global audio together.

The run exercises browser publication, LiveKit delivery, channel routing, independent subscriptions and full deafen. It does not use a physical microphone or test real-device permissions and voice quality.

Chromium must be installed as `chromium` or selected with `CHROMIUM_PATH`; the process needs a desktop `DISPLAY`. The local `.env` must contain reachable LiveKit development credentials.
