// tests/chain-select-move-live.test.js -- TASK 588 in the REAL SketchStudio (headless, REAL mouse and keys via CDP): the real-pointer twin of
// tests/chain-select-move-node.test.js.
//  1. A real DOUBLE CLICK (two presses within the app's 500 ms pairing window, the browser's clickCount 1 then 2) on one edge of a rectangle
//     selects its 4 edges and not the separate line S beside it.
//  2. Shift + click adds S; a real drag of S (pressed on its body) MOVES THE WHOLE SELECTION by the cursor's displacement: the rectangle stays
//     a rectangle, the unselected line W does not move. Ctrl+Z puts everything back in ONE step, Ctrl+Y redoes it identically.
// Selection and geometry are read from the drawn canvas: a selected shape is stroked in the selection colour (var(--sk-selection)) while the
// pointer is away from it (hover uses the same colour; the default hover colour is a literal, task 614); line ends in world units, through the canvas transform.
// Screenshots (EVIDENCE_DIR, when set): the chain selected, the selection after the move.
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const HOVER_LITERAL = '#017afd'; // the --sk-selection blue (also its var() fallback)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(10, 10)], ['r2', J(50, 10)], ['r3', J(50, 40)], ['r4', J(10, 40)],
    ['s1', J(65, 10)], ['s2', J(80, 35)], ['w1', J(-20, -20)], ['w2', J(-5, -30)]],
  shapes: [['rE1', 'r1', 'r2'], ['rE2', 'r2', 'r3'], ['rE3', 'r3', 'r4'], ['rE4', 'r4', 'r1'], ['S', 's1', 's2'], ['W', 'w1', 'w2']]
    .map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false })),
  constraints: [{ type: 'horizontal', joints: ['r1', 'r2'] }, { type: 'vertical', joints: ['r2', 'r3'] }, { type: 'horizontal', joints: ['r3', 'r4'] }, { type: 'vertical', joints: ['r4', 'r1'] }],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
const EDGES = ['rE1', 'rE2', 'rE3', 'rE4'];

