// tests/joint-display-live.test.js — TASK 622: real-pointer CDP verification of Fusion-style point display
// in SketchStudio (rectangle corners hidden until hovered/selected, open polyline shows 2 ends, arc shows center + ends,
// dark thin outline always kept, selected point filled blue tint, hover uses true-blue HOVER_COLOR).
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const HOVER_COLOR = '#017afd'; // the --sk-selection blue: hover has no setting
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const DOC = {
  version: 3,
  hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['r1', J(10, 10)], ['r2', J(50, 10)], ['r3', J(50, 40)], ['r4', J(10, 40)],
      ['p1', J(65, 10)], ['p2', J(85, 35)], ['p3', J(105, 15)],
      ['aC', J(30, -25)], ['aS', J(45, -25)], ['aE', J(30, -10)],
    ],
    shapes: [
      { id: 'rE1', type: 'line', joints: ['r1', 'r2'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE2', type: 'line', joints: ['r2', 'r3'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE3', type: 'line', joints: ['r3', 'r4'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE4', type: 'line', joints: ['r4', 'r1'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'pE1', type: 'line', joints: ['p1', 'p2'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'pE2', type: 'line', joints: ['p2', 'p3'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['aC', 'aS', 'aE'], radius: 15, sketchId: 'sketch-1', isConstruction: false },
    ],
    constraints: [
      { type: 'horizontal', joints: ['r1', 'r2'] },
      { type: 'vertical', joints: ['r2', 'r3'] },
      { type: 'horizontal', joints: ['r3', 'r4'] },
      { type: 'vertical', joints: ['r4', 'r1'] },
    ],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1',
    groups: [], profiles: [], parameters: [], vcarves: [],
  },
};

const cdp = await launchBrowser({ tag: '622', width: 1440, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate, waitForApp } = cdp;
const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });
const md5s = [];

