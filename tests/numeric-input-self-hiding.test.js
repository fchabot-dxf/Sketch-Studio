// tests/numeric-input-self-hiding.test.js — Regression test for TASK 434:
// 1. Live headless CDP check in Shaper and Pen Plotter with real key events:
//    - all idle numeric inputs have computed display === 'none' (no stray box at top-left);
//    - after committing a dimension value with real Enter, document.activeElement is NOT #dimInput;
//    - one real Ctrl+Z changes history and reverts the committed dimension value (without any blur() patch).
// 2. Unit checks on shared style injection (#sk-numeric-input-styles), self-hiding, and single CSS source
//    (SketchStudio duplicate .dim-input CSS removed).

import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── Part 1: Headless browser check (Shaper & Pen Plotter, real CDP key events) ─────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {}
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0];
        if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(REPO_ROOT, decodeURIComponent(url)));
        if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf ' + e.message); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForJson(dbgPort) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {}
    await sleep(200);
  }
  return false;
}

async function closeBrowser(proc, dbgPort) {
  const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); });
  try {
    const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    if (v && v.webSocketDebuggerUrl) {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 2000); });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await Promise.race([exited, sleep(3000)]);
      try { ws.close(); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (process.platform === 'win32' && proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    else proc.kill();
  } catch (_) {}
}

