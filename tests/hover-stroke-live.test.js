// tests/hover-stroke-live.test.js — TASK 626: live CDP verification of thicker-stroke-only hover & selection in bright Fusion blue (#017AFD) with zero glow/halo elements.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const SELECTION_MULT = (await import('../packages/core/settings-manager.js')).default.getDefault('SELECTION_FEEDBACK_MULT');

const J = (x, y, fixed = false) => ({ x, y, fixed, sketchId: 'sketch-1' });
const DOC = {
  version: 3,
  hosts: {},
  geometry: {
    joints: [
      ['j_origin', J(0, 0, true)],
      ['r1', J(80, 0)],
      ['r2', J(80, 60)],
      ['r3', J(0, 60)],
      ['p1', J(120, 10)],
      ['p2', J(170, 10)],
      ['p3', J(185, 65)],
    ],
    shapes: [
      { id: 'rE1', type: 'line', joints: ['j_origin', 'r1'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE2', type: 'line', joints: ['r1', 'r2'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE3', type: 'line', joints: ['r2', 'r3'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'rE4', type: 'line', joints: ['r3', 'j_origin'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'pE1', type: 'line', joints: ['p1', 'p2'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'pE2', type: 'line', joints: ['p2', 'p3'], sketchId: 'sketch-1', isConstruction: false },
    ],
    constraints: [
      { type: 'horizontal', joints: ['j_origin', 'r1'] },
      { type: 'vertical', joints: ['r1', 'r2'] },
      { type: 'horizontal', joints: ['r2', 'r3'] },
      { type: 'vertical', joints: ['r3', 'j_origin'] },
      { type: 'distance', joints: ['j_origin', 'r1'], value: 80, offset: -15 },
      { type: 'distance', joints: ['j_origin', 'r3'], value: 60, offset: -15 },
      { type: 'horizontal', joints: ['p1', 'p2'] },
    ],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1',
    groups: [], profiles: [], parameters: [], vcarves: [],
  },
};

const cdp = await launchBrowser({ tag: '626-live', width: 1440, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate, waitForApp } = cdp;

try {
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
  const mouse = (type, x, y, buttons = 0, clickCount = 0) =>
    send('Input.dispatchMouseEvent', {
      type, x, y,
      button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : (clickCount || 1),
    });
  const clickAt = async (x, y) => {
    await mouse('mouseMoved', x, y); await sleep(80);
    await mouse('mousePressed', x, y, 1, 1); await sleep(40);
    await mouse('mouseReleased', x, y, 0, 1); await sleep(180);
  };
  const clearAll = async (emptyPt) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await mouse('mouseMoved', emptyPt.x, emptyPt.y);
    await sleep(180);
  };

  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
  await installFakeDriveSession(cdp); // TASK 624: a named design is saved on (fake) Google Drive only
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 626 Live', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); await s.flushDrive(); return d.id; })`);
  await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
  await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);

  const inspect = () => evalJs(`(() => {
    const svg = document.getElementById('svgCanvas');
    const m = svg.querySelector('.shape-elem').getScreenCTM();
    const scr = (wx, wy) => ({ x: wx * m.a + m.e, y: wy * m.d + m.f });
    const shapes = {};
    for (const el of svg.querySelectorAll('.shape-elem')) {
      const cs = getComputedStyle(el);
      shapes[el.dataset.shapeId] = {
        sw: Number(el.getAttribute('stroke-width')),
        stroke: cs.stroke,
        style: el.getAttribute('style') || '',
      };
    }
    const glowEls = [...svg.querySelectorAll('line, circle, path, rect')].filter((el) => {
      const op = el.getAttribute('stroke-opacity') || el.getAttribute('fill-opacity');
      return op === '0.28' || op === '0.2' || op === '0.4' || op === '0.5';
    });
    const points = {};
    for (const c of svg.querySelectorAll('circle')) {
      const st = c.getAttribute('style') || '';
      if (!st.includes('--sk-joint-')) continue;
      const key = Math.round(Number(c.getAttribute('cx'))) + ',' + Math.round(Number(c.getAttribute('cy')));
      points[key] = {
        sw: Number(c.getAttribute('stroke-width')),
        stroke: getComputedStyle(c).stroke,
        fill: getComputedStyle(c).fill,
        style: st,
      };
    }
    const glyphs = [...svg.querySelectorAll('g.constraint-glyph .fusion-glyph')];
    const lastGlyph = glyphs[glyphs.length - 1];
    const gr = lastGlyph.getBoundingClientRect();
    return {
      pts: {
        empty: scr(100, 35),
        freeLine: scr(177.5, 37.5),
        constrainedLine: scr(80, 30),
        cornerR2: scr(80, 60),
        openEndP3: scr(185, 65),
        glyph: { x: gr.left + gr.width / 2, y: gr.top + gr.height / 2 },
      },
      shapes,
      points,
      glyph: {
        sw: Number(lastGlyph.getAttribute('stroke-width')),
        stroke: getComputedStyle(lastGlyph).stroke,
        style: lastGlyph.getAttribute('style') || '',
      },
      glowCount: glowEls.length,
    };
  })()`);

  let s = await inspect();
  await clearAll(s.pts.empty);
  s = await inspect();
  const restLineSw = s.shapes.pE2.sw;
  const restJointSw = s.points['185,65'].sw;
  const restGlyphSw = s.glyph.sw;
  assert.strictEqual(s.glowCount, 0, 'idle: 0 glow/halo elements');
  assert.strictEqual(s.shapes.rE2.stroke, 'rgb(0, 0, 0)', 'constrained line at rest is black');
  assert.strictEqual(s.shapes.pE2.stroke, 'rgb(43, 155, 214)', 'free line at rest is cyan-blue #2B9BD6');

  // 1. Hover free line pE2: bold (2x) and bright Fusion blue rgb(1, 122, 253), 0 glows
  await mouse('mouseMoved', s.pts.freeLine.x, s.pts.freeLine.y); await sleep(200);
  s = await inspect();
  assert.strictEqual(s.glowCount, 0, 'hovered line: 0 glow elements');
  assert.ok(Math.abs(s.shapes.pE2.sw - restLineSw * 2) < 1e-5, 'hovered line stroke-width is 2x rest');
  assert.strictEqual(s.shapes.pE2.stroke, 'rgb(1, 122, 253)', 'hovered free line turns bright Fusion blue #017AFD');

  // 2. Click constrained line rE2: bold (1.5x) and bright Fusion blue rgb(1, 122, 253), 0 glows
  await clearAll(s.pts.empty);
  await clickAt(s.pts.constrainedLine.x, s.pts.constrainedLine.y);
  await mouse('mouseMoved', s.pts.empty.x, s.pts.empty.y); await sleep(200);
  s = await inspect();
  assert.strictEqual(s.glowCount, 0, 'selected constrained line: 0 glow elements');
  assert.ok(Math.abs(s.shapes.rE2.sw - restLineSw * SELECTION_MULT) < 1e-5, 'selected constrained line stroke-width is SELECTION_FEEDBACK_MULT x rest');
  assert.strictEqual(s.shapes.rE2.stroke, 'rgb(1, 122, 253)', 'selected constrained line turns bright Fusion blue #017AFD');

  // 3. Hover corner point r2 (80, 60): revealed with 2x ring in bright Fusion blue, white fill, 0 halos
  await clearAll(s.pts.empty);
  await mouse('mouseMoved', s.pts.cornerR2.x, s.pts.cornerR2.y); await sleep(200);
  s = await inspect();
  assert.strictEqual(s.glowCount, 0, 'hovered point: 0 halo elements');
  assert.ok(s.points['80,60'], 'hovered corner r2 is visible');
  assert.ok(Math.abs(s.points['80,60'].sw - restJointSw) < 1e-5, 'hovered point ring is the rest joint stroke');
  assert.strictEqual(s.points['80,60'].stroke, 'rgb(0, 0, 0)', 'hovered point ring is 100% black');
  assert.strictEqual(s.points['80,60'].fill, 'rgb(255, 255, 255)', 'hovered point fill stays white');

  // 4. Click open end p3 (185, 65): 1.5x ring in bright Fusion blue, blue-tinted fill, 0 halos
  await clearAll(s.pts.empty);
  await clickAt(s.pts.openEndP3.x, s.pts.openEndP3.y);
  await mouse('mouseMoved', s.pts.empty.x, s.pts.empty.y); await sleep(200);
  s = await inspect();
  assert.strictEqual(s.glowCount, 0, 'selected point: 0 halo elements');
  assert.ok(Math.abs(s.points['185,65'].sw -   restJointSw) < 1e-5, 'selected point ring is the rest joint stroke');
    assert.strictEqual(s.points['185,65'].stroke, 'rgb(0, 0, 0)', 'selected point ring is 100% black');
  assert.strictEqual(s.points['185,65'].fill, 'rgb(118, 164, 228)', 'selected point fill is blue tint #76A4E4');

  // 5. Hover constraint glyph: 2x outline in --sk-glyph-hover, bound line pE1 2x in --sk-glyph-hover, 0 halos
  await clearAll(s.pts.empty);
  await mouse('mouseMoved', s.pts.glyph.x, s.pts.glyph.y); await sleep(220);
  s = await inspect();
  assert.strictEqual(s.glowCount, 0, 'hovered glyph: 0 halo discs');
  assert.ok(Math.abs(s.glyph.sw - restGlyphSw * 2) < 1e-3, 'hovered glyph outline is 2x rest');
  assert.strictEqual(s.glyph.stroke, 'rgb(234, 179, 8)', 'hovered glyph outline is --sk-glyph-hover #eab308');
  assert.ok(Math.abs(s.shapes.pE1.sw - restLineSw * 2) < 1e-5, 'bound line on glyph hover is 2x rest');
  assert.strictEqual(s.shapes.pE1.stroke, 'rgb(234, 179, 8)', 'bound line on glyph hover is --sk-glyph-hover #eab308');

  console.log('hover-stroke-live.test.js passed');
} finally {
  await cdp.close();
}
