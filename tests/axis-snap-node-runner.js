// tests/axis-snap-node-runner.js - TASK 576 (node port of tests/axis-snap-live-runner.js, TASK 537). NOT a test file itself:
// axis-snap-{lines,shapes,session}-node.test.js each set ONLY and import it. Same scenarios at the same offsets from the origin, same
// asserts. Through tests/helpers/node-app.js; the design is read from the stored (autosaved) design as the browser test did. The axis
// highlight ([data-snap-axis]) is read from the canvas DOM the shared renderer drew. "A fresh page" is a fresh profile; "save / load" is
// close() and open() on the same profile (a reload); the AXIS_SNAP setting goes through the settings manager. The screenshots the browser
// runner wrote as evidence are not taken (they asserted nothing).

import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import settings from '#core/settings-manager.js';

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
let app = null, profile = null, failed = null;
try {
  const click = (x, y) => app.click(x, y);
  const move = (x, y) => app.move(x, y);
  const esc = () => app.esc();
  const drag = (a, b) => app.drag(a, b, 8);
  const TOOL = { l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'select' };
  const letter = (c) => app.tool(TOOL[c]);
  const jointsOf = (d) => { const jo = d && d.joints; if (!jo) return {}; const out = {}; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
  const stored = async () => { const d = await app.storedDoc(); return d && JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints })); };
  // task 539: the snap leaves a POINT-ON-LINE with the built-in axis line (ref_axis_x / ref_axis_y)
  const isAxisH = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_x';
  const isAxisV = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_y';
  const readDesign = stored;
  const drawBase = (o) => { click(o.x + 300, o.y + 200); esc(); };
  const axisHighlights = (which = '') => app.svg.querySelectorAll(which ? `[data-snap-axis="${which}"]` : '[data-snap-axis]').length;
  const fresh = async () => {
    if (app) await app.close();
    profile = await createProfile();
    await createNamedDesign(profile, 'sketchstudio'); // TASK 558: only a NAMED design autosaves (this test reads the autosave)
    app = await open({ host: 'sketchstudio', profile });
    settings.set('AXIS_SNAP', true);
  };

  const scenarios = {
    'line end on X axis': (o) => { letter('l'); click(o.x + 160, o.y - 90); click(o.x + 200, o.y + 9); esc(); },
    'line end on Y axis': (o) => { letter('l'); click(o.x + 160, o.y - 90); click(o.x + 7, o.y + 120); esc(); },
    'line start on X axis': (o) => { letter('l'); click(o.x + 160, o.y + 8); click(o.x + 260, o.y - 90); esc(); },
    'rect corner on X axis': (o) => { letter('r'); click(o.x + 150, o.y - 100); click(o.x + 250, o.y + 8); esc(); },
    'circle centre on Y axis': (o) => { letter('c'); click(o.x + 6, o.y + 120); click(o.x + 60, o.y + 120); esc(); },
    'polygon centre on X axis': (o) => { app.tool('polygon'); click(o.x + 200, o.y + 7); click(o.x + 260, o.y + 7); esc(); },
    'arc centre on X axis': (o) => { letter('a'); click(o.x + 200, o.y + 7); click(o.x + 260, o.y - 60); click(o.x + 140, o.y - 40); esc(); },
    'select drag to X axis': (o) => {
      letter('l'); click(o.x + 160, o.y - 90); click(o.x + 250, o.y - 90); esc();
      letter('s'); drag({ x: o.x + 250, y: o.y - 90 }, { x: o.x + 300, y: o.y + 10 }); esc();
    },
  };
  const results = {};
  for (const [name, run] of Object.entries(scenarios)) {
    if (only && !only.includes(name)) continue;
    await fresh();
    const o = app.toScreen(0, 0);
    drawBase(o);
    run(o);
    const d = await readDesign();
    const J = jointsOf(d);
    const h = d.constraints.filter(isAxisH), v = d.constraints.filter(isAxisV);
    const onX = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.y) < 1e-6 && Math.abs(p.x) > 1).map(([id]) => id);
    const onY = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.x) < 1e-6 && Math.abs(p.y) > 1).map(([id]) => id);
    results[name] = { shapes: d.shapes.length, h: h.length, v: v.length, onX, onY, constraints: d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+')) };
    console.log(name.padEnd(26), JSON.stringify(results[name]));
  }
  const R = results;
  const need = (name, cond, msg) => { if (only && !only.includes(name)) return; assert(R[name] && R[name].shapes >= 1, name + ': a shape was drawn'); assert(cond(R[name]), name + ': ' + msg + ' got ' + JSON.stringify(R[name])); };
  need('line end on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'end joint at y === 0 exactly with a horizontal constraint to j_origin');
  need('line end on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'end joint at x === 0 exactly with a vertical constraint to j_origin');
  need('line start on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'start joint on the X axis with a horizontal constraint');
  need('rect corner on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'a rect corner on the X axis with a horizontal constraint');
  need('circle centre on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'circle centre on the Y axis with a vertical constraint');
  need('polygon centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'polygon centre on the X axis with a horizontal constraint');
  need('arc centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'arc centre on the X axis with a horizontal constraint');
  need('select drag to X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'the dragged joint on the X axis with a horizontal constraint');

  if (!only || only.includes('session')) {
    // the line's second point stays on the axis when the FIRST point is dragged; save/load keeps it; undo removes it
    await fresh();
    let o = app.toScreen(0, 0);
    drawBase(o);
    letter('l');
    click(o.x + 160, o.y - 90);
    // pointer 60 px off the axis (no snap) / 9 px off (snap): the indicator
    move(o.x + 200, o.y + 60);
    assert(axisHighlights() === 0, 'no axis highlight 60 px off the axis');
    move(o.x + 200, o.y + 9);
    const axisHighlight = axisHighlights('axis-x');
    assert(axisHighlight >= 1, 'the X axis is highlighted while the snap is active; got ' + axisHighlight);
    click(o.x + 200, o.y + 9); esc();
    let d = await readDesign();
    let J = jointsOf(d);
    const line = d.shapes.find((s) => s.type === 'line');
    const [aId, bId] = line.joints;
    assert(J[bId].y === 0, 'end joint y is exactly 0: ' + J[bId].y);
    assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'pointOnLine(end, ref_axis_x) stored');
    // undo removes the axis constraint (the line is one undo group), redo brings it back with the end joint on the axis
    let gone = false;
    for (let i = 0; i < 4 && !gone; i++) { app.undo(); d = await readDesign(); gone = !d || !d.constraints.some((c) => isAxisH(c) && c.joint === bId); }
    assert(gone, 'undo removes the axis constraint');
    app.redo(); d = await readDesign(); J = jointsOf(d);
    assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'redo brings the axis constraint back');
    assert(Math.abs(J[bId].y) < 1e-6, 'redo: the end joint is back on the axis: ' + J[bId].y);
    // drag the first point
    letter('s');
    const a = app.toScreen(J[aId].x, J[aId].y);
    drag(a, { x: a.x + 30, y: a.y - 60 });
    esc();
    d = await readDesign(); J = jointsOf(d);
    assert(Math.abs(J[bId].y) < 1e-6, 'the end joint stays on the axis after the first point is dragged: ' + J[bId].y);
    // save / load: a reload of the same profile
    await app.close();
    app = await open({ host: 'sketchstudio', profile });
    d = await stored(); J = jointsOf(d);
    assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'the constraint survives save/load');
    assert(Math.abs(J[bId].y) < 1e-6, 'the end joint is still on the axis after load: ' + J[bId].y);
    console.log('line end: undo-redo / drag-first-point / save-load ok');
  }

  // setting off: no axis snap
  if (!only || only.includes('setting off')) {
    await fresh();
    settings.set('AXIS_SNAP', false);
    const o = app.toScreen(0, 0);
    drawBase(o);
    letter('l'); click(o.x + 160, o.y - 90); move(o.x + 200, o.y + 9);
    assert(axisHighlights() === 0, 'setting off: no axis highlight');
    click(o.x + 200, o.y + 9); esc();
    const d = await readDesign();
    assert(!d.constraints.some((c) => isAxisH(c) || isAxisV(c)), 'setting off: no axis constraint; got ' + JSON.stringify(d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+'))));
    settings.set('AXIS_SNAP', true);
    console.log('setting off: ok');
  }
  console.log('axis-snap-node: ok');
} catch (e) { failed = e; } finally {
  if (app) await app.close();
}
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