try {
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
  const mouse = (type, x, y, buttons = 0, clickCount = 0) =>
    send('Input.dispatchMouseEvent', {
      type, x, y,
      button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : (clickCount || 1),
    });

  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 622 Live', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
  await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
  await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);

  const readCanvas = () => evalJs(`(() => {
    const svg = document.getElementById('svgCanvas');
    const m = svg.querySelector('.shape-elem').getScreenCTM();
    const toS = (x, y) => ({ x: Math.round(m.a * x + m.c * y + m.e), y: Math.round(m.b * x + m.d * y + m.f) });
    const points = [], halos = [];
    for (const c of svg.querySelectorAll('circle')) {
      if (c.classList.contains('joint-handle')) continue;
      const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
      if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) continue;
      const st = c.getAttribute('style') || '';
      const cs = getComputedStyle(c);
      if ((c.getAttribute('fill') || '') === 'none' || cs.fill === 'none') {
        if (+c.getAttribute('stroke-opacity') === 0.18) continue; // subtle arc handle ring
        halos.push({ cx, cy, styleStroke: (st.match(/stroke:\\s*([^;]+)/) || [])[1] || '', stroke: cs.stroke });
      } else {
        points.push({ cx, cy, styleFill: (st.match(/fill:\\s*([^;]+)/) || [])[1] || '', styleStroke: (st.match(/stroke:\\s*([^;]+)/) || [])[1] || '', fill: cs.fill, stroke: cs.stroke });
      }
    }
    return {
      points: points.sort((a, b) => a.cx - b.cx || a.cy - b.cy),
      halos,
      away: (() => {
        const cr = svg.getBoundingClientRect();
        const boxes = [...svg.querySelectorAll('.shape-elem, circle')].map((e) => e.getBoundingClientRect());
        for (let fy = 0.25; fy < 0.9; fy += 0.15) for (let fx = 0.25; fx < 0.9; fx += 0.15) {
          const x = Math.round(cr.left + cr.width * fx), y = Math.round(cr.top + cr.height * fy);
          if (boxes.some((b) => x >= b.left - 40 && x <= b.right + 40 && y >= b.top - 40 && y <= b.bottom + 40)) continue;
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('#svgCanvas')) return { x, y };
        }
        return toS(130, -35);
      })(),
      r3: toS(50, 40),
      p1: toS(65, 10),
      p2: toS(85, 35),
      a0: toS(-5, -35),
      a1: toS(120, 50),
    };
  })()`);

  const shotClip = async (name, clip) => {
    if (!EVID) return;
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(EVID, name), buf);
    md5s.push(name + '=' + createHash('md5').update(buf).digest('hex'));
  };

  // 1. Clean idle state: 0 rectangle corners, 0 polyline middle corner, 5 points shown (p1, p3, aC, aS, aE)
  let s = await readCanvas();
  await mouse('mouseMoved', s.away.x, s.away.y, 0); await sleep(200);
  s = await readCanvas();
  assert.deepStrictEqual(
    s.points.map((p) => `${p.cx},${p.cy}`),
    ['30,-25', '30,-10', '45,-25', '65,10', '105,15'],
    'idle: rectangle corners and polyline middle corner hidden; only polyline open ends (2) and arc center + open ends (3) visible'
  );
  assert.strictEqual(s.halos.length, 0, 'idle: no hover halos');
  for (const p of s.points) {
    assert.match(p.styleFill, /--sk-joint-fill/, 'idle point uses white fill');
    assert.match(p.styleStroke, /--sk-joint-ring.*#333333/, 'idle point uses the 80% black ring');
  }

  // 2. Real mouse hover over hidden rectangle corner r3 (50, 40)
  await mouse('mouseMoved', s.r3.x, s.r3.y, 0); await sleep(200);
  s = await readCanvas();
  const r3Dot = s.points.find((p) => p.cx === 50 && p.cy === 40);
  assert.ok(r3Dot, 'hovering hidden rectangle corner reveals it');
  assert.match(r3Dot.styleStroke, /--sk-joint-ring-hover.*#000000/i, 'hovered corner ring is 100% black (no blue)');
  assert.strictEqual(s.halos.length, 0, 'hovered corner draws no outer halo');

  // 3. Move away -> r3 hides again
  await mouse('mouseMoved', s.away.x, s.away.y, 0); await sleep(200);
  s = await readCanvas();
  assert.strictEqual(s.points.length, 5, 'moving away hides rectangle corner again');

  // 4. Real mouse hover over hidden polyline middle corner p2 (85, 35)
  await mouse('mouseMoved', s.p2.x, s.p2.y, 0); await sleep(200);
  s = await readCanvas();
  assert.ok(s.points.some((p) => p.cx === 85 && p.cy === 35), 'hovering hidden polyline middle corner reveals it');

  // 5. Click open polyline end p1 (65, 10) to select it, move away, verify blue-tinted fill + bright-blue ring outline
  await mouse('mouseMoved', s.p1.x, s.p1.y, 0); await sleep(120);
  await mouse('mousePressed', s.p1.x, s.p1.y, 1, 1); await sleep(60);
  await mouse('mouseReleased', s.p1.x, s.p1.y, 0, 1); await sleep(180);
  await mouse('mouseMoved', s.away.x, s.away.y, 0); await sleep(200);
  s = await readCanvas();
  const p1Dot = s.points.find((p) => p.cx === 65 && p.cy === 10);
  assert.ok(p1Dot, 'selected open end visible');
  assert.match(p1Dot.styleFill, /--sk-joint-selected/, 'selected point has blue-tinted fill');
  assert.match(p1Dot.styleStroke, /--sk-joint-ring-hover.*#000000/i, 'selected point ring is 100% black');
  assert.strictEqual(s.halos.length, 0, 'selected point draws no outer halo');

  if (EVID) {
    // Capture p1 selected alone first, then hover r3 simultaneously for full desktop comparison with before-desktop.png
    await shotClip('after-selected.png', { x: s.p1.x - 90, y: s.p1.y - 70, width: 180, height: 140, scale: 3 });
    await mouse('mouseMoved', s.r3.x, s.r3.y, 0); await sleep(220);
    await shotClip('after-hovered.png', { x: s.r3.x - 90, y: s.r3.y - 70, width: 180, height: 140, scale: 3 });
    const x0 = Math.min(s.a0.x, s.a1.x) - 30, y0 = Math.min(s.a0.y, s.a1.y) - 30;
    const w = Math.abs(s.a1.x - s.a0.x) + 60, h = Math.abs(s.a1.y - s.a0.y) + 60;
    await shotClip('after-desktop.png', { x: x0, y: y0, width: w, height: h, scale: 2 });
  }

  // 6. Real click on hidden rectangle corner r3 (50, 40) selects it even though it was hidden when unhovered
  await mouse('mouseMoved', s.away.x, s.away.y, 0); await sleep(150);
  await mouse('mouseMoved', s.r3.x, s.r3.y, 0); await sleep(100);
  await mouse('mousePressed', s.r3.x, s.r3.y, 1, 1); await sleep(60);
  await mouse('mouseReleased', s.r3.x, s.r3.y, 0, 1); await sleep(180);
  await mouse('mouseMoved', s.away.x, s.away.y, 0); await sleep(200);
  s = await readCanvas();
  const r3Sel = s.points.find((p) => p.cx === 50 && p.cy === 40);
  assert.ok(r3Sel, 'hidden corner clicked remains visible while selected');
  assert.match(r3Sel.styleFill, /--sk-joint-selected/, 'selected corner uses blue-tinted fill');
  assert.match(r3Sel.styleStroke, /--sk-joint-ring-hover.*#000000/i, 'selected corner ring is 100% black');

  console.log('joint-display-live.test.js passed' + (md5s.length ? ' [' + md5s.join(', ') + ']' : ''));
} finally {
  await cdp.close();
}
