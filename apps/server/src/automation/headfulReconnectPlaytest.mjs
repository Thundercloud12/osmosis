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
process.env.ENABLE_TEST_ROOM_MODES = "true";

const browserBinary = process.env.CHROMIUM_PATH || "chromium";
const profileDir = await mkdtemp("/tmp/osmosis-reconnect-chromium-");
const screenshotPath = "/tmp/osmosis-headful-reconnect.png";
const [gamePort, webPort, debugPort] = await Promise.all([freePort(), freePort(), freePort()]);
const gameUrl = `http://127.0.0.1:${gamePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
process.env.CLIENT_ORIGINS = `${webOrigin},http://localhost:${webPort}`;
const { server } = await import("../app.config.ts");
const { activeArenaRooms } = await import("../rooms/ArenaRoom.ts");

let webProcess;
let browserProcess;
let page;
let companionRoom;

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

async function waitForDebugServerClosed() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) {
        await delay(100);
        continue;
      }
    } catch { return; }
  }
  throw new Error("Chromium did not close its remote-debugging endpoint");
}

async function closeChromiumGracefully() {
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });
  socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  await waitForDebugServerClosed();
  socket.close();
  await Promise.race([
    new Promise((resolveExit) => browserProcess.once("exit", resolveExit)),
    delay(2_000),
  ]);
}

