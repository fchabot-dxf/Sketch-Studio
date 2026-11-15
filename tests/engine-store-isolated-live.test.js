// tests/engine-store-isolated-live.test.js - TASK 679 in the REAL SketchStudio page (headless, real mouse via CDP): a rectangle is drawn
// with the Rectangle tool, then ONE evalJs builds a second, headless sketch through the same core modules the page loaded
// (#core/constraint-solver.js createEngine + init, #core/sketch-state.js createSketchState, ConstraintManager) and solves it. The open
// design keeps the same joints (the drawn joint handles' ids + the drawn lines' world ends) and still draws and solves: a dragged corner
// moves and its rectangle stays a rectangle (every drawn edge stays horizontal or vertical). Before task 679 the engine store was
// module-level, so the headless init() wiped the open design.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '679live' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const SEL = '#svgCanvas';
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const tool = (t) => evalJs(`document.getElementById('tool-${t}').click()`).then(() => sleep(150));
    const frames = async (n) => { for (let f = 0; f < n; f++) await evalJs(`new Promise(r => requestAnimationFrame(() => r(true)))`); };
    // the drawn design: every joint handle (id + world position), every drawn shape element, and every drawn line (world + screen ends).
    // Only the origin draws a handle at rest, so the corners are read from the lines' world ends.
    const drawn = () => evalJs(`JSON.stringify({
      handles: [...document.querySelectorAll('${SEL} .joint-handle[data-joint-id]')].map(e => [e.dataset.jointId, +e.getAttribute('cx'), +e.getAttribute('cy')]).sort((a, b) => a[0] < b[0] ? -1 : 1),
      shapeElems: document.querySelectorAll('${SEL} .shape-elem').length,
      lines: [...document.querySelectorAll('${SEL} line.shape-elem')].map(e => { const m = e.getScreenCTM(); const P = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; return { w: [+e.getAttribute('x1'), +e.getAttribute('y1'), +e.getAttribute('x2'), +e.getAttribute('y2')], s: [...P(+e.getAttribute('x1'), +e.getAttribute('y1')), ...P(+e.getAttribute('x2'), +e.getAttribute('y2'))] }; })
    })`).then(JSON.parse);

    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000);
    await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false, GRID_MAGNETISM: 0.001 })); return true; })()`);
    await navigate(url, 8000);
    await waitFor(`(() => { const c = document.querySelector('${SEL}'); return !!c && c.getBoundingClientRect().width > 0 && c.dataset.docReady === '1' && !!document.getElementById('tool-select'); })()`, 'sketchstudio ready');
    await sleep(600);

    // 1. the open design: a rectangle drawn with the Rectangle tool
    const c = await evalJs(`(() => { const r = document.querySelector('${SEL}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await tool('rect'); await click(c.x - 220, c.y - 160); await click(c.x - 60, c.y - 40);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150);
    await tool('select'); await frames(5);
    const before = await drawn();
    assert.strictEqual(before.lines.length, 4, `the open design draws its rectangle (lines ${before.lines.length})`);
    const corners = (d) => [...new Set(d.lines.flatMap(l => [l.w[0] + ',' + l.w[1], l.w[2] + ',' + l.w[3]]))].sort();
    assert.strictEqual(corners(before).length, 4, `the rectangle has 4 corners (${corners(before).join(' ')})`);
    assert.ok(before.handles.some(h => h[0] === 'j_origin'), 'the origin is drawn');

    // 2. ONE evalJs: a second sketch, headless, through the same core modules the page loaded; built and solved
    const headless = await evalJs(`(async () => {
      const { createEngine } = await import('#core/constraint-solver.js');
      const { createSketchState } = await import('#core/sketch-state.js');
      const { ConstraintManager } = await import('#core/constraint-manager.js');
      const { CONSTRAINT_TYPES } = await import('#core/constants.js');
      const e = createEngine(null); e.init();
      const s = createSketchState(e, { x: 0, y: 0, w: 100, h: 100 });
      const t = [e.genJ(), e.genJ(), e.genJ()];
      e.addJoint(t[0], 500, 500, false); e.addJoint(t[1], 560, 500, false); e.addJoint(t[2], 530, 550, false);
      for (let i = 0; i < 3; i++) e.addShape({ id: 'tri679_' + i, type: 'line', joints: [t[i], t[(i + 1) % 3]] });
      ConstraintManager.createConstraint(s, CONSTRAINT_TYPES.DISTANCE, { joints: [t[0], t[1]], value: 40 }, { source: 'dim' });
      const r = e.solve(500);
      const a = s.joints.get(t[0]), b = s.joints.get(t[1]);
      return JSON.stringify({ ids: t, joints: s.joints.size, shapes: s.shapes.length, constraints: s.constraints.length, converged: r.converged, len: Math.hypot(b.x - a.x, b.y - a.y) });
    })()`).then(JSON.parse);
    console.log(`headless sketch in the page: ${headless.joints} joints, ${headless.shapes} shapes, ${headless.constraints} constraints, converged=${headless.converged}, dimensioned edge ${headless.len.toFixed(4)}`);
    assert.strictEqual(headless.converged, true, 'the headless sketch solves');
    assert.ok(Math.abs(headless.len - 40) < 1e-3, 'the headless sketch holds its dimension');

    // 3. the open design is unchanged: same joint ids, same world positions, same lines; none of the headless joints is drawn
    await frames(5);
    const after = await drawn();
    assert.deepStrictEqual(after.handles, before.handles, 'the open design draws the same joint handles (ids + positions)');
    assert.deepStrictEqual(after.lines.map(l => l.w), before.lines.map(l => l.w), 'the open design draws the same lines at the same world ends');
    assert.deepStrictEqual(corners(after), corners(before), 'the rectangle keeps its 4 corners');
    assert.strictEqual(after.shapeElems, before.shapeElems, 'the same number of drawn shape elements');
    for (const id of headless.ids) assert.ok(!after.handles.some(j => j[0] === id), `the headless joint ${id} is not drawn in the open design`);
    console.log(`open design after the headless build: corners ${corners(after).join(' ')} (unchanged), ${after.lines.length} lines, ${after.shapeElems} shape elements`);

    // 4. it still solves and draws: drag the rectangle's lower-right corner (the second click), real mouse
    let grab = null;
    for (const l of after.lines) for (const k of [0, 2]) { const d = Math.hypot(l.s[k] - (c.x - 60), l.s[k + 1] - (c.y - 40)); if (!grab || d < grab.d) grab = { d, x: l.s[k], y: l.s[k + 1] }; }
    assert.ok(grab.d < 3, `the corner is drawn where it was placed (${grab.d.toFixed(2)} px)`);
    await mouse('mouseMoved', grab.x, grab.y, 0); await sleep(40); await mouse('mousePressed', grab.x, grab.y, 1); await sleep(60);
    for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', grab.x + 10 * i, grab.y + 6 * i, 1); await sleep(16); }
    await mouse('mouseReleased', grab.x + 80, grab.y + 48, 0); await sleep(300); await frames(5);
    const dragged = await drawn();
    assert.strictEqual(dragged.lines.length, 4, 'still 4 lines after the drag');
    const moved = corners(dragged).filter(k => !corners(after).includes(k));
    assert.ok(moved.length >= 1, `the drag moved corners (${moved.length}: ${corners(after).join(' ')} -> ${corners(dragged).join(' ')})`);
    assert.strictEqual(corners(dragged).length, 4, 'still 4 corners after the drag');
    let near = null;
    for (const l of dragged.lines) for (const k of [0, 2]) { const d = Math.hypot(l.s[k] - (grab.x + 80), l.s[k + 1] - (grab.y + 48)); if (!near || d < near) near = d; }
    assert.ok(near < 1, `the dragged corner is drawn under the release point (${near.toFixed(2)} px)`);
    for (const l of dragged.lines) {
      const [x1, y1, x2, y2] = l.w;
      assert.ok(Math.abs(x1 - x2) < 1e-4 || Math.abs(y1 - y2) < 1e-4, `every edge stays horizontal or vertical after the solve (${l.w.map(v => v.toFixed(3)).join(',')})`);
    }
    console.log(`drag: ${moved.length} corners moved, the corner is ${near.toFixed(2)} px from the release point, all 4 edges horizontal/vertical`);
    console.log('engine-store-isolated-live: ok');
  } finally { await cdp.close(); }
})();
