import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoDir = resolve(packageDir, "../..");
const { Client } = await import("@colyseus/sdk");
const { TEAM_BASES, TEAM_HQ_POLES, TEAM_SPAWNS } = await import("@osmosis/shared");

const browserBinary = process.env.CHROMIUM_PATH || "chromium";
const screenshotPath = "/tmp/osmosis-headful-spectator.png";
const resultsScreenshotPath = "/tmp/osmosis-headful-results.png";
const tagFeedbackScreenshotPath = "/tmp/osmosis-headful-tag-feedback.png";
const raidFeedbackScreenshotPath = "/tmp/osmosis-headful-raid-feedback.png";
const raidCompleteFeedbackScreenshotPath = "/tmp/osmosis-headful-raid-complete-feedback.png";
const poleFeedbackScreenshotPath = "/tmp/osmosis-headful-pole-feedback.png";
const browserProfile = await mkdtemp("/tmp/osmosis-spectator-chromium-");
const [gamePort, webPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()]);
const gameUrl = `http://127.0.0.1:${gamePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
process.env.CLIENT_ORIGINS = `${webOrigin},http://localhost:${webPort}`;

const { server } = await import("../app.config.ts");
const { activeArenaRooms } = await import("../rooms/ArenaRoom.ts");

let webProcess;
let browserProcess;
let page;
const bots = [];

class DevtoolsPage {
  constructor(target) {
    this.id = target.id;
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
    const state = await this.evaluate("JSON.stringify({url:location.href,text:document.body.innerText.slice(-500)})");
    throw new Error(`Timed out waiting for ${description}: ${state}`);
  }

  async screenshot(path) {
    const response = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(response.result.data, "base64"));
  }

  close() {
    this.socket.close();
    return fetch(`http://127.0.0.1:${debugPort}/json/close/${this.id}`).catch(() => undefined);
  }
}

class SimulatedPlayer {
  constructor(room, nickname) {
    this.room = room;
    this.nickname = nickname;
    this.latestLobby = undefined;
    this.latestSnapshot = undefined;
    this.sequence = 0;
    room.onMessage("lobbySnapshot", (snapshot) => { this.latestLobby = snapshot; });
    room.onMessage("snapshot", (snapshot) => { this.latestSnapshot = snapshot; });
    room.onMessage("commandError", (payload) => {
      if (payload?.message) this.lastCommandError = payload.message;
    });
  }

  command(payload) { this.room.send("command", payload); }
  move(dx, dy) { this.room.send("move", { type: "move", seq: this.sequence++, dx, dy }); }

  async until(predicate, description, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.latestSnapshot && predicate(this.latestSnapshot)) return this.latestSnapshot;
      if (this.latestLobby && predicate(this.latestLobby)) return this.latestLobby;
      await delay(25);
    }
    throw new Error(`${this.nickname}: timed out waiting for ${description}`);
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

async function openBrowserPage(url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  assert.equal(response.status, 200, "headful Chromium should create a tab");
  const target = await response.json();
  const browserPage = new DevtoolsPage(target);
  await browserPage.initialize(url);
  return browserPage;
}

async function stopProcessGroup(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
}

