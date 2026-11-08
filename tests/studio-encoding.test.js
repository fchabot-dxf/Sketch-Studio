// tests/studio-encoding.test.js — TASK 456: the Shaper export writes cut ENCODING exactly like Shaper Studio (from four real Studio
// exports): one attribute format, cutOffset/toolDia always written, compound paths with holes wound OPPOSITE and no fill-rule.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { findLoops } from '#core/loop-finder.js';
import { deriveCutFootprint } from '#core/profile-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9510 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-456-' + process.pid);
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
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const once = (m) => new Promise((res) => { (evs[m] = evs[m] || []).push(res); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);

    // ── 1. oracle from the owner's real Studio values (docUnit inches) ──
    const MM = 25.4;
    const sq = (x, y, w, h, p) => ({ pts: { [p + 'a']: [x, y], [p + 'b']: [x + w, y], [p + 'c']: [x + w, y + h], [p + 'd']: [x, y + h] }, shapes: [[p + '1', p + 'a', p + 'b'], [p + '2', p + 'b', p + 'c'], [p + '3', p + 'c', p + 'd'], [p + '4', p + 'd', p + 'a']] });
    const mkState = (parts) => {
      const joints = new Map(), shapes = [];
      for (const part of parts) { for (const [id, [x, y]] of Object.entries(part.pts)) joints.set(id, { x, y }); for (const [id, a, b] of part.shapes) shapes.push({ id, type: 'line', joints: [a, b] }); }
      return { joints, shapes, constraints: [] };
    };
    {
      const state = mkState([sq(0, 0, 60, 40, 'o')]);
      const loop = findLoops(state)[0];
      const exp = (rec) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec }], encoding: CUT_TYPES, docUnit: 'in' });
      const attrs = (svg) => (svg.match(/shaper:cutType="[^"]*"(?: shaper:\w+="[^"]*")*/) || [''])[0];
      // [rec, the attribute run Studio writes for it] — values taken from the four owner exports
      const cases = [
        [{ cutType: 'exterior', cutDepth: 0.1 * MM, cutOffset: 0, toolDia: 0.125 * MM }, 'shaper:cutType="outside" shaper:cutDepth="0.100 in" shaper:cutOffset="0in" shaper:toolDia="0.125 in"'],
        [{ cutType: 'exterior', cutOffset: 0, toolDia: 0.125 * MM }, 'shaper:cutType="outside" shaper:cutOffset="0in" shaper:toolDia="0.125 in"'], // depth unset: not written
        [{ cutType: 'exterior', cutDepth: 0.5 * MM, cutOffset: 0.063 * MM, toolDia: 0.125 * MM }, 'shaper:cutType="outside" shaper:cutDepth="0.500 in" shaper:cutOffset="0.063 in" shaper:toolDia="0.125 in"'],
        [{ cutType: 'interior', cutDepth: 0.3 * MM, cutOffset: -2 * MM, toolDia: 0.125 * MM }, 'shaper:cutType="inside" shaper:cutDepth="0.300 in" shaper:cutOffset="-2.000 in" shaper:toolDia="0.125 in"'],
        [{ cutType: 'pocket', cutDepth: 0.2 * MM, cutOffset: 0.125 * MM, toolDia: 0.06 * MM }, 'shaper:cutType="pocket" shaper:cutDepth="0.200 in" shaper:cutOffset="0.125 in" shaper:toolDia="0.060 in"'],
        [{ cutType: 'guide', cutDepth: 0.3 * MM, cutOffset: 0.125 * MM, toolDia: 0.125 * MM }, 'shaper:cutType="guide" shaper:cutDepth="0.300 in" shaper:cutOffset="0.125 in" shaper:toolDia="0.125 in"'],
        [{ cutType: 'online', cutDepth: 0.2 * MM, cutOffset: 0, toolDia: 0.125 * MM }, 'shaper:cutType="online" shaper:cutDepth="0.200 in" shaper:cutOffset="0in" shaper:toolDia="0.125 in"'],
      ];
      for (const [rec, want] of cases) assert.strictEqual(attrs(exp(rec)), want, `Studio attribute run for ${rec.cutType}`);
      // mm documents mirror the pattern (UNVERIFIED against a Studio mm export)
      const mm = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior', cutDepth: 6.35, cutOffset: 0, toolDia: 3.175 } }], encoding: CUT_TYPES, docUnit: 'mm' });
      assert.strictEqual(attrs(mm), 'shaper:cutType="outside" shaper:cutDepth="6.350 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"');
    }

    // ── 2. compound paths: the hole is wound OPPOSITE to the outer, and there is no fill-rule ──
    const signedAreas = (d) => d.split(/(?=M )/).map((sub) => { const pts = [...sub.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]); let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; });
    let frameD = '', ringD = '';
    {
      const state = mkState([sq(0, 0, 60, 60, 'o'), sq(20, 20, 20, 20, 'h')]);
      const outer = findLoops(state).sort((a, b) => b.joints.length - a.joints.length || 0).find((l) => l.joints.some((j) => j.startsWith('o')));
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer.id }, rec: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 3.175 } }], encoding: CUT_TYPES, docUnit: 'mm' });
      assert.ok(!svg.includes('fill-rule'), 'no fill-rule attribute (the default nonzero rule must work)');
      frameD = svg.match(/d="([^"]+)"/)[1];
      const [aOuter, aHole] = signedAreas(frameD);
      assert.ok(aOuter * aHole < 0, `hole wound OPPOSITE to the outer (signed areas ${aOuter} / ${aHole})`);
      assert.ok(Math.abs(aOuter) > Math.abs(aHole), 'outer is the larger subpath');
      // an outside-profile's hole is its own INSIDE path, an inside profile's outer likewise: single paths keep their own winding
    }
    {
      // circles: a ring (outer circle + hole circle) -> the hole's arcs use the opposite sweep flag
      const state = { joints: new Map([['c', { x: 0, y: 0 }], ['p1', { x: 30, y: 0 }], ['p2', { x: 10, y: 0 }]]), shapes: [{ id: 'big', type: 'circle', joints: ['c', 'p1'], radius: 30 }, { id: 'small', type: 'circle', joints: ['c', 'p2'], radius: 10 }], constraints: [] };
      const outer = findLoops(state).find((l) => l.edges[0] === 'big');
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer.id }, rec: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 3.175 } }], encoding: CUT_TYPES, docUnit: 'mm' });
      ringD = svg.match(/d="([^"]+)"/)[1];
      assert.ok(!svg.includes('fill-rule') && /A 30 30 0 1 0/.test(ringD) && /A 10 10 0 1 1/.test(ringD), 'circle hole uses the opposite arc sweep: ' + ringD);
    }

    // ── 3. render check in the real browser: with the DEFAULT fill rule the hole stays EMPTY ──
    {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(800);
      const r = await evalJs(`(() => {
        const mk = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '-40 -40 120 120'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); document.body.appendChild(s); return { s, p }; };
        const pt = (s, x, y) => { const q = s.createSVGPoint(); q.x = x; q.y = y; return q; };
        const frame = mk(${JSON.stringify(frameD)}); const ring = mk(${JSON.stringify(ringD)});
        return { frameWall: frame.p.isPointInFill(pt(frame.s, 5, 5)), frameHole: frame.p.isPointInFill(pt(frame.s, 30, 30)),
                 ringBand: ring.p.isPointInFill(pt(ring.s, 20, 0)), ringHole: ring.p.isPointInFill(pt(ring.s, 0, 0)) };
      })()`);
      console.log('render check (default fill rule):', JSON.stringify(r));
      assert.deepStrictEqual(r, { frameWall: true, frameHole: false, ringBand: true, ringHole: false }, 'the hole stays EMPTY under the default (nonzero) fill rule');
    }

    // ── 4. On Line: the offset is shown and written, but the PREVIEW centres the band on the line (Studio) ──
    {
      const poly = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
      const fp = (off) => deriveCutFootprint([{ kind: 'loop', polygon: poly, cutType: 'online', offsetSide: 0 }], effectiveCutRecord({ cutType: 'online', toolDia: 3.175, cutOffset: off }), null);
      assert.deepStrictEqual(fp(25.4), fp(0), 'an On Line with offset 25.4 mm has the same footprint as offset 0');
      const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 0 }]]) };
      const chain = { shapes: [{ id: 's', type: 'line', joints: ['a', 'b'] }] };
      const cfp = (off) => deriveCutFootprint([{ kind: 'chain', chain, offsetSide: 0 }], effectiveCutRecord({ cutType: 'online', toolDia: 3.175, cutOffset: off }), state);
      assert.deepStrictEqual(cfp(25.4), cfp(0), 'same for an open chain');
    }
    console.log('studio-encoding: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