await (async () => {
  const cdp = await launchBrowser({ tag: '588' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp } = cdp;
  const md5s = [];
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const SHIFT = 8;
    const mouse = (type, x, y, buttons, clickCount, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : (clickCount || 1) });
    // line ends (world) by shape id, the selected shape ids (stroked in the selection colour), and the canvas transform
    const geo = () => evalJs(`(() => { const ls = {}, sel = []; const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM();
      for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) { ls[e.dataset.shapeId] = [+e.getAttribute('x1'), +e.getAttribute('y1'), +e.getAttribute('x2'), +e.getAttribute('y2')]; const st = (e.getAttribute('style') || '').toLowerCase(); if (st.includes('--sk-selection') || st.includes(${JSON.stringify(HOVER_LITERAL)})) sel.push(e.dataset.shapeId); }
      return JSON.stringify({ ls, sel: sel.sort(), m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse);
    const toS = (g, x, y) => ({ x: Math.round(g.m[0] * x + g.m[2] * y + g.m[4]), y: Math.round(g.m[1] * x + g.m[3] * y + g.m[5]) });
    const toW = (g, sx, sy) => { const [a, b, c, d, e, f] = g.m, det = a * d - b * c; return { x: (d * (sx - e) - c * (sy - f)) / det, y: (-b * (sx - e) + a * (sy - f)) / det }; };
    const on = (g, id, t) => { const v = g.ls[id]; return toS(g, v[0] + (v[2] - v[0]) * t, v[1] + (v[3] - v[1]) * t); };
    const away = async (g) => { const p = toS(g, 30, -45); await mouse('mouseMoved', p.x, p.y, 0); await sleep(250); }; // empty canvas: no hover
    const shot = async (name, g) => {
      const a = toS(g, 0, 50), b = toS(g, 95, -10);
      const clip = { x: Math.min(a.x, b.x) - 20, y: Math.min(a.y, b.y) - 20, width: Math.abs(b.x - a.x) + 40, height: Math.abs(b.y - a.y) + 40, scale: 2 };
      const r = await send('Page.captureScreenshot', { format: 'png', clip });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      md5s.push(name + '=' + createHash('md5').update(buf).digest('hex'));
    };

    // the drawing in a NAMED design (task 558: only a named design is stored), reloaded: the app restores and frames it
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 588', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);

    // 1. a real double click on the rectangle's bottom edge
    let g = await geo();
    assert.deepStrictEqual(Object.keys(g.ls).sort(), [...EDGES, 'S', 'W'].sort(), 'the six lines are drawn');
    const p = on(g, 'rE1', 0.3);
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(120);
    await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90);
    await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(200);
    await away(g); g = await geo();
    console.log('1. double click on rE1: selected [' + g.sel.join(' ') + ']');
    assert.deepStrictEqual(g.sel, EDGES, 'the real double click selects the 4 edges of the rectangle, not the separate line');
    await shot('588-live-chain-selected.png', g);

    // 2. Shift + click S, then a real drag of S by (+80, -50) px: the whole selection moves
    const q = on(g, 'S', 0.5);
    await mouse('mouseMoved', q.x, q.y, 0, 0, SHIFT); await sleep(80);
    await mouse('mousePressed', q.x, q.y, 1, 1, SHIFT); await sleep(60); await mouse('mouseReleased', q.x, q.y, 0, 1, SHIFT); await sleep(700); // > 500 ms: the drag's press is not a double click
    await away(g); g = await geo();
    assert.deepStrictEqual(g.sel, [...EDGES, 'S'].sort(), 'Shift + click adds S');
    const before = g;
    const end = { x: q.x + 80, y: q.y - 50 };
    await mouse('mouseMoved', q.x, q.y, 0); await sleep(80); await mouse('mousePressed', q.x, q.y, 1, 1); await sleep(60);
    for (let i = 1; i <= 16; i++) { await mouse('mouseMoved', Math.round(q.x + (end.x - q.x) * i / 16), Math.round(q.y + (end.y - q.y) * i / 16), 1); await sleep(25); }
    await sleep(100); await mouse('mouseReleased', end.x, end.y, 0, 1); await sleep(400);
    await away(before); g = await geo();
    const w0 = toW(before, q.x, q.y), w1 = toW(before, end.x, end.y), d = { x: w1.x - w0.x, y: w1.y - w0.y };
    const moved = (id) => { const a = before.ls[id], b = g.ls[id]; return [b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3]]; };
    const err = Math.max(...[...EDGES, 'S'].map((id) => { const m = moved(id); return Math.max(Math.abs(m[0] - d.x), Math.abs(m[1] - d.y), Math.abs(m[2] - d.x), Math.abs(m[3] - d.y)); }));
    const wMoved = Math.max(...moved('W').map(Math.abs));
    const rectOk = Math.abs(g.ls.rE1[1] - g.ls.rE1[3]) < 1e-6 && Math.abs(g.ls.rE2[0] - g.ls.rE2[2]) < 1e-6;
    console.log(`2. drag of S by (80, -50) px = (${d.x.toFixed(3)}, ${d.y.toFixed(3)}) mm: worst selected-end error ${err.toExponential(2)} mm, W moved ${wMoved} mm, rectangle H/V hold ${rectOk}, selected after [${g.sel.join(' ')}]`);
    assert.ok(Math.hypot(d.x, d.y) > 3, 'the cursor moved several mm');
    assert.ok(err < 1e-3, 'every end of the selection moved by the cursor displacement (worst ' + err + ' mm)');
    assert.ok(wMoved === 0, 'the unselected line W did not move');
    assert.ok(rectOk, 'the rectangle stays a rectangle (H / V hold)');
    assert.deepStrictEqual(g.sel, [...EDGES, 'S'].sort(), 'the selection is kept');
    await shot('588-live-selection-moved.png', g);
    const after = g;

    // ONE undo step: Ctrl+Z puts every line back; Ctrl+Y redoes it identically
    await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(400); g = await geo();
    assert.deepStrictEqual(g.ls, before.ls, 'one Ctrl+Z restores the drawing as it was before the move');
    await sendRealKey(send, 'y', 'KeyY', 89, 2); await sleep(400); g = await geo();
    assert.deepStrictEqual(g.ls, after.ls, 'Ctrl+Y redoes the move identically');
    console.log('3. Ctrl+Z restored, Ctrl+Y redid identically; screenshots ' + md5s.join(' '));
    console.log('chain-select-move-live.test.js: ok');
  } finally { await cdp.close(); }
})();