async function startChromium() {
  browserProcess = spawn(browserBinary, [
    "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-timer-throttling",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`, "--window-size=1280,900", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { detached: true, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, browserProcess, "headful Chromium");
}

async function stopProcessGroup(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(4_000),
  ]);
}

async function openBrowserPage(url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  assert.equal(response.status, 200, "headful Chromium should create a tab");
  const browserPage = new DevtoolsPage(await response.json());
  await browserPage.initialize(url);
  return browserPage;
}

async function waitForServerState(predicate, description, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for server state: ${description}`);
}

async function main() {
  assert.ok(process.env.DISPLAY, "Headful Chromium needs a desktop DISPLAY");
  await server.listen(gamePort);

  webProcess = spawn(process.execPath, [resolve(repoDir, "apps/web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort)], {
    cwd: resolve(repoDir, "apps/web"),
    env: { ...process.env, ENABLE_TEST_ROOM_MODES: "true", VITE_GAME_SERVER_URL: gameUrl, VITE_ENABLE_TEST_ROOM_MODES: "true" },
    detached: true,
    stdio: "ignore",
  });
  await waitForHttp(webOrigin, webProcess, "Vite dev server");
  await startChromium();

  page = await openBrowserPage(webOrigin);
  await page.waitFor("Boolean(document.querySelector('#nickname') && document.querySelector('#room-mode'))", "the room creation screen");
  await page.evaluate(`(() => {
    const nickname = document.querySelector('#nickname');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nickname, 'Reconnect Crew');
    nickname.dispatchEvent(new Event('input', { bubbles: true }));
    const roomMode = document.querySelector('#room-mode');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(roomMode, 'TEST_1V1');
    roomMode.dispatchEvent(new Event('change', { bubbles: true }));
    return roomMode.value;
  })()`);
  await page.waitFor("document.querySelector('#room-mode')?.value === 'TEST_1V1'", "the 1v1 test mode selection");
  await page.evaluate("document.querySelector('.play-button')?.click()");
  await page.waitFor("document.querySelector('.room-chip strong')?.textContent?.trim().length === 6", "the browser-created room");
  const roomCode = await page.evaluate("document.querySelector('.room-chip strong').textContent.trim()");

  const companion = new Client(gameUrl);
  companionRoom = await companion.joinById(roomCode, { nickname: "Reconnect Buddy" });
  companionRoom.onMessage("lobbySnapshot", () => undefined);
  companionRoom.onMessage("snapshot", () => undefined);
  await page.waitFor("document.querySelector('.player-count')?.innerText.includes('2/2')", "the second 1v1 player");
  const room = activeArenaRooms.get(roomCode);
  assert.ok(room, "the room should be registered on the server");
  const browserEntry = [...room.players.entries()].find(([, player]) => player.nickname === "Reconnect Crew");
  const companionEntry = [...room.players.entries()].find(([, player]) => player.nickname === "Reconnect Buddy");
  assert.ok(browserEntry && companionEntry, "the browser and companion should occupy the two room seats");
  const [browserSessionId, browserPlayer] = browserEntry;
  const [, companionPlayer] = companionEntry;
  const originalPlayerId = browserPlayer.id;
  browserPlayer.points = 8_725;
  room.phase = "PLAYING";
  room.matchDeadline = performance.now() + 120_000;
  room.sendSnapshots();
  await page.waitFor("document.querySelector('.match-hud') && document.body.innerText.includes('8,725')", "the browser match HUD and assigned points");
  const leaveButtonClear = await page.evaluate(`(() => {
    const button = document.querySelector('.match-leave-button').getBoundingClientRect();
    const hudCards = [...document.querySelectorAll('.match-clock, .match-score-card')].map((element) => element.getBoundingClientRect());
    return hudCards.every((card) => button.right <= card.left || button.left >= card.right || button.bottom <= card.top || button.top >= card.bottom);
  })()`);
  assert.equal(leaveButtonClear, true, "the in-match leave control should not overlap the score cards or timer");
  const tokenExists = await page.evaluate(`Boolean(localStorage.getItem('osmosis:reconnect:${roomCode}'))`);
  assert.equal(tokenExists, true, "the reconnect token should be stored persistently before closing Chromium");

  await page.screenshot(screenshotPath);
  await closeChromiumGracefully();
  browserProcess = undefined;
  page = undefined;
  await waitForDebugServerClosed();
  await waitForServerState(() => !browserPlayer.connected, "the server to observe the browser disconnect");
  assert.equal(browserPlayer.status, "DISCONNECTED");
  assert.ok(browserPlayer.reconnectUntil > performance.now() + 119_000, "the server should reserve the dropped seat for 120 seconds");
  assert.equal(room.hostPlayerId, companionPlayer.id, "the host should transfer while the browser player is disconnected");

  await startChromium();
  page = await openBrowserPage(`${webOrigin}/?room=${roomCode}`);
  await page.waitFor("document.querySelector('.match-hud') && document.body.innerText.includes('8,725') && !document.querySelector('.connection-banner')", "the same match and points to return after a full Chromium restart", 30_000);
  await waitForServerState(() => browserPlayer.connected, "the original player identity to reconnect");
  assert.equal(browserPlayer.id, originalPlayerId, "the restored player ID must be unchanged");
  assert.equal(browserPlayer.points, 8_725, "the restored player points must be unchanged");
  assert.equal(browserPlayer.status, "ACTIVE", "the restored player should recover their prior status");
  assert.equal(browserPlayer.reconnectUntil, undefined, "the reconnect reservation should clear on success");
  assert.equal(room.hostPlayerId, companionPlayer.id, "the returning host must not reclaim a transferred role");
  assert.equal(room.clients.length, 2, "reconnection must restore one seat rather than create a duplicate");
  const tokenStillPresent = await page.evaluate(`Boolean(localStorage.getItem('osmosis:reconnect:${roomCode}'))`);
  assert.equal(tokenStillPresent, true, "the refreshed token should remain available after reconnect");

  await page.evaluate("document.querySelector('.match-leave-button')?.click()");
  await page.waitFor("document.querySelector('[role=dialog]') !== null", "the in-match leave confirmation");
  await page.evaluate("[...document.querySelectorAll('[role=dialog] button')].find((button) => button.innerText.includes('LEAVE ROOM'))?.click()");
  await page.waitFor("document.querySelector('#nickname') !== null", "the home screen after an explicit leave");
  const tokenCleared = await page.evaluate(`localStorage.getItem('osmosis:reconnect:${roomCode}') === null`);
  assert.equal(tokenCleared, true, "explicit leave should clear the persistent reconnect token");
  assert.equal(browserPlayer.connected, false, "explicit leave should mark the in-match player disconnected");
  assert.equal(browserPlayer.reconnectUntil, undefined, "explicit leave should not create a reconnect reservation");

  console.log(JSON.stringify({
    result: "PASS",
    roomMode: "TEST_1V1",
    browserRestartReconnect: "same player ID, ACTIVE state and 8,725 points restored",
    disconnectedHostTransfer: "companion retained host after browser reconnected",
    duplicateSeat: false,
    explicitLeave: "confirmation shown; persistent token cleared; no reconnect reservation",
    leaveButtonClearOfHud: leaveButtonClear,
    screenshotPath,
  }, null, 2));
}

try {
  await main();
} finally {
  if (page) await page.close();
  await companionRoom?.leave().catch(() => undefined);
  await stopProcessGroup(browserProcess);
  await stopProcessGroup(webProcess);
  await server.gracefullyShutdown(false).catch(() => undefined);
  await rm(profileDir, { recursive: true, force: true });
}
