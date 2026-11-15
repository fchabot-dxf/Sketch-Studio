// tests/fusion-adsk-wait-685-node.test.js — TASK 685: wait for async window.adsk injection in Fusion mode (?host=fusion).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import {
  FUSION_ACTIONS,
  mountFusionPrepareBar,
} from '../apps/shaper/src/fusion-bridge.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function makeHarness({ url = 'http://127.0.0.1/apps/shaper/index.html?host=fusion', spyTimers = false } = {}) {
  const win = new Window({ url });
  const prevDoc = globalThis.document;
  globalThis.document = win.document;

  const timerStats = { setCalls: 0, clearCalls: 0, activeIds: new Set(), loadListeners: 0 };
  if (spyTimers) {
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    let nextId = 1;
    const realIds = new Map();
    win.setInterval = (fn, ms) => {
      timerStats.setCalls++;
      const id = nextId++;
      timerStats.activeIds.add(id);
      realIds.set(id, origSetInterval(fn, ms));
      return id;
    };
    win.clearInterval = (id) => {
      if (id == null) return;
      timerStats.clearCalls++;
      timerStats.activeIds.delete(id);
      const real = realIds.get(id);
      if (real !== undefined) {
        origClearInterval(real);
        realIds.delete(id);
      }
    };
    const origAdd = win.addEventListener.bind(win);
    win.addEventListener = (type, fn, opts) => {
      if (type === 'load') timerStats.loadListeners++;
      return origAdd(type, fn, opts);
    };
  }

  const viewPrepare = win.document.createElement('section');
  viewPrepare.id = 'view-prepare';
  const notice = win.document.createElement('div');
  notice.id = 'prepare-notice';
  notice.hidden = true;
  viewPrepare.appendChild(notice);
  win.document.body.appendChild(viewPrepare);

  return {
    win,
    viewPrepare,
    notice,
    timerStats,
    cleanup: () => { globalThis.document = prevDoc; },
  };
}

// 1. Not Fusion mode -> zero timers, no 'load' listener, immediate unavailable hint
for (const url of ['http://127.0.0.1/apps/shaper/index.html', 'http://127.0.0.1/apps/shaper/index.html?host=web']) {
  const h = makeHarness({ url, spyTimers: true });
  try {
    const ui = mountFusionPrepareBar({ viewPrepareEl: h.viewPrepare, noticeEl: h.notice, globalTarget: h.win });
    eq(h.timerStats.setCalls, 0, `no polling timer outside Fusion mode (${url})`);
    eq(h.timerStats.activeIds.size, 0, `zero active timers outside Fusion mode (${url})`);
    eq(h.timerStats.loadListeners, 0, `no load listener outside Fusion mode (${url})`);
    eq(ui.addBtn.disabled, true, 'Add selection disabled when adsk missing outside Fusion mode');
    ok(ui.statusEl.textContent.includes('window.adsk missing'), `unavailable text shown immediately outside Fusion mode (${ui.statusEl.textContent})`);
    ui.destroy?.();
  } finally {
    h.cleanup();
  }
}

// 2. Fusion mode (?host=fusion) with real ~1 s delayed window.adsk injection (uses default ~200 ms poll & ~15 s timeout)
{
  const h = makeHarness({ url: 'http://127.0.0.1/apps/shaper/index.html?host=fusion', spyTimers: true });
  try {
    const sent = [];
    const ui = mountFusionPrepareBar({ viewPrepareEl: h.viewPrepare, noticeEl: h.notice, globalTarget: h.win });
    const bootRes = ui.bootPing();
    eq(bootRes.ok, false, 'initial bootPing before adsk returns ok:false');
    eq(ui.addBtn.disabled, true, 'Add selection initially disabled while waiting');
    eq(ui.statusEl.textContent, 'Waiting for Fusion…', `initial Fusion status shows Waiting (${ui.statusEl.textContent})`);
    ok(h.timerStats.setCalls >= 1 && h.timerStats.activeIds.size === 1, 'one wait polling timer active in Fusion mode');

    // Simulate page load without adsk yet, then Fusion injects window.adsk 1000 ms later
    h.win.dispatchEvent(new h.win.Event('load'));
    eq(ui.addBtn.disabled, true, 'still disabled right after load before adsk');
    eq(ui.statusEl.textContent, 'Waiting for Fusion…', 'still Waiting right after load before adsk');

    await new Promise((r) => setTimeout(r, 1000));
    h.win.adsk = {
      fusionSendData: (action, data) => { sent.push({ action, data }); },
    };

    // Wait up to 600 ms for the ~200 ms poll to spot window.adsk
    const deadline = Date.now() + 600;
    while (ui.addBtn.disabled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 40));
    }

    eq(ui.addBtn.disabled, false, 'Add selection enables once window.adsk appears at 1 s');
    eq(ui.statusEl.textContent, 'Connecting to Fusion…', 'status moves to Connecting to Fusion… when adsk appears');
    eq(h.timerStats.activeIds.size, 0, 'polling timer stops once host is found');
    ok(h.timerStats.clearCalls >= 1, 'clearInterval called once host is found');
    eq(sent.length, 1, 'boot ping sent exactly once when host appears');
    eq(sent[0].action, FUSION_ACTIONS.PING, 'sent ping action');

    // Re-calling bootPing must NOT send a duplicate boot ping
    ui.bootPing();
    eq(sent.length, 1, 'repeated bootPing call does not send a second ping');

    // Fake pong -> Connected to Fusion: <doc>
    h.win.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', documentName: 'LateBracket' }));
    eq(ui.statusEl.textContent, 'Connected to Fusion: LateBracket', 'status updates to connected after pong');
    eq(ui.statusEl.dataset.state, 'connected', 'state dataset is connected');
    ui.destroy?.();
  } finally {
    h.cleanup();
  }
}

