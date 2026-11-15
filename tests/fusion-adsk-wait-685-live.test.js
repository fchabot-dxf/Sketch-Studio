// tests/fusion-adsk-wait-685-live.test.js — TASK 685: live CDP verification of waiting for async window.adsk injection in Shaper Fusion mode.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/685');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '685-adsk-wait', width: 640, height: 480 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

async function shotBar(name) {
  const rect = await evalJs(`(() => {
    const r = document.getElementById('shaper-fusion-bar').getBoundingClientRect();
    return { x: Math.max(0, r.left - 12), y: Math.max(0, r.top - 12), width: Math.ceil(r.width + 24), height: Math.ceil(r.height + 24) };
  })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
}

try {
  // ---- 1. ?host=fusion without window.adsk -> shows Waiting, then injects window.adsk 1 s after load
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`document.readyState === 'complete' && !!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare bar ready after load');

  const initial = await evalJs(`({
    disabled: document.getElementById('btn-fusion-add-selection').disabled,
    status: document.getElementById('shaper-fusion-status').textContent,
    state: document.getElementById('shaper-fusion-status').dataset.state,
  })`);
  assert.strictEqual(initial.disabled, true, 'Add selection starts disabled while waiting');
  assert.strictEqual(initial.status, 'Waiting for Fusion…', 'initial status shows Waiting for Fusion…');
  assert.strictEqual(initial.state, 'waiting', 'initial state is waiting');
  await shotBar('fusion-waiting.png');

  // Inject window.adsk 1 s after load
  await new Promise((r) => setTimeout(r, 1000));
  await evalJs(`(() => {
    const sent = [];
    window.adsk = {
      _sent: sent,
      fusionSendData(action, data) { sent.push({ action, data }); },
    };
  })()`);

  await waitFor(`document.getElementById('btn-fusion-add-selection').disabled === false`, 'Add selection enables after late window.adsk injection');
  const afterInject = await evalJs(`({
    disabled: document.getElementById('btn-fusion-add-selection').disabled,
    status: document.getElementById('shaper-fusion-status').textContent,
    state: document.getElementById('shaper-fusion-status').dataset.state,
    sent: window.adsk._sent.slice(),
  })`);
  assert.strictEqual(afterInject.disabled, false, 'Add selection enabled once adsk appears');
  assert.strictEqual(afterInject.status, 'Connecting to Fusion…', 'status moves to Connecting to Fusion…');
  assert.strictEqual(afterInject.state, 'connecting', 'state is connecting before pong');
  assert.strictEqual(afterInject.sent.length, 1, 'boot ping sent once');
  assert.strictEqual(afterInject.sent[0].action, 'ping', 'boot ping action is ping');

  // Fake pong transitions to connected and stays at 1 ping
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Bracket Late v1' }))`);
  await new Promise((r) => setTimeout(r, 350));
  const afterPong = await evalJs(`({
    disabled: document.getElementById('btn-fusion-add-selection').disabled,
    status: document.getElementById('shaper-fusion-status').textContent,
    state: document.getElementById('shaper-fusion-status').dataset.state,
    sentLen: window.adsk._sent.length,
  })`);
  assert.strictEqual(afterPong.disabled, false, 'Add selection remains enabled');
  assert.strictEqual(afterPong.status, 'Connected to Fusion: Bracket Late v1', 'status updated by pong');
  assert.strictEqual(afterPong.state, 'connected', 'state is connected');
  assert.strictEqual(afterPong.sentLen, 1, 'no duplicate boot pings sent');
  await shotBar('fusion-connected.png');

  // ---- 2. ?host=fusion where window.adsk NEVER appears -> unavailable after ~15 s timeout, timer stops
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`document.getElementById('shaper-fusion-status')?.dataset.state === 'waiting'`, 'starts waiting when adsk absent');
  await waitFor(`document.getElementById('shaper-fusion-status')?.dataset.state === 'unavailable'`, 'transitions to unavailable after ~15 s timeout');

  const timedOut = await evalJs(`(() => {
    let adskChecksAfterTimeout = 0;
    Object.defineProperty(window, 'adsk', {
      configurable: true,
      get() { adskChecksAfterTimeout++; return undefined; },
    });
    window.__probeAdskGets = () => adskChecksAfterTimeout;
    return {
      disabled: document.getElementById('btn-fusion-add-selection').disabled,
      status: document.getElementById('shaper-fusion-status').textContent,
      state: document.getElementById('shaper-fusion-status').dataset.state,
    };
  })()`);
  assert.strictEqual(timedOut.disabled, true, 'Add selection stays disabled after timeout');
  assert.ok(timedOut.status.includes('window.adsk missing'), `unavailable text shown after timeout (${timedOut.status})`);
  await new Promise((r) => setTimeout(r, 600));
  assert.strictEqual(await evalJs(`window.__probeAdskGets()`), 0, 'no polling reads window.adsk after timeout');
  await shotBar('fusion-timeout.png');

  // ---- 3. Non-Fusion mode -> no Fusion bar and no 200 ms polling timer
  const { identifier: timerSpyId } = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const delays = [];
      const orig = window.setInterval;
      window.setInterval = function(fn, ms, ...rest) {
        delays.push(ms);
        return orig.call(this, fn, ms, ...rest);
      };
      window.__getIntervalDelays = () => delays.slice();
    })();`,
  });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  const normal = await evalJs(`({
    bar: document.getElementById('shaper-fusion-bar'),
    delays: window.__getIntervalDelays(),
  })`);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: timerSpyId });
  assert.strictEqual(normal.bar, null, 'Fusion bar absent outside Fusion mode');
  assert.strictEqual(normal.delays.includes(200), false, `no 200 ms polling timer started outside Fusion mode (${JSON.stringify(normal.delays)})`);

  console.log('fusion-adsk-wait-685-live: ALL CHECKS PASSED');
} finally {
  await close();
}