async function sendRealKey(send, key, code, vk, modifiers = 0, text = '') {
  const down = { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (text) down.text = text;
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

await (async () => {
  const browser = findBrowser();
  if (!browser) {
    console.log('Part 1 skipped: no headless Edge/Chrome binary installed');
    return;
  }
  const { server, port } = await startServer();
  const dbgPort = 9510 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-434-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    assert(page, 'no CDP page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const evs = {};
    const send = (m, p = {}) => new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });
    const once = (m) => new Promise((res) => { (evs[m] = evs[m] || []).push(res); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Page.enable');

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };

    const hosts = [
      {
        name: 'Shaper',
        path: '/apps/shaper/index.html',
        enterExpr: `(() => { const b = document.querySelector('[data-mode="design"]'); if (b) b.click(); })()`,
        ctxExpr: `() => ({ svg: document.getElementById('design-canvas'), state: window.__designController.state, engine: window.__designController.engine })`,
      },
      {
        name: 'Pen Plotter',
        path: '/apps/penplotter/index.html',
        enterExpr: `(() => { const b = [...document.querySelectorAll('.stage-btn')].find(x => /design/i.test(x.textContent)); if (b) b.click(); })()`,
        ctxExpr: `() => ({ svg: document.getElementById('design-canvas'), state: window.__sketch.controller.state, engine: window.__sketch.controller.engine })`,
      },
    ];

    for (const host of hosts) {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${host.path}` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(500);
      await evalJs(host.enterExpr);
      await sleep(300);

      // 1. All runtime numeric inputs must have computed display === 'none'
      const displays = await evalJs(`(() => {
        return ['dimInput', 'dualInput', 'live-dim-width', 'live-dim-height', 'live-dim-length', 'live-dim-angle'].map(id => {
          const el = document.getElementById(id);
          return { id, display: el ? getComputedStyle(el).display : 'missing' };
        });
      })()`);
      for (const d of displays) {
        assert.strictEqual(d.display, 'none', `${host.name}: #${d.id} must be display:none when idle, got ${d.display}`);
      }

      // 2. Seed a 50mm line + distance dimension, open showEditInput, commit "80mm" via real Enter key
      await evalJs(`(async () => {
        const SettingsManager = (await import('#core/settings-manager.js')).default;
        SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
        const { showEditInput } = await import('#ui/numeric-input-manager.js');
        const { svg, state, engine } = (${host.ctxExpr})();
        for (const k of [...state.joints.keys()]) { if (k !== 'j_origin') state.joints.delete(k); }
        state.shapes.length = 0;
        state.constraints.length = 0;
        if (state.history) { state.history.length = 0; state.historyIndex = -1; }
        state.joints.set('j_a', { x: -25, y: 0, fixed: true });
        state.joints.set('j_b', { x: 25, y: 0, fixed: false });
        state.shapes.push({ id: 's_1', type: 'line', joints: ['j_a', 'j_b'] });
        const c = { id: 'c_1', type: 'distance', joints: ['j_a', 'j_b'], value: 50, offset: -15, glyphPos: { x: 0, y: -15 } };
        state.constraints.push(c);
        engine.solve(500);
        state.saveState();
        showEditInput(svg, state, c);
        await new Promise(r => setTimeout(r, 80));
      })()`);

      const openCheck = await evalJs(`(() => ({
        activeId: document.activeElement && document.activeElement.id,
        display: getComputedStyle(document.getElementById('dimInput')).display,
        borderColor: getComputedStyle(document.getElementById('dimInput')).borderColor,
      }))()`);
      assert.strictEqual(openCheck.activeId, 'dimInput', `${host.name}: #dimInput must have focus while editing`);
      assert.notStrictEqual(openCheck.display, 'none', `${host.name}: #dimInput must be visible while editing`);
      assert.strictEqual(openCheck.borderColor, 'rgb(234, 88, 12)', `${host.name}: #dimInput must have shared orange border`);

      // Type "80" and commit with real Enter key
      await sendRealKey(send, '8', 'Digit8', 56, 0, '8');
      await sendRealKey(send, '0', 'Digit0', 48, 0, '0');
      await sleep(40);
      await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
      await sleep(120);

      const postCommit = await evalJs(`(() => {
        const { state } = (${host.ctxExpr})();
        const el = document.getElementById('dimInput');
        const c = state.constraints.find(x => x.type === 'distance');
        return {
          activeId: document.activeElement && document.activeElement.id,
          activeTag: document.activeElement && document.activeElement.tagName,
          display: getComputedStyle(el).display,
          val: c ? c.value : null,
          histLen: state.history ? state.history.length : null,
        };
      })()`);
      assert.strictEqual(postCommit.display, 'none', `${host.name}: #dimInput must hide itself after Enter commit`);
      assert.notStrictEqual(postCommit.activeId, 'dimInput', `${host.name}: document.activeElement must NOT be #dimInput after commit`);
      assert.notStrictEqual(postCommit.activeTag, 'INPUT', `${host.name}: document.activeElement must NOT be an INPUT after commit`);
      assert.strictEqual(postCommit.val, 80, `${host.name}: dimension value must update to 80 on commit`);

      // Dispatch ONE real Ctrl+Z (modifiers: 2 = Ctrl) -> must revert 80 -> 50 and change history!
      await sendRealKey(send, 'z', 'KeyZ', 90, 2, '');
      await sleep(120);

      const postUndo = await evalJs(`(() => {
        const { state } = (${host.ctxExpr})();
        const c = state.constraints.find(x => x.type === 'distance');
        return {
          val: c ? c.value : null,
          histLen: state.history ? state.history.length : null,
        };
      })()`);
      assert.strictEqual(postUndo.val, 50, `${host.name}: one real Ctrl+Z must revert dimension 80 -> 50 (got ${postUndo.val})`);
      assert(postUndo.histLen < postCommit.histLen, `${host.name}: one real Ctrl+Z must step back history (${postCommit.histLen} -> ${postUndo.histLen})`);
      console.log(`Part 1 passed (${host.name}): idle hidden, activeElement=${postCommit.activeTag} after Enter, 1x Ctrl+Z reverted 80 -> ${postUndo.val} ✅`);
    }

    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();

// ── Part 2: Unit checks on shared style injection, self-hiding, and single CSS source ──────────────────────────

function makeFakeDom() {
  const byId = new Map();
  const makeEl = (tag) => {
    const classes = new Set();
    const el = {
      tagName: String(tag).toUpperCase(),
      style: {},
      value: '',
      textContent: '',
      children: [],
      _handlers: {},
      _id: '',
      _className: '',
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
      },
      addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { for (const fn of (this._handlers[ev.type] || [])) fn(ev); },
      appendChild(ch) { this.children.push(ch); return ch; },
      focus() { doc.activeElement = this; },
      select() {},
      setAttribute() {},
      querySelector(sel) {
        if (sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
        return null;
      },
    };
    Object.defineProperty(el, 'id', {
      get() { return this._id; },
      set(v) { this._id = v; if (v) byId.set(v, this); },
    });
    Object.defineProperty(el, 'className', {
      get() { return [...classes].join(' '); },
      set(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
    });
    return el;
  };
  const head = makeEl('head');
  const body = makeEl('body');
  const doc = {
    head,
    body,
    activeElement: body,
    createElement: makeEl,
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => (sel.startsWith('#') ? (byId.get(sel.slice(1)) || null) : null),
  };
  return { doc, byId };
}

await (async () => {
  const { doc, byId } = makeFakeDom();
  globalThis.document = doc;
  globalThis.window = {
    addEventListener() {},
    dispatchEvent() {},
  };
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.cancelAnimationFrame = () => {};

  const numMod = await import('#ui/numeric-input-manager.js');
  assert.strictEqual(typeof numMod.ensureNumericInputStyles, 'function', 'ensureNumericInputStyles must be exported');
  const {
    NUMERIC_INPUT_STYLE_ID,
    ensureNumericInputStyles,
    setupNumericInput,
    showSingleInput,
    showDualInput,
    hideInput,
  } = numMod;
  const { setupLiveDimensionInput, hideLiveInputs } = await import('#ui/input-handlers/live-dimension-input.js');

  const svg = {
    viewBox: { baseVal: { x: -50, y: -50, width: 100, height: 100 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const state = { joints: new Map(), shapes: [], constraints: [], saveState() {} };

  setupNumericInput(svg, state);
  setupLiveDimensionInput();
  ensureNumericInputStyles(); // second call must be idempotent

  const styleEls = doc.head.children.filter((c) => c.id === NUMERIC_INPUT_STYLE_ID);
  assert.strictEqual(styleEls.length, 1, 'ensureNumericInputStyles must inject #sk-numeric-input-styles exactly once');
  assert(styleEls[0].textContent.includes('.dim-input.hidden { display: none; }'), 'injected CSS must hide .dim-input.hidden');
  assert(styleEls[0].textContent.includes('var(--fusion-orange, #EA580C)'), 'injected CSS must include fallback #EA580C for non-SketchStudio hosts');
  assert(styleEls[0].textContent.includes('.sk-dual-input.hidden { display: none; }'), 'injected CSS must hide .sk-dual-input.hidden');

  for (const id of ['dimInput', 'dualInput', 'live-dim-width', 'live-dim-height', 'live-dim-length', 'live-dim-angle']) {
    const el = byId.get(id);
    assert(el, `expected #${id} to be created`);
    assert(el.classList.contains('hidden'), `#${id} must carry .hidden when idle`);
    assert.strictEqual(el.style.display, 'none', `#${id} must carry style.display='none' when idle`);
  }

  showSingleInput(120, 140, 42, 'length');
  assert(!byId.get('dimInput').classList.contains('hidden'), '#dimInput .hidden removed when shown');
  assert.strictEqual(byId.get('dimInput').style.display, '', '#dimInput style.display cleared when shown');

  showDualInput(200, 220, 50, 30);
  assert(!byId.get('dualInput').classList.contains('hidden'), '#dualInput .hidden removed when shown');
  assert.strictEqual(byId.get('dualInput').style.display, 'flex', '#dualInput style.display=flex when shown');

  hideInput();
  hideLiveInputs();
  assert(byId.get('dimInput').classList.contains('hidden') && byId.get('dimInput').style.display === 'none');
  assert(byId.get('dualInput').classList.contains('hidden') && byId.get('dualInput').style.display === 'none');

  const ssHtml = fs.readFileSync(path.join(REPO_ROOT, 'apps/sketchstudio/index.html'), 'utf8');
  const ssOverrides = fs.readFileSync(path.join(REPO_ROOT, 'apps/sketchstudio/overrides.css'), 'utf8');
  assert(!/\.dim-input\s*\{/.test(ssHtml), 'apps/sketchstudio/index.html must not duplicate .dim-input CSS');
  assert(!/\.dim-input\s*\{/.test(ssOverrides), 'apps/sketchstudio/overrides.css must not duplicate .dim-input CSS');

  const numSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/ui/numeric-input-manager.js'), 'utf8');
  assert(!/\.blur\s*\(/.test(numSrc), 'numeric-input-manager.js must not use a .blur() workaround');
  console.log('Part 2 passed: unit style-injection, self-hiding & single-source checks ✅');
})();