// 3. Window 'load' event detects window.adsk immediately without waiting for poll tick
{
  const h = makeHarness({ url: 'http://127.0.0.1/apps/shaper/index.html?host=fusion', spyTimers: true });
  try {
    const sent = [];
    const ui = mountFusionPrepareBar({ viewPrepareEl: h.viewPrepare, noticeEl: h.notice, globalTarget: h.win, pollIntervalMs: 5000, waitTimeoutMs: 15000 });
    eq(ui.statusEl.textContent, 'Waiting for Fusion…', 'waiting before load');
    h.win.adsk = { fusionSendData: (action, data) => { sent.push({ action, data }); } };
    h.win.dispatchEvent(new h.win.Event('load'));
    eq(ui.addBtn.disabled, false, 'window load listener re-checks adsk immediately');
    eq(ui.statusEl.textContent, 'Connecting to Fusion…', 'status updates on load');
    eq(sent.length, 1, 'load discovery sends 1 boot ping');
    eq(h.timerStats.activeIds.size, 0, 'load discovery stops polling timer');
    ui.destroy?.();
  } finally {
    h.cleanup();
  }
}

// 4. Incoming fusionJavaScriptHandler message re-checks host presence & cancels wait timer
{
  const h = makeHarness({ url: 'http://127.0.0.1/apps/shaper/index.html?host=fusion', spyTimers: true });
  try {
    const ui = mountFusionPrepareBar({ viewPrepareEl: h.viewPrepare, noticeEl: h.notice, globalTarget: h.win, pollIntervalMs: 5000, waitTimeoutMs: 15000 });
    eq(ui.addBtn.disabled, true, 'disabled before message');
    h.win.adsk = { fusionSendData: () => {} };
    h.win.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', documentName: 'MsgHost' }));
    eq(ui.addBtn.disabled, false, 'incoming handler message triggers re-check and enables Add selection');
    eq(ui.statusEl.textContent, 'Connected to Fusion: MsgHost', 'pong sets connected status (not overwritten by Connecting)');
    eq(h.timerStats.activeIds.size, 0, 'timer stopped after handler message confirms host');
    ui.destroy?.();
  } finally {
    h.cleanup();
  }
}

// 5. Timeout when window.adsk is never injected -> shows unavailable text and stops timer
{
  const h = makeHarness({ url: 'http://127.0.0.1/apps/shaper/index.html?host=fusion', spyTimers: true });
  try {
    const ui = mountFusionPrepareBar({ viewPrepareEl: h.viewPrepare, noticeEl: h.notice, globalTarget: h.win, pollIntervalMs: 25, waitTimeoutMs: 140 });
    eq(ui.statusEl.textContent, 'Waiting for Fusion…', 'Waiting while before timeout');
    eq(ui.addBtn.disabled, true, 'disabled before timeout');
    await new Promise((r) => setTimeout(r, 250));
    ok(ui.statusEl.textContent.includes('window.adsk missing'), `unavailable text shown after timeout (${ui.statusEl.textContent})`);
    eq(ui.statusEl.dataset.state, 'unavailable', 'dataset.state flips to unavailable after timeout');
    eq(ui.addBtn.disabled, true, 'button stays disabled after timeout');
    eq(h.timerStats.activeIds.size, 0, 'polling timer stopped after timeout');
    ui.destroy?.();
  } finally {
    h.cleanup();
  }
}

console.log(`fusion-adsk-wait-685-node: ${checks} checks passed`);
