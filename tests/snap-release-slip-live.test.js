// tests/snap-release-slip-live.test.js — TASK 546 (live headless, REAL mouse via CDP): the pointer-up "release jitter" recovery
// (input-manager handlePointerUp: a snap lost < 200 ms before the release is put back) recovers a SLIP, not a MOVE.
//   1. press on the snapped origin with the Polygon tool, flick 120 px away and release fast (< 200 ms): the hexagon is drawn with
//      its corner where the pointer was released (a point no snap locks on). Before task 546 the press point's snap was recovered at the release, the corner
//      landed on the centre (radius 0) and the tool silently drew nothing (tests/polygon-tool-live.test.js failed on it).
//   2. the recovery still does its job: the Line tool locks its end on the origin, the pointer slips just past the joint snap reach
//      (the snap is lost) but inside the release distance, and a fast release still ends the line ON the origin.
// Shaper's Design tab on a fresh profile (an empty design whose origin is on screen); the same shared input layer serves every host.

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

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
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

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9400 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-546-' + process.pid);
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
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => {
      const c = await centerOf(sel); assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y, 0); await sleep(30); await mouse('mousePressed', c.x, c.y, 1); await sleep(30); await mouse('mouseReleased', c.x, c.y, 0); await sleep(150);
    };
    // a recorder AFTER the canvas handlers (document, bubble phase): each pointer event's page timestamp and whether the origin snap is
    // locked once the input layer has handled it. The recovery window is 200 ms, so each case states that it ran inside it.
    const arm = () => evalJs(`(() => { window.__r546 = []; const rec = (e) => { const t = window.__designController.state.snapTarget; window.__r546.push({ type: e.type, t: e.timeStamp, origin: !!(t && t.isLocked && t.targetId === 'j_origin'), none: !t, snap: t ? (t.type + ':' + (t.targetId || '') + (t.isLocked ? ':locked' : '')) : null }); }; for (const ev of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(ev, rec); window.__r546.stop = () => { for (const ev of ['pointerdown', 'pointermove', 'pointerup']) document.removeEventListener(ev, rec); }; })()`);
    const record = () => evalJs(`(() => { window.__r546.stop(); return window.__r546.slice(); })()`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await sleep(2200);
    await clickEl('.mode-btn[data-mode="design"]'); await sleep(900);

    const S = 'window.__designController.state';
    const origin = await evalJs(`import('#ui/coords.js').then(({ worldToScreen }) => { const p = worldToScreen(document.querySelector('#design-canvas'), ${S}.joints.get('j_origin')); return { x: Math.round(p.x), y: Math.round(p.y) }; })`);
    // lock = the lock distance, release = the hysteresis distance a held lock survives to, reach = findSnap's joint radius
    const magnet = await evalJs(`Promise.all([import('#ui/snap-magnet.js'), import('#core/constants.js')]).then(([{ getMagnetThreshold }, { SNAP }]) => ({ lock: getMagnetThreshold('snap'), release: getMagnetThreshold('snap', true), reach: SNAP.JOINT_PX }))`);
    const empty = await evalJs(`${S}.shapes.length`);
    assert.strictEqual(empty, 0, 'a fresh profile opens an empty Shaper design');
    console.log('origin on screen', JSON.stringify(origin), 'snap lock / release px', JSON.stringify(magnet));
    // A screen point `r` px from the origin where NO snap locks: outside the lock distance of both axes (the axis snap, task 537) and
    // farthest from every grid point (the grid snap). Each case releases on such a point, so its release has no snap of its own and
    // only the recovery can move it.
    const clearPoint = (r) => evalJs(`Promise.all([import('#ui/coords.js'), import('#ui/canvas-grid.js'), import('#ui/snap-magnet.js'), import('#core/settings-manager.js')]).then(([{ worldToScreen, screenToWorld }, { gridSpacing }, { getMagnetThreshold }, { default: SM }]) => {
      const svg = document.querySelector('#design-canvas');
      const { GRID_SIZE } = gridSpacing(SM.get('DOC_UNIT') || 'mm', { GRID_SIZE: Number(SM.get('GRID_SIZE') || SM.getDefault('GRID_SIZE')), GRID_MAJOR_STEP: Number(SM.get('GRID_MAJOR_STEP') || SM.getDefault('GRID_MAJOR_STEP')), INCH_GRID_DIVISIONS: SM.get('INCH_GRID_DIVISIONS'), INCH_GRID_MAJOR: SM.get('INCH_GRID_MAJOR') });
      let best = null;
      for (let deg = 0; deg < 360; deg++) {
        const x = Math.round(${origin.x} + ${r} * Math.cos(deg * Math.PI / 180)), y = Math.round(${origin.y} + ${r} * Math.sin(deg * Math.PI / 180));
        if (Math.min(Math.abs(x - ${origin.x}), Math.abs(y - ${origin.y})) <= ${magnet.lock}) continue;
        const w = screenToWorld(svg, x, y), g = worldToScreen(svg, { x: Math.round(w.x / GRID_SIZE) * GRID_SIZE, y: Math.round(w.y / GRID_SIZE) * GRID_SIZE });
        const d = Math.hypot(g.x - x, g.y - y);
        if (!best || d > best.gridPx) best = { x, y, gridPx: d };
      }
      return best && Object.assign(best, { gridMagnet: getMagnetThreshold('grid') });
    })`).then((p) => { assert(p && p.gridPx > p.gridMagnet, 'a point ' + r + ' px from the origin clear of the grid and axis snaps: ' + JSON.stringify(p)); return p; });

    // ---- 1. Polygon: press ON the origin (a locked snap), flick 120 px away to a point with no snap, release fast -> a hexagon with its
    //         corner at the release point
    await clickEl('#tool-polygon');
    await mouse('mouseMoved', origin.x, origin.y, 0); await sleep(60);
    const lockedAtPress = await evalJs(`(() => { const t = ${S}.snapTarget; return !!(t && t.isLocked && t.targetId === 'j_origin'); })()`);
    assert(lockedAtPress, 'hovering the origin locks its snap before the press');
    const end = await clearPoint(120);
    await arm();
    await mouse('mousePressed', origin.x, origin.y, 1);
    await mouse('mouseMoved', Math.round((origin.x + end.x) / 2), Math.round((origin.y + end.y) / 2), 1);
    await mouse('mouseMoved', end.x, end.y, 1);
    await mouse('mouseReleased', end.x, end.y, 0); await sleep(300);
    const r1 = await record();
    const down1 = r1.find((r) => r.type === 'pointerdown'), up1 = r1.find((r) => r.type === 'pointerup');
    assert(down1 && up1 && down1.origin, 'the press is on the locked origin snap: ' + JSON.stringify(r1));
    assert(r1.filter((r) => r.type === 'pointermove').pop().none, 'the release point has no snap of its own: ' + JSON.stringify(r1));
    const flickMs = up1.t - down1.t;
    assert(flickMs < 200, 'the flick ran inside the 200 ms recovery window (press -> release ' + flickMs + ' ms)');
    // the corner (the first radius' far joint) on screen: where the pointer was released, never back on the centre 120 px away
    const poly = await evalJs(`import('#ui/coords.js').then(({ worldToScreen }) => { const s = ${S}; const sides = s.shapes.filter((x) => !x.isConstruction); const radii = s.shapes.filter((x) => x.isConstruction); const v = radii[0] && s.joints.get(radii[0].joints[1]); const p = v && worldToScreen(document.querySelector('#design-canvas'), v); return { sides: sides.length, radii: radii.length, cornerPxFromRelease: p ? Math.hypot(p.x - ${end.x}, p.y - ${end.y}) : null }; })`);
    console.log('flick from the origin: press -> release', Math.round(flickMs), 'ms', JSON.stringify(poly));
    assert.strictEqual(poly.sides, 6, 'a fast flick from the snapped origin draws the hexagon (6 sides): ' + JSON.stringify(poly));
    assert.strictEqual(poly.radii, 6, '6 construction radii');
    assert(poly.cornerPxFromRelease !== null && poly.cornerPxFromRelease < 1, 'the corner is where the pointer was released, not back on the centre: ' + JSON.stringify(poly));
    await clickEl('#btn-undo');
    assert.strictEqual(await evalJs(`${S}.shapes.length`), 0, 'one Undo removes the polygon');

    // ---- 2. Line: lock the end on the origin, slip just outside the lock distance (the snap is lost), release fast -> ends ON the origin
    await clickEl('#tool-line');
    const start = { x: origin.x - 200, y: origin.y - 120 };
    // a held lock survives while findSnap still finds the joint (reach) and within the release distance: the snap is LOST between the
    // two, and that is where a slip relies on the recovery
    assert(magnet.reach < magnet.release, 'a slip band exists between the joint reach and the release distance: ' + JSON.stringify(magnet));
    const slip = Math.round((magnet.reach + magnet.release) / 2);
    const slipAt = await clearPoint(slip);
    await mouse('mouseMoved', start.x, start.y, 0); await sleep(60);
    await mouse('mousePressed', start.x, start.y, 1);
    await mouse('mouseMoved', origin.x - 100, origin.y - 60, 1);
    await arm();
    await mouse('mouseMoved', origin.x, origin.y, 1);
    await mouse('mouseMoved', slipAt.x, slipAt.y, 1);
    await mouse('mouseReleased', slipAt.x, slipAt.y, 0); await sleep(300);
    const r2 = await record();
    const moves = r2.filter((r) => r.type === 'pointermove'), up2 = r2.find((r) => r.type === 'pointerup');
    assert(moves.length === 2 && moves[0].origin, 'the line end locks on the origin: ' + JSON.stringify(r2));
    assert(moves[1].none, `a ${slip} px slip (joint reach ${magnet.reach} px, release ${magnet.release} px) loses the snap, so the release relies on the recovery: ` + JSON.stringify(r2));
    const slipMs = up2.t - moves[0].t;
    assert(slipMs < 200, 'the slip ran inside the 200 ms recovery window (lock -> release ' + slipMs + ' ms)');
    const line = await evalJs(`(() => { const s = ${S}; const l = s.shapes.find((x) => x.type === 'line'); if (!l) return null; const o = s.joints.get('j_origin'); const ends = l.joints.map((j) => s.joints.get(j)); const onOrigin = l.joints.some((j, i) => j === 'j_origin' || Math.hypot(ends[i].x - o.x, ends[i].y - o.y) < 1e-6 || s.constraints.some((c) => c.type === 'coincident' && c.joints && c.joints.includes('j_origin') && c.joints.includes(j))); return { lines: s.shapes.filter((x) => x.type === 'line').length, onOrigin }; })()`);
    console.log('slip release on the origin:', JSON.stringify(line));
    assert(line && line.lines >= 1 && line.onOrigin, 'a slip within the release distance still ends the line on the origin: ' + JSON.stringify(line));
    console.log('snap-release-slip-live: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
