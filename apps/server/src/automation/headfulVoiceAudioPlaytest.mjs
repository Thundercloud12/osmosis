import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoDir = resolve(packageDir, "../..");
const browserBinary = process.env.CHROMIUM_PATH || "chromium";
const tempDir = await mkdtemp("/tmp/osmosis-voice-audio-");
const browserProfile = resolve(tempDir, "chromium-profile");
const [gamePort, webPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()]);
const gameUrl = `http://127.0.0.1:${gamePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
process.env.CLIENT_ORIGINS = `${webOrigin},http://localhost:${webPort}`;

const { server } = await import("../app.config.ts");
const { activeArenaRooms } = await import("../rooms/ArenaRoom.ts");

let webProcess;
let browserProcess;
const pages = [];
let browserDevtools;

class DevtoolsBrowser {
  constructor(webSocketDebuggerUrl) {
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message);
    };
  }

  async initialize() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.onopen = resolveOpen;
      this.socket.onerror = rejectOpen;
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(new Error(`Chromium DevTools timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

class DevtoolsPage {
  constructor(target, contextId) {
    this.id = target.id;
    this.contextId = contextId;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message);
    };
  }

  async initialize(url) {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.onopen = resolveOpen;
      this.socket.onerror = rejectOpen;
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await this.send("Page.navigate", { url });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(new Error(`Chromium DevTools timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result.result.value;
  }

  async waitFor(expression, description, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await delay(100);
    }
    const state = await this.evaluate("JSON.stringify({url:location.href,text:document.body.innerText.slice(-400),voice:document.querySelector('.voice-dock')?.outerHTML})");
    throw new Error(`Timed out waiting for ${description}: ${state}`);
  }

  async close() {
    this.socket.close();
    await browserDevtools.send("Target.closeTarget", { targetId: this.id }).catch(() => undefined);
    await browserDevtools.send("Target.disposeBrowserContext", { browserContextId: this.contextId }).catch(() => undefined);
  }
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolveListen, rejectListen) => socket.listen(0, "127.0.0.1", resolveListen).once("error", rejectListen));
  const address = socket.address();
  await new Promise((resolveClose) => socket.close(resolveClose));
  return address.port;
}

async function waitForHttp(url, child, description) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${description} exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`${description} did not become ready at ${url}`);
}

async function openPage(url) {
  const contextResponse = await browserDevtools.send("Target.createBrowserContext", { disposeOnDetach: true });
  const contextId = contextResponse.result.browserContextId;
  const targetResponse = await browserDevtools.send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
  const targetId = targetResponse.result.targetId;
  let target;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    target = targets.find((item) => item.id === targetId);
    if (target?.webSocketDebuggerUrl) break;
    await delay(50);
  }
  assert.ok(target?.webSocketDebuggerUrl, "Chromium should expose the isolated tab through DevTools");
  const page = new DevtoolsPage(target, contextId);
  pages.push(page);
  await page.initialize(url);
  return page;
}