async function main() {
  assert.ok(process.env.DISPLAY, "Headful Chromium needs a desktop DISPLAY");
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
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`, "--window-size=1280,900", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { detached: true, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, browserProcess, "headful Chromium");

  const client = new Client(gameUrl);
  const hostRoom = await client.create("arena", { nickname: "Bot-1", roomMode: "STANDARD" });
  bots.push(new SimulatedPlayer(hostRoom, "Bot-1"));
  const roomCode = hostRoom.roomId;
  for (let index = 2; index <= 9; index += 1) {
    const room = await client.joinById(roomCode, { nickname: `Bot-${index}` });
    bots.push(new SimulatedPlayer(room, `Bot-${index}`));
  }

  page = await openBrowserPage(`${webOrigin}/?room=${roomCode}&spectatorDebug=1`);
  await page.waitFor("document.querySelector('.player-count')?.innerText.includes('10/10')", "all ten roster slots to fill");
  for (const bot of bots) {
    await bot.until((snapshot) => snapshot.players?.length === 10, "ten-player lobby roster");
  }

  const room = activeArenaRooms.get(roomCode);
  assert.ok(room, "the authoritative arena room should be registered");
  const state = room;
  const players = state.players;
  const blueRoster = [...players.values()].filter((player) => player.teamId === "BLUE").sort((a, b) => a.joinOrder - b.joinOrder);
  const redRoster = [...players.values()].filter((player) => player.teamId === "RED").sort((a, b) => a.joinOrder - b.joinOrder);
  assert.equal(blueRoster.length, 5);
  assert.equal(redRoster.length, 5);

  for (const teamId of ["BLUE", "RED"]) {
    const captainPlayer = teamId === "BLUE" ? blueRoster[0] : redRoster[0];
    const captain = bots.find((bot) => bot.room.sessionId === [...players.entries()].find(([, player]) => player.id === captainPlayer.id)?.[0]);
    assert.ok(captain, `${teamId} captain must be a simulated client`);
    captain.command({ type: "captain", action: "claim" });
    await captain.until((snapshot) => snapshot.captainIds?.[teamId] === captainPlayer.id, `${teamId} captain claim`);
  }

  const host = bots[0];
  host.command({ type: "beginAllocation" });
  await host.until((snapshot) => snapshot.phase === "ALLOCATION", "point allocation phase");
  const blueCaptain = bots.find((bot) => bot.room.sessionId === [...players.entries()].find(([, player]) => player.id === blueRoster[0].id)?.[0]);
  const blueAllocation = Object.fromEntries(blueRoster.map((player) => [player.id, 2_000]));
  blueCaptain.command({ type: "allocate", pointsByPlayerId: blueAllocation });
  for (const teamId of ["BLUE", "RED"]) {
    const captainPlayer = teamId === "BLUE" ? blueRoster[0] : redRoster[0];
    const captain = bots.find((bot) => bot.room.sessionId === [...players.entries()].find(([, player]) => player.id === captainPlayer.id)?.[0]);
    captain.command({ type: "lockAllocation" });
  }
  await host.until((snapshot) => snapshot.allocationComplete, "both team allocations to lock");
  for (const bot of bots) bot.command({ type: "ready", ready: true });
  await page.waitFor("[...document.querySelectorAll('button')].some((button) => button.innerText.includes('READY UP') && !button.disabled)", "browser ready control");
  await page.evaluate("(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('READY UP') && !item.disabled); button?.click(); return Boolean(button); })()");
  await host.until((snapshot) => snapshot.players?.every((player) => player.ready), "all ten players to ready up");
  host.command({ type: "startCountdown" });
  await host.until((snapshot) => snapshot.phase === "COUNTDOWN", "match countdown");
  await Promise.all(bots.map((bot) => bot.until((snapshot) => snapshot.phase === "PLAYING", "match start", 12_000)));
  await page.waitFor("document.querySelector('.match-hud') !== null", "browser client to enter the match");

  const spectator = [...players.values()].find((player) => player.nickname === "Crew");
  assert.ok(spectator, "headful browser player should join as the tenth crewmate");
  assert.equal(spectator.teamId, "RED", "the tenth join should be on RED in a standard 5v5 room");

  // A seeded, short bot policy sends normal movement messages through the Colyseus clients.
  const beforeBotWalk = new Map([...players.values()].map((player) => [player.id, { x: player.x, y: player.y }]));
  for (let step = 0; step < 4; step += 1) {
    for (const bot of bots) {
      const botPlayer = players.get(bot.room.sessionId);
      const dx = botPlayer.teamId === "BLUE" ? 1 : -1;
      bot.move(dx, step % 2 === 0 ? 1 : 0);
    }
    await delay(350);
  }
  for (const bot of bots) bot.move(0, 0);
  await delay(700);
  const movedBotCount = bots.filter((bot) => {
    const player = players.get(bot.room.sessionId);
    const before = beforeBotWalk.get(player.id);
    return Math.hypot(player.x - before.x, player.y - before.y) > 40;
  }).length;
  assert.ok(movedBotCount >= 8, `at least eight bots should move through the authoritative simulator (moved ${movedBotCount})`);

  // Force one normal tag through the room resolver and capture the Phaser feedback while visible.
  const blueOpponent = blueRoster[0];
  const blueOpponentBot = bots.find((bot) => bot.room.sessionId === [...players.entries()].find(([, player]) => player.id === blueOpponent.id)?.[0]);
  spectator.x = 3_000; spectator.y = 3_000; spectator.points = 3_000; spectator.status = "ACTIVE";
  blueOpponent.x = 3_024; blueOpponent.y = 3_000; blueOpponent.points = 4_000; blueOpponent.status = "ACTIVE";
  spectator.inactiveUntil = 0; blueOpponent.inactiveUntil = 0;
  state.activeContactPairs.clear();
  state.resolveContacts();
  state.sendSnapshots();
  await page.waitFor("document.querySelector('.match-clock small')?.innerText === 'INACTIVE'", "browser player to see the confirmed tag result");
  await delay(100);
  await page.screenshot(tagFeedbackScreenshotPath);
  assert.equal(spectator.points, 2_500, "lower-scoring player should lose the normal 500-point transfer");
  assert.equal(spectator.status, "INACTIVE", "battle participants should enter the ordinary inactivity state");

  // Start and complete a raid through the server path so both Phaser states can be captured.
  state.poleHolders.BLUE = undefined;
  state.poleHolders.RED = undefined;
  spectator.x = TEAM_BASES.BLUE.x + 80; spectator.y = TEAM_BASES.BLUE.y + 100;
  spectator.points = 2_500; spectator.status = "ACTIVE"; spectator.inactiveUntil = 0;
  state.activeContactPairs.clear();
  state.setInteraction(spectator, true);
  state.sendSnapshots();
  await page.waitFor("document.querySelector('.raid-meter strong')?.innerText === 'BASE RAID'", "browser raider to see channel progress");
  await page.screenshot(raidFeedbackScreenshotPath);
  const raidStartedAt = state.activeRaids.RED.startedAt;
  state.advanceRaids(raidStartedAt + 3_001);
  state.sendSnapshots();
  await page.waitFor("document.querySelector('.match-score-card small')?.innerText.includes('4,500')", "browser raider to receive raid points");
  await page.screenshot(raidCompleteFeedbackScreenshotPath);
  assert.equal(spectator.raidsCompleted, 1, "a completed raid should update the server-owned statistic");

  // Exercise the new mobile-INACTIVE rule and its three-second active-player freeze in the real room.
  state.poleHolders.BLUE = undefined;
  state.poleHolders.RED = undefined;
  for (const player of players.values()) {
    player.dx = 0;
    player.dy = 0;
    player.pendingMoves.length = 0;
    player.frozenUntil = 0;
  }
  spectator.x = 3_000;
  spectator.y = 3_000;
  spectator.status = "INACTIVE";
  spectator.inactiveUntil = performance.now() + 15_000;
  blueOpponent.x = 3_024;
  blueOpponent.y = 3_000;
  blueOpponent.status = "ACTIVE";
  blueOpponent.points = 1_000;
  spectator.points = 2_000;
  state.activeContactPairs.clear();
  state.resolveContacts();
  state.sendSnapshots();
  const freezeStartedAt = blueOpponent.frozenUntil;
  assert.ok(freezeStartedAt > performance.now(), "active toucher should receive a server freeze deadline");
  assert.equal(spectator.status, "INACTIVE", "contact must not tag the already inactive player");
  assert.equal(blueOpponent.status, "ACTIVE", "freeze must not convert the toucher to INACTIVE");
  const frozenSnapshot = await blueOpponentBot.until((snapshot) =>
    snapshot.players?.find((player) => player.id === blueOpponent.id)?.frozenSecondsRemaining !== undefined,
    "the active bot to receive its private freeze timer",
  );
  assert.equal(frozenSnapshot.players.find((player) => player.id === blueOpponent.id)?.status, "ACTIVE");

  await page.waitFor("document.querySelector('.match-clock small')?.innerText === 'INACTIVE'", "browser player to see their inactive state");
  const inactiveStartY = spectator.y;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 640, y: 450, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 450, button: "left", clickCount: 1 });
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
  await delay(900);
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
  assert.ok(spectator.y < inactiveStartY - 60, "inactive browser player should move through normal WASD input");

  const frozenX = blueOpponent.x;
  blueOpponentBot.move(1, 0);
  await delay(450);
  assert.equal(blueOpponent.x, frozenX, "normal movement input should not move the frozen active player");
  await delay(Math.max(0, blueOpponent.frozenUntil - performance.now()) + 100);
  blueOpponentBot.move(1, 0);
  await delay(450);
  blueOpponentBot.move(0, 0);
  assert.ok(blueOpponent.x > frozenX + 50, "the active player should move again when the three-second freeze expires");

  // Reset only the scenario actors, then trigger the real room contact resolver at the enemy pole.
  for (const player of players.values()) {
    const spawn = TEAM_SPAWNS[player.teamId];
    player.x = spawn.x;
    player.y = spawn.y + Math.max(0, player.joinOrder >> 1) * 65;
    player.dx = 0;
    player.dy = 0;
    player.pendingMoves.length = 0;
    player.frozenUntil = 0;
    if (player.status !== "ELIMINATED") {
      player.status = "ACTIVE";
      player.inactiveUntil = 0;
    }
  }
  const holder = blueRoster[0];
  const pole = TEAM_HQ_POLES.BLUE;
  const target = redRoster[0];
  holder.x = pole.x;
  holder.y = pole.y;
  holder.points = 500;
  spectator.x = pole.x + 24;
  spectator.y = pole.y;
  spectator.points = 2_000;
  state.activeContactPairs.clear();
  state.reconcilePoleHolders();
  assert.equal(state.poleHolders.BLUE, holder.id, "the Blue bot should hold its home pole with a positive balance");

  // Put the browser camera beside the pole before the attacker is eliminated.
  spectator.x = pole.x + 96;
  state.sendSnapshots();
  await delay(180);
  const sendSnapshots = state.sendSnapshots.bind(state);
  state.sendSnapshots = () => {};
  spectator.x = pole.x + 24;
  state.resolveContacts();
  // Capture the pole impact while the browser camera is still at the collision.
  // Normal snapshots are briefly paused so the camera cannot switch targets first.
  await delay(100);
  await page.screenshot(poleFeedbackScreenshotPath);
  state.sendSnapshots = sendSnapshots;
  state.finishIfTeamEliminated();
  state.sendSnapshots();

  await page.waitFor(
    "document.querySelector('.match-state-badge strong')?.innerText === 'SPECTATING' && document.querySelector('.match-clock small')?.innerText === 'ELIMINATED'",
    "eliminated browser player to enter spectator mode",
  );
  assert.equal(spectator.status, "ELIMINATED");
  const viewState = await page.evaluate("window.__osmosisSpectatorDebug?.()");
  assert.equal(viewState.status, "ELIMINATED");
  assert.equal(viewState.targetId, target.id, "spectator should follow the first living teammate by roster order");
  assert.equal(viewState.followsTarget, true, "Phaser camera should follow the teammate, not the eliminated avatar");
  assert.equal(viewState.eliminatedAvatarVisible, false, "eliminated avatar should be hidden");
  assert.equal(viewState.targetAvatarVisible, true, "the followed teammate should be rendered");

  const beforeTargetMove = viewState.target;
  const beforeCameraCenter = viewState.cameraCenter;
  const targetBot = bots.find((bot) => bot.room.sessionId === [...players.entries()].find(([, player]) => player.id === target.id)?.[0]);
  targetBot.move(0, 1);
  await delay(1_400);
  targetBot.move(0, 0);
  await delay(300);
  const afterFollowMove = await page.evaluate("window.__osmosisSpectatorDebug?.()");
  assert.ok(afterFollowMove.target.y > beforeTargetMove.y + 60, "teammate should visibly move during the spectator check");
  assert.ok(afterFollowMove.cameraCenter.y > beforeCameraCenter.y + 40, "spectator camera should move with the teammate");
  assert.ok(Math.abs(afterFollowMove.cameraCenter.y - afterFollowMove.target.y) < 100, "camera should remain centered near the teammate");
  assert.match(await page.evaluate("document.querySelector('.match-state-badge')?.innerText ?? ''"), /SPECTATING[\s\S]*Following Bot-2/);
  assert.equal(state.phase, "PLAYING", "the match should continue after one player is eliminated");

  const joinVoiceClicked = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('.voice-dock button')].find((item) => item.innerText === 'JOIN');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  assert.ok(joinVoiceClicked, "voice dock should expose its opt-in control");
  await page.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC OFF') || document.querySelector('.voice-error')", "browser voice connection to succeed or report an error", 30_000);
  const voiceJoinState = await page.evaluate(`({ joined: [...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC OFF'), error: document.querySelector('.voice-error')?.title })`);
  assert.equal(voiceJoinState.joined, true, `browser player should join team voice muted${voiceJoinState.error ? `: ${voiceJoinState.error}` : ""}`);
  const voiceLayout = await page.evaluate(`(() => {
    const dock = document.querySelector('.voice-dock').getBoundingClientRect();
    const radar = document.querySelector('.minimap-card').getBoundingClientRect();
    return { dockBottom: dock.bottom, radarTop: radar.top, dockRight: dock.right, viewportRight: innerWidth };
  })()`);
  assert.ok(voiceLayout.dockBottom <= voiceLayout.radarTop, "voice dock should sit above the minimap");
  assert.ok(voiceLayout.dockRight <= voiceLayout.viewportRight, "voice dock should stay inside the viewport");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await page.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC ON')", "V to enable the browser microphone", 10_000);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86 });
  await page.waitFor("[...document.querySelectorAll('.voice-dock button')].some((button) => button.innerText === 'MIC OFF')", "V to mute the browser microphone again", 10_000);
  await page.screenshot(screenshotPath);

  const expectedResultRoster = [...state.players.values()].map((player) => ({ nickname: player.nickname, points: player.points }))
    .sort((left, right) => left.nickname.localeCompare(right.nickname));
  const expectedTeamScores = {
    BLUE: [...state.players.values()].filter((player) => player.teamId === "BLUE").reduce((sum, player) => sum + player.points, 0),
    RED: [...state.players.values()].filter((player) => player.teamId === "RED").reduce((sum, player) => sum + player.points, 0),
  };
  state.finishMatch("RED");
  await page.waitFor("document.querySelector('.results-card') !== null", "browser player to see the final match results");
  const resultView = await page.evaluate(`(() => ({
    headline: document.querySelector('.results-card h1')?.innerText,
    blue: Number(document.querySelector('.result-blue strong')?.innerText.replace(/[^0-9-]/g, '')),
    red: Number(document.querySelector('.result-red strong')?.innerText.replace(/[^0-9-]/g, '')),
    players: [...document.querySelectorAll('.result-player')].map((row) => ({
      nickname: row.querySelector('.result-player-name strong')?.innerText,
      points: Number(row.querySelector('.result-player-points')?.innerText.replace(/[^0-9-]/g, '')),
    })).sort((left, right) => left.nickname.localeCompare(right.nickname)),
  }))()`);
  assert.match(resultView.headline, /Red crew wins/);
  assert.equal(resultView.blue, expectedTeamScores.BLUE, "Blue final total should equal the sum of its final player balances");
  assert.equal(resultView.red, expectedTeamScores.RED, "Red final total should equal the sum of its final player balances");
  assert.deepEqual(resultView.players, expectedResultRoster, "the result screen should show every player's exact final balance");
  await page.screenshot(resultsScreenshotPath);

  console.log(JSON.stringify({
    result: "PASS",
    roomCode,
    connectedPlayers: bots.length + 1,
    voiceMicToggle: "MIC OFF → MIC ON → MIC OFF",
    voiceDockAboveMinimap: voiceLayout.dockBottom <= voiceLayout.radarTop,
    results: { headline: resultView.headline, teamScores: expectedTeamScores, displayedPlayers: resultView.players.length },
    botWalkMoved: movedBotCount,
    spectator: spectator.nickname,
    eliminatedAvatarVisible: afterFollowMove.eliminatedAvatarVisible,
    followedPlayer: target.nickname,
    cameraFollowedMovement: {
      targetY: [beforeTargetMove.y, afterFollowMove.target.y],
      centerY: [beforeCameraCenter.y, afterFollowMove.cameraCenter.y],
    },
    screenshotPath,
    resultsScreenshotPath,
    tagFeedbackScreenshotPath,
    raidFeedbackScreenshotPath,
    raidCompleteFeedbackScreenshotPath,
    poleFeedbackScreenshotPath,
  }, null, 2));

  await page.close();
  page = undefined;
}

try {
  await main();
} finally {
  if (page) await page.close();
  await Promise.all(bots.map((bot) => bot.room.leave().catch(() => undefined)));
  await stopProcessGroup(browserProcess);
  await stopProcessGroup(webProcess);
  await server.gracefullyShutdown(false).catch(() => undefined);
  await rm(browserProfile, { recursive: true, force: true });
}
