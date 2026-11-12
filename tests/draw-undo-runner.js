// tests/draw-undo-runner.js - TASK 549 live scenarios (headless CDP, real pointer events + real Ctrl+Z / Ctrl+Y). NOT a test file itself: the gate
// runs each *.test.js under a 90 s limit, so draw-undo-live-*.test.js each set HOST and ONLY and import this runner.
// One drawn element = ONE undo step: Ctrl+Z restores EXACTLY the pre-draw document, Ctrl+Y restores EXACTLY the drawn one.

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



const HOST = process.env.HOST || 'sketchstudio';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9400 + Math.floor((Date.now() % 90));
  const userDir = path.join(os.tmpdir(), 'sk-test-549-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  let failed = null;
  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map(); const evs = {};
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); };
    // a click that lands on a panel / toolbar instead of the canvas would make a scenario pass vacuously: refuse it
    const onCanvas = (x, y) => evalJs(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!(e && e.closest && e.closest('#${HOST === 'shaper' ? 'design-canvas' : 'svgCanvas'}')); })()`);
    const click = async (x, y) => { assert(await onCanvas(x, y), 'the click at ' + x + ',' + y + ' is not on the canvas'); await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(150);
    };
    const esc = () => key('Escape', 'Escape', 27);
    const enter = () => key('Enter', 'Enter', 13);
    const undoKey = () => key('z', 'KeyZ', 90, 2);
    const redoKey = () => key('y', 'KeyY', 89, 2);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const CANVAS = HOST === 'shaper' ? 'design-canvas' : 'svgCanvas';
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('${CANVAS}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(200); return; } await sleep(200); } };
    // Shaper's Design tab has the test hook window.__designController (the live state); SketchStudio is read from its autosaved store.
    // presentation noise that Undo/Redo legitimately re-stamps (not geometry): __visible, glyphPos, key order, the origin's sketchId
    const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
    const norm = (d) => ({ shapes: d.shapes, joints: (Array.isArray(d.joints) ? d.joints : Object.entries(d.joints).map(([k, v]) => [k, v])).map(([k, v]) => { if (k !== 'j_origin') return [k, v]; const { sketchId, ...r } = v; return [k, r]; }), constraints: d.constraints.map((c) => { const { __visible, glyphPos, ...r } = c; return sortKeys(r); }) });
    const readDoc = async () => norm(await readDocRaw());
    const readDocRaw = async () => {
      if (HOST === 'shaper') {
        return JSON.parse(await evalJs(`(() => { const s = window.__designController.state; return JSON.stringify({ shapes: s.shapes, constraints: s.constraints, joints: [...s.joints.entries()] }); })()`));
      }
      await sleep(1800); await waitSaved(); return storedDoc(); // the buffer polls every 1500 ms
    };
    // Shaper only (its Design tab exposes the live state): the undo stack itself, so "no undo step" and the journal labels are asserted directly
    const histLabels = () => HOST === 'shaper' ? evalJs(`window.__designController.state.history.map((h) => h.label)`) : null;
    const url = `http://127.0.0.1:${port}/apps/${HOST}/index.html`;
    if (HOST === 'shaper') {
      await send('Page.navigate', { url }); await sleep(2500);
      for (let i = 0; i < 5; i++) { await evalJs(`document.querySelector('[data-mode="design"]').click()`); await sleep(500); if (await evalJs(`!!window.__designController`)) break; }
      await sleep(1500);
    } else {
      await send('Page.navigate', { url }); await sleep(2500);
      await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
      await send('Page.navigate', { url }); await sleep(2500);
    }
    const o = await toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const clicks = async (...pts) => { for (const p of pts) await click(p.x, p.y); };

    // ---- document helpers
    const jmap = (d) => { const out = {}; const jo = d.joints; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
    const canon = (d) => JSON.stringify({ j: Object.entries(jmap(d)).sort((a, b) => a[0] < b[0] ? -1 : 1), s: d.shapes, c: d.constraints.map((c) => JSON.stringify(c)).sort() });
    const orphans = (d, before) => { const was = before ? new Set(orphansRaw(before)) : new Set(); return orphansRaw(d).filter((j) => !was.has(j)); }; // joints no shape uses that were NOT already loose before the draw (a fillet leaves its own hidden corner joint)
    const orphansRaw = (d) => { const used = new Set(); for (const s of d.shapes) for (const j of (s.joints || [])) used.add(j); return Object.keys(jmap(d)).filter((j) => j !== 'j_origin' && !used.has(j)); };
    const sum = (d) => `j${Object.keys(jmap(d)).length} s${d.shapes.length} c${d.constraints.length}`;
    const diff = (a, b) => { // net joints / shapes / constraints b has more than a
      const ja = jmap(a), jb = jmap(b); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c)));
      const sa = new Set(a.shapes.map((s) => s.id)), sb = new Set(b.shapes.map((s) => s.id));
      return { joints: Object.keys(jb).length - Object.keys(ja).length, shapes: sb.size - sa.size, constraints: cb.size - ca.size };
    };

    const why = (a, b) => { const ja = jmap(a), jb = jmap(b); const out = []; for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) out.push('joint ' + k + ' ' + JSON.stringify(ja[k]) + ' -> ' + JSON.stringify(jb[k])); const sa = new Map(a.shapes.map((x) => [x.id, JSON.stringify(x)])), sb = new Map(b.shapes.map((x) => [x.id, JSON.stringify(x)])); for (const k of new Set([...sa.keys(), ...sb.keys()])) if (sa.get(k) !== sb.get(k)) out.push('shape ' + k + ' ' + sa.get(k) + ' -> ' + sb.get(k)); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c))); for (const c of ca) if (!cb.has(c)) out.push('constraint only before: ' + c); for (const c of cb) if (!ca.has(c)) out.push('constraint only after: ' + c); return out.slice(0, 6); };
    const rows = [];
    // ONE scenario: draw (+ finish), then Ctrl+Z once, then Ctrl+Y once; record what each leaves.
    const measure = async (name, draw) => {
      if (only && !only.includes(name)) return null;
      const d0 = await readDoc();
      await draw();
      const d1 = await readDoc();
      await undoKey(); const d2 = await readDoc();
      await redoKey(); const d3 = await readDoc();
      const row = {
        name, drawn: sum(d1), pre: sum(d0), afterUndo: sum(d2),
        undoLeft: diff(d0, d2), undoExact: canon(d2) === canon(d0), orphansAfterUndo: orphans(d2, d0),
        redoExact: canon(d3) === canon(d1), made: diff(d0, d1),
      };
      if (!row.undoExact) row.undoDiff = why(d0, d2);
      if (!row.redoExact) row.redoDiff = why(d1, d3);
      rows.push(row);
      console.log(`ROW ${name.padEnd(24)} drew ${JSON.stringify(row.made)} ${row.undoDiff ? 'UNDODIFF ' + JSON.stringify(row.undoDiff) : ''} ${row.redoDiff ? 'REDODIFF ' + JSON.stringify(row.redoDiff) : ''} | after ONE Ctrl+Z left ${JSON.stringify(row.undoLeft)} exact=${row.undoExact} orphans=${JSON.stringify(row.orphansAfterUndo)} | Ctrl+Y exact=${row.redoExact}`);
      return { d0, d1, d2, d3, row };
    };
    const results = {};
    const asserts = [];
    const want = (name, cond, msg) => { if (!results[name]) return; if (!cond(results[name])) asserts.push(`${name}: ${msg}; got ${JSON.stringify(results[name].row)}`); };
    const run = async (name, toolName, draw) => { if (only && !only.includes(name)) return; await tool(toolName); results[name] = await measure(name, draw); }; // Esc ends the draw AND switches to Select, so each scenario picks its tool

    await run('line empty-to-empty', 'line', async () => { await clicks(P(-300, -300), P(-150, -300)); await esc(); });
    await run('line from existing point', 'line', async () => { await clicks(P(-150, -300), P(-150, -200)); await esc(); });
    // chain of 3 lines (4 clicks) then finish; each undo must remove exactly one segment and leave no orphan
    if (!only || only.includes('chain of 3 lines')) {
      await tool('line');
      const d0 = await readDoc();
      await clicks(P(40, -300), P(190, -300), P(190, -200), P(40, -200)); await esc();
      const d3 = await readDoc();
      const steps = [d3];
      for (let i = 0; i < 3; i++) { await undoKey(); steps.push(await readDoc()); }
      for (let i = 0; i < 3; i++) await redoKey();
      const back = [null, null, await readDoc()];
      const nLines = (d) => d.shapes.filter((s) => s.type === 'line').length - d0.shapes.filter((s) => s.type === 'line').length;
      const row = { name: 'chain of 3 lines', drawn: sum(d3), pre: sum(d0), perUndo: steps.slice(1).map(sum), linesLeftAfterEachUndo: steps.slice(1).map(nLines), orphansAfterEachUndo: steps.slice(1).map((d) => orphans(d, d0)), finalExact: canon(steps[3]) === canon(d0), redoExact: canon(back[2]) === canon(d3) };
      rows.push(row); console.log('ROW chain of 3 lines       ', JSON.stringify(row));
      results['chain of 3 lines'] = { row };
      want('chain of 3 lines', (r) => JSON.stringify(r.row.linesLeftAfterEachUndo) === '[2,1,0]', 'each Ctrl+Z removes exactly one line');
      want('chain of 3 lines', (r) => r.row.orphansAfterEachUndo.every((a) => a.length === 0), 'no orphan joint after any undo');
      want('chain of 3 lines', (r) => r.row.finalExact, 'the third undo restores the pre-chain document exactly');
      want('chain of 3 lines', (r) => r.row.redoExact, 'three redos restore the chain exactly');
      // leave the chain redone for the fillet scenario below
    }
    await run('rect', 'rect', async () => { await clicks(P(250, -300), P(350, -200)); await esc(); });
    await run('circle', 'circle', async () => { await clicks(P(-300, 100), P(-240, 100)); await esc(); });
    await run('arc', 'arc', async () => { await clicks(P(-100, 150), P(-40, 150), P(-100, 90)); await esc(); });
    await run('polygon', 'polygon', async () => { await clicks(P(150, 150), P(210, 170)); await esc(); });
    await run('bezier', 'bezier', async () => { await clicks(P(260, 100), P(320, 180), P(380, 100)); await enter(); await esc(); });
    // fillet the chain's first corner (190,-300): the input opens, Enter applies the default radius
    await run('fillet', 'fillet', async () => { await click(o.x + 190, o.y - 300); await sleep(400); await enter(); await sleep(300); await esc(); });
    if (HOST === 'shaper' && !only) { // the journal (packages/core/journal.js) names each step by the tool that made it
      const labels = await histLabels();
      for (const t of ['line', 'rect', 'circle', 'arc', 'polygon', 'bezier', 'fillet']) if (!labels.includes(t)) asserts.push('journal label ' + t + ' missing; history labels: ' + JSON.stringify(labels));
      console.log('LABELS', JSON.stringify(labels));
    }
    // Cancelled draws (Esc, or picking another tool) mid-draw: nothing is left, NO undo step was taken (the Ctrl+Z after it undoes the
    // PREVIOUS element, not the cancelled one) and Ctrl+Y brings that previous element back.
    const MID = { // the canvas origin sits at about y = 610 of 900, so offsets stay within +-250
      line: async () => { await click(o.x - 380, o.y + 200); await move(o.x - 300, o.y + 200); },
      rect: async () => { await click(o.x - 380, o.y + 200); await move(o.x - 300, o.y + 250); },
      circle: async () => { await click(o.x - 380, o.y + 200); await move(o.x - 330, o.y + 200); },
      arc: async () => { await click(o.x - 380, o.y + 200); await click(o.x - 320, o.y + 200); await move(o.x - 380, o.y + 140); },
      polygon: async () => { await click(o.x - 380, o.y + 200); await move(o.x - 330, o.y + 220); },
      bezier: async () => { await click(o.x - 380, o.y + 200); await move(o.x - 330, o.y + 230); },
    };
    if (only && [...only].some((n) => /^(esc|switch tool) mid-/.test(n))) { // a baseline element, so "the previous step" exists when this file runs on its own
      await tool('circle'); await clicks(P(300, 150), P(340, 150)); await esc();
    }
    for (const how of ['esc', 'switch tool']) {
      for (const t of Object.keys(MID)) {
        const name = how + ' mid-' + t;
        if (only && !only.includes(name)) continue;
        await tool(t);
        const d0 = await readDoc();
        const h0 = await histLabels();
        await MID[t]();
        if (how === 'esc') await esc(); else await tool('select');
        const d1 = await readDoc();
        const h1 = await histLabels();
        await tool('select');
        await undoKey(); const d2 = await readDoc();
        await redoKey(); const d3 = await readDoc();
        const row = { name, leftBy: diff(d0, d1), exact: canon(d1) === canon(d0), orphans: orphans(d1, d0), undoIsPreviousStep: canon(d2) !== canon(d0), redoBack: canon(d3) === canon(d0) };
        if (h0) { row.historyBefore = h0.length; row.historyAfterCancel = h1.length; }
        rows.push(row); console.log('ROW ' + name.padEnd(26), JSON.stringify(row));
        results[name] = { row };
        want(name, (r) => r.row.exact, 'the cancelled draw leaves the document unchanged (no orphan start point)');
        want(name, (r) => r.row.undoIsPreviousStep, 'Ctrl+Z after a cancelled draw undoes the PREVIOUS element (no step for the cancelled one)');
        want(name, (r) => r.row.historyBefore === undefined || r.row.historyBefore === r.row.historyAfterCancel, 'a cancelled draw leaves the undo stack exactly as it was');
        want(name, (r) => r.row.redoBack, 'Ctrl+Y after that brings the previous element back');
      }
    }
    // LINE_CHAIN_UNDO = 'per-tool-session' (the declared switch, packages/core/settings-manager.js): the WHOLE chain is ONE step
    if (!only || only.includes('chain per-tool-session')) {
      await evalJs("import('/packages/core/settings-manager.js').then((m) => { m.default.set('LINE_CHAIN_UNDO', 'per-tool-session'); return 1; })");
      await tool('line');
      const d0 = await readDoc();
      // starts ON an existing point (the end of the first line scenario, world (-150,-300) -> screen offset (-150,-300)), then 3 lines
      await clicks(P(-150, -300), P(-100, 50), P(-20, 20), P(-60, -60)); await esc();
      const d3 = await readDoc();
      await undoKey(); const d1 = await readDoc();
      await redoKey(); const dr = await readDoc();
      const keptPts = Object.keys(jmap(d0)).every((k) => k in jmap(d1));
      const row = { name: 'chain per-tool-session', drawn: diff(d0, d3), afterOneUndo: diff(d0, d1), exact: canon(d1) === canon(d0), orphans: orphans(d1, d0), existingPointsKept: keptPts, redoExact: canon(dr) === canon(d3), linesDrawn: d3.shapes.filter((x) => x.type === 'line').length - d0.shapes.filter((x) => x.type === 'line').length };
      rows.push(row); console.log('ROW chain per-tool-session  ', JSON.stringify(row));
      results['chain per-tool-session'] = { row };
      await evalJs("import('/packages/core/settings-manager.js').then((m) => { m.default.set('LINE_CHAIN_UNDO', 'per-segment'); return 1; })");
      want('chain per-tool-session', (r) => r.row.linesDrawn === 3, 'a 3-line chain was drawn');
      want('chain per-tool-session', (r) => r.row.exact && r.row.orphans.length === 0, 'ONE Ctrl+Z removes all three lines and their new points (the pre-chain document exactly)');
      want('chain per-tool-session', (r) => r.row.existingPointsKept, 'none of the pre-existing points is removed');
      want('chain per-tool-session', (r) => r.row.redoExact, 'ONE Ctrl+Y restores the whole chain exactly');
    }
    for (const n of ['line empty-to-empty', 'line from existing point', 'rect', 'circle', 'arc', 'polygon', 'bezier', 'fillet']) {
      want(n, (r) => r.row.undoExact, 'one Ctrl+Z must restore the pre-draw document exactly');
      want(n, (r) => r.row.orphansAfterUndo.length === 0, 'no orphan joint after undo');
      want(n, (r) => r.row.redoExact, 'Ctrl+Y must restore the drawn element exactly');
    }
    console.log('TABLE', JSON.stringify(rows));
    if (asserts.length) failed = new Error('draw-undo (' + HOST + ') failures:\n  ' + asserts.join('\n  '));
    else console.log('draw-undo-live ' + HOST + ': ok');
    ws.close();
  } catch (e) { failed = e; } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
  if (failed) { console.error(failed.message || failed); process.exitCode = 1; }
})();