async function click(page, selector) {
  const clicked = await page.evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.click(); return true; })()`);
  assert.ok(clicked, `expected a clickable element matching ${selector}`);
}

async function clickButtonText(page, text) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.voice-dock button')].find((item) => item.innerText.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.ok(clicked, `expected an enabled voice button labelled ${text}`);
}

async function pressV(page) {
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
}

async function joinVoice(page, label) {
  await page.waitFor("document.querySelector('.voice-dock button')?.innerText === 'JOIN TEAM'", `${label} team voice join control`);
  await click(page, ".voice-dock button");
  await page.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC OFF') || document.querySelector('.voice-error')", `${label} to join team voice`, 30_000);
  const state = await page.evaluate(`({ joined: [...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC OFF'), error: document.querySelector('.voice-error')?.title })`);
  assert.equal(state.joined, true, `${label} voice join failed${state.error ? `: ${state.error}` : ""}`);
}

async function stopProcessGroup(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
}

async function main() {
  assert.ok(process.env.DISPLAY, "Headful Chromium needs a desktop DISPLAY");
  assert.ok(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET,
    "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to run the voice delivery check");
  await server.listen(gamePort);

  webProcess = spawn(process.execPath, [resolve(repoDir, "apps/web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort)], {
    cwd: resolve(repoDir, "apps/web"),
    env: { ...process.env, VITE_GAME_SERVER_URL: gameUrl },
    detached: true,
    stdio: "ignore",
  });
  await waitForHttp(webOrigin, webProcess, "Vite dev server");

  browserProcess = spawn(browserBinary, [
    "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-timer-throttling",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`, "--window-size=1280,900", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { detached: true, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, browserProcess, "headful Chromium");
  const browserInfo = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json());
  browserDevtools = new DevtoolsBrowser(browserInfo.webSocketDebuggerUrl);
  await browserDevtools.initialize();

  const creator = await openPage(webOrigin);
  await creator.waitFor("document.querySelector('#room-mode') !== null", "room-size selector");
  await creator.evaluate(`(() => {
    const select = document.querySelector('#room-mode');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'TEST_2V2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await creator.waitFor("document.querySelector('#room-mode')?.value === 'TEST_2V2'", "2v2 test room selection");
  await click(creator, ".play-button");
  await creator.waitFor("document.querySelector('.room-chip strong')?.innerText.length === 6", "2v2 room creation");
  const roomCode = await creator.evaluate("document.querySelector('.room-chip strong').innerText");

  const opponent = await openPage(`${webOrigin}/?room=${roomCode}`);
  await opponent.waitFor(`document.querySelector('.room-chip strong')?.innerText === '${roomCode}'`, "opposing browser to join the room");
  const teammate = await openPage(`${webOrigin}/?room=${roomCode}`);
  await teammate.waitFor(`document.querySelector('.room-chip strong')?.innerText === '${roomCode}'`, "same-team browser to join the room");

  await creator.waitFor("document.querySelector('.voice-dock button')?.innerText === 'JOIN TEAM'", "creator voice control");
  const room = activeArenaRooms.get(roomCode);
  assert.ok(room, "the created room should be active on the server");
  const rosterDeadline = Date.now() + 15_000;
  while (room.players.size < 3 && Date.now() < rosterDeadline) await delay(100);
  if (room.players.size < 3) {
    const browserStates = await Promise.all([creator, opponent, teammate].map((page) => page.evaluate("({ url: location.href, text: document.body.innerText.slice(-240) })")));
    throw new Error(`Expected three authoritative room members; found ${room.players.size}. Browser states: ${JSON.stringify(browserStates)}`);
  }
  const roster = [...room.players.values()].sort((left, right) => left.joinOrder - right.joinOrder);
  assert.equal(roster.length, 3, "two browsers and one opposing browser should be in the 2v2 test room");
  assert.equal(roster[0].teamId, "BLUE", "the room creator should be on Blue");
  assert.equal(roster[1].teamId, "RED", "the second browser should be on Red");
  assert.equal(roster[2].teamId, "BLUE", "the third browser should join Blue with the creator");

  await Promise.all([
    joinVoice(creator, "Blue sender"),
    joinVoice(opponent, "Red listener"),
    joinVoice(teammate, "Blue listener"),
  ]);
  const syntheticMic = await creator.evaluate(`(async () => {
    const devices = navigator.mediaDevices;
    const originalGetUserMedia = devices.getUserMedia.bind(devices);
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.resume();
    const carrier = context.createOscillator();
    const envelope = context.createOscillator();
    const envelopeGain = context.createGain();
    const micGain = context.createGain();
    const destination = context.createMediaStreamDestination();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 185;
    envelope.frequency.value = 3;
    envelopeGain.gain.value = 0.12;
    micGain.gain.value = 0.18;
    envelope.connect(envelopeGain);
    envelopeGain.connect(micGain.gain);
    carrier.connect(micGain);
    micGain.connect(destination);
    carrier.start();
    envelope.start();
    devices.getUserMedia = async (constraints) => constraints?.audio
      ? new MediaStream(destination.stream.getAudioTracks().map((track) => track.clone()))
      : originalGetUserMedia(constraints);
    window.__osmosisSyntheticMic = { context, carrier, envelope };
    return { contextState: context.state, audioTracks: destination.stream.getAudioTracks().length };
  })()`);
  assert.equal(syntheticMic.contextState, "running", "synthetic microphone signal should be running");
  assert.equal(syntheticMic.audioTracks, 1, "synthetic microphone should expose one audio track");
  const senderId = roster[0].id;
  await pressV(creator);
  await creator.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC ON')", "Blue sender microphone to unmute", 10_000);

  const senderIdentity = JSON.stringify(senderId);
  await teammate.waitFor(`document.querySelector('audio[data-voice-channel="TEAM"][data-voice-identity="${senderId}"]') !== null`, "same-team listener to receive the Blue audio track", 30_000);
  await delay(750);
  const receivedAudio = await teammate.evaluate(`(async () => {
    const audio = document.querySelector('audio[data-voice-channel="TEAM"][data-voice-identity=${senderIdentity}]');
    const stream = audio?.srcObject;
    if (!(stream instanceof MediaStream)) return { error: 'remote audio element has no MediaStream' };
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return { error: 'remote stream has no audio track' };
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentOutput = context.createGain();
    analyser.fftSize = 2048;
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    const samples = new Uint8Array(analyser.fftSize);
    let peakRms = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const centered = (sample - 128) / 128; sum += centered * centered; }
      peakRms = Math.max(peakRms, Math.sqrt(sum / samples.length));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    source.disconnect();
    await context.close();
    return { identity: audio.dataset.voiceIdentity, trackState: audioTrack.readyState, trackEnabled: audioTrack.enabled, peakRms };
  })()`);
  assert.equal(receivedAudio.identity, senderId, "the same-team listener should receive the sender's audio track");
  assert.equal(receivedAudio.trackState, "live");
  assert.equal(receivedAudio.trackEnabled, true);
  assert.ok(receivedAudio.peakRms > 0.005, `same-team audio should contain a non-silent signal (peak RMS ${receivedAudio.peakRms})`);

  await delay(1_500);
  const opponentTracks = await opponent.evaluate("[...document.querySelectorAll('audio[data-voice-identity]')].map((audio) => audio.dataset.voiceIdentity)");
  assert.equal(opponentTracks.includes(senderId), false, "the opposing team must not receive the Blue sender's audio track");
  assert.equal(opponentTracks.length, 0, "the opposing voice room should have no subscribed audio while Red is muted");

  await clickButtonText(opponent, "GLOBAL OFF");
  await opponent.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText.trim() === 'GLOBAL ON')", "Red player to opt into Global voice");
  await clickButtonText(creator, "TALK: TEAM");
  await creator.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText.trim() === 'TALK: GLOBAL')", "Blue sender to select Global transmission");
  await creator.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText.trim() === 'MIC OFF')", "Global microphone control after channel switch");
  await pressV(creator);
  await creator.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText.trim() === 'MIC ON')", "Blue sender to enable Global microphone");
  await opponent.waitFor(`document.querySelector('audio[data-voice-channel="GLOBAL"][data-voice-identity="${senderId}"]') !== null`, "opted-in opponent to receive Global audio", 30_000);

  const receivedGlobalAudio = await opponent.evaluate(`(async () => {
    const audio = document.querySelector('audio[data-voice-channel="GLOBAL"][data-voice-identity=${senderIdentity}]');
    const stream = audio?.srcObject;
    if (!(stream instanceof MediaStream)) return { error: 'global audio element has no MediaStream' };
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return { error: 'global stream has no audio track' };
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentOutput = context.createGain();
    analyser.fftSize = 2048;
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    const samples = new Uint8Array(analyser.fftSize);
    let peakRms = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const centered = (sample - 128) / 128; sum += centered * centered; }
      peakRms = Math.max(peakRms, Math.sqrt(sum / samples.length));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    source.disconnect();
    await context.close();
    return { identity: audio.dataset.voiceIdentity, trackState: audioTrack.readyState, trackEnabled: audioTrack.enabled, peakRms };
  })()`);
  assert.equal(receivedGlobalAudio.identity, senderId, "the opposing listener should receive the Global sender's audio");
  assert.equal(receivedGlobalAudio.trackState, "live");
  assert.equal(receivedGlobalAudio.trackEnabled, true);
  assert.ok(receivedGlobalAudio.peakRms > 0.005, `global audio should contain a non-silent signal (peak RMS ${receivedGlobalAudio.peakRms})`);

  await delay(500);
  const blueGlobalTracksBeforeOptIn = await teammate.evaluate(`document.querySelectorAll('audio[data-voice-channel="GLOBAL"][data-voice-identity="${senderId}"]').length`);
  assert.equal(blueGlobalTracksBeforeOptIn, 0, "a teammate who has not opted into Global must not receive its audio track");
  await clickButtonText(teammate, "GLOBAL OFF");
  await teammate.waitFor(`document.querySelector('audio[data-voice-channel="GLOBAL"][data-voice-identity="${senderId}"]') !== null`, "Blue teammate to opt into Global audio", 30_000);

  await clickButtonText(teammate, "DEAFEN");
  const deafenedAudio = await teammate.evaluate(`[...document.querySelectorAll('audio[data-voice-channel]')].every((audio) => audio.muted)`);
  assert.equal(deafenedAudio, true, "DEAFEN should mute received Team and Global audio");
  await clickButtonText(teammate, "DEAFENED");
  const undeafenedAudio = await teammate.evaluate(`[...document.querySelectorAll('audio[data-voice-channel]')].every((audio) => !audio.muted)`);
  assert.equal(undeafenedAudio, true, "turning DEAFEN off should restore Team and Global audio");

  await clickButtonText(teammate, "GLOBAL ON");
  await teammate.waitFor(`document.querySelector('audio[data-voice-channel="GLOBAL"][data-voice-identity="${senderId}"]') === null`, "Global opt-out to unsubscribe the audio track");
  const teamTrackRemains = await teammate.evaluate(`document.querySelector('audio[data-voice-channel="TEAM"][data-voice-identity="${senderId}"]') !== null`);
  assert.equal(teamTrackRemains, true, "opting out of Global must preserve the private Team audio session");

  console.log(JSON.stringify({
    result: "PASS",
    roomCode,
    teamAssignments: roster.map(({ nickname, teamId }) => ({ nickname, teamId })),
    sameTeamAudio: receivedAudio,
    globalAudio: receivedGlobalAudio,
    opposingTeamAudioTracks: opponentTracks.length,
    globalOptIn: "opponent and teammate received Global audio only after opting in",
    globalOptOut: "Global track unsubscribed while Team track remained",
    fullDeafen: "muted Team and Global audio together",
    syntheticInput: "modulated 185 Hz synthetic microphone stream",
  }, null, 2));
}

try {
  await main();
} finally {
  await Promise.all(pages.map((page) => page.close()));
  await stopProcessGroup(browserProcess);
  await stopProcessGroup(webProcess);
  await server.gracefullyShutdown(false).catch(() => undefined);
  await rm(tempDir, { recursive: true, force: true });
}
