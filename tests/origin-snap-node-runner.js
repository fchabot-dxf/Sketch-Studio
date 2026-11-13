// tests/origin-snap-node-runner.js - TASK 576 (node port of tests/origin-snap-live-runner.js, TASK 554). NOT a test file itself:
// origin-snap-*-node.test.js each set HOST / AXIS / ZOOMS (and AWAY) and import it. Same scenarios, same screen offsets from the origin,
// same asserts, same rows as the browser runner. Every scenario starts from "New design" (the path that lost the origin joint): the origin
// marker is drawn, each tool is moved onto the origin and clicked / released, and the element it made must be attached to the origin
// (the origin joint, or a new joint at exactly (0, 0) with a COINCIDENT constraint to j_origin); the snap shown just before the press must
// be the origin joint.
//   HOST  'sketchstudio' | 'shaper'      AXIS  'on' | 'off' (the AXIS_SNAP setting)
//   ZOOMS wheel steps applied (about the origin) before each level, e.g. '0,4,-8'; rows report the net steps from the default
//   AWAY  '1' = also check axis snap AWAY from the origin
// Through tests/helpers/node-app.js. Differences from the browser run (each declared): "New design" runs the SAME project action the sidebar /
// Projects modal run (createProjectActions' toolbar item new-design, with the unsaved-design question answered "Don't save", as the browser
// run clicked it) instead of clicking the sidebar DOM, which the kit does not mount; the wheel is a WheelEvent on the canvas; the AXIS_SNAP
// setting is set through the settings manager (the declared setting) instead of the localStorage key read at page load; the "press is on the
// canvas" guard is dropped (events are dispatched on the canvas).

import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { createProjectActions } from '#ui/project-actions.js';
import { worldToScreen } from '#ui/coords.js';
import settings from '#core/settings-manager.js';

const HOST = process.env.HOST || 'sketchstudio';
const AXIS = process.env.AXIS || 'on';
const ZOOMS = (process.env.ZOOMS || '0').split(',').map(Number);
const AWAY = process.env.AWAY === '1';

const profile = await createProfile();
if (HOST !== 'shaper') await createNamedDesign(profile, 'sketchstudio'); // TASK 558: only a NAMED design autosaves (this test reads the autosave)
const app = await open({ host: HOST, profile });
let failed = null;
try {
  settings.set('AXIS_SNAP', AXIS === 'on');
  const win = app.window;
  const move = (x, y) => app.move(x, y);
  const press = (x, y) => app.down(x, y);
  const release = (x, y) => app.up(x, y);
  const click = (x, y) => app.click(x, y);
  const esc = () => app.esc();
  const tool = (name) => app.tool(name);
  const toScreen = (wx, wy) => app.toScreen(wx, wy);
  const pxPerUnit = () => +(worldToScreen(app.svg, { x: 1, y: 0 }).x - worldToScreen(app.svg, { x: 0, y: 0 }).x).toFixed(3);
  // the snap the canvas shows right now (the shared input layer's dev summary window.ug.snap.log: type + target of the active snap)
  const snapShown = () => { const s = win.ug.snap.log(); return s.activeSnap ? s.activeSnap.type + ':' + s.activeSnap.targetId : null; };
  // the origin marker: the white joint circle drawn at (0, 0) plus the j_origin handle (svg-renderer.js joint pass)
  const originMarker = () => !!app.svg.querySelector('[data-joint-id="j_origin"]') && [...app.svg.querySelectorAll('circle')].some((c) => +c.getAttribute('cx') === 0 && +c.getAttribute('cy') === 0 && /fill:[^;]*white/.test(c.getAttribute('style') || ''));
  const readDoc = async () => {
    if (HOST === 'shaper') { const s = app.state; return JSON.parse(JSON.stringify({ shapes: s.shapes, constraints: s.constraints, joints: [...s.joints.entries()] })); }
    const d = await app.storedDoc();
    return JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }));
  };
  const jmap = (d) => { const out = {}; for (const e of (Array.isArray(d.joints) ? d.joints : Object.entries(d.joints))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };

  // "New design" (the app menu's / the Projects modal's toolbar action; the unsaved Untitled of the previous scenario is not needed: Don't save)
  const actions = createProjectActions({ store: app.store, getBuffer: () => app.buffer, ask: async () => 'discard' });
  let namedCount = 0;
  const newDesign = async () => {
    await actions.toolbarItems().find((i) => i.id === 'new-design').run();
    app.frames();
    if (HOST !== 'shaper') {
      // TASK 558: a New design is an unsaved Untitled that is never autosaved; SketchStudio is read from its autosave, so name it (Save as)
      await actions.saveAs('Snap ' + (++namedCount));
      return null;
    } // SketchStudio's origin is checked by the marker, which is drawn only for a j_origin in the state
    const d = await readDoc();
    assert.deepStrictEqual(d.shapes, [], 'New design starts empty');
    return d;
  };
  const zoomAboutOrigin = (steps) => {
    if (!steps) return;
    const o = toScreen(0, 0);
    move(o.x, o.y);
    for (let i = 0; i < Math.abs(steps); i++) {
      app.svg.dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: o.x, clientY: o.y, deltaX: 0, deltaY: steps > 0 ? -120 : 120 }));
      app.frames();
    }
  };
  // the approach: moves converging on the origin, then the press ON it; the snap shown just before the press is recorded
  let shown = null;
  const onOrigin = (o, doRelease = true) => {
    for (const [dx, dy] of [[60, 50], [30, 25], [6, 4], [2, 1], [0, 0]]) move(o.x + dx, o.y + dy);
    shown = snapShown();
    press(o.x, o.y);
    if (doRelease) release(o.x, o.y);
  };
  const S = 80; // screen px to the element's other points
  const scenarios = {
    'line start': (o) => { tool('line'); onOrigin(o); click(o.x + 2 * S, o.y - S); esc(); },
    'line end': (o) => { tool('line'); click(o.x + 2 * S, o.y - S); onOrigin(o); esc(); },
    'rect corner': (o) => { tool('rect'); onOrigin(o); click(o.x + 2 * S, o.y - S); esc(); },
    'circle centre': (o) => { tool('circle'); onOrigin(o); click(o.x + S, o.y - S); esc(); },
    'arc centre': (o) => { tool('arc'); onOrigin(o); click(o.x + S, o.y - S); click(o.x - S, o.y - S); esc(); },
    'polygon centre': (o) => { tool('polygon'); onOrigin(o); click(o.x + S, o.y - S); esc(); },
    'select drag': (o) => {
      tool('line'); click(o.x + 2 * S, o.y - S); click(o.x + S, o.y - 2 * S); esc();
      tool('select');
      const a = { x: o.x + S, y: o.y - 2 * S };
      move(a.x, a.y); press(a.x, a.y);
      for (const [x, y] of [[a.x - 20, a.y + 40], [a.x - 40, a.y + 80], [o.x + 30, o.y - 40], [o.x + 8, o.y - 6], [o.x + 2, o.y - 1], [o.x, o.y]]) app.move(x, y, { buttons: 1 });
      shown = snapShown();
      release(o.x, o.y); esc();
    },
  };

  const rows = [];
  const scales = [];
  const baseScale = pxPerUnit(); // the default zoom; a level with net wheel steps must be a different scale
  let netSteps = 0;
  for (const z of ZOOMS) {
    zoomAboutOrigin(z);
    netSteps += z;
    for (const [name, run] of Object.entries(scenarios)) {
      const before = await newDesign();
      const scale = pxPerUnit();
      const marker = originMarker();
      const bj = before ? jmap(before) : { j_origin: marker };
      const o = toScreen(0, 0);
      shown = null;
      run(o);
      const d = await readDoc();
      const J = jmap(d);
      const made = d.shapes;
      const usesOrigin = made.some((s) => (s.joints || []).includes('j_origin'));
      const coincident = d.constraints.filter((c) => c.type === 'coincident' && (c.joints || []).includes('j_origin')).map((c) => c.joints.find((j) => j !== 'j_origin'));
      const coincidentAtOrigin = coincident.filter((j) => J[j] && J[j].x === 0 && J[j].y === 0);
      const row = { zoom: netSteps, pxPerUnit: scale, name, originBefore: !!bj.j_origin, marker, shown, usesOrigin, coincidentAtOrigin: coincidentAtOrigin.length, shapes: made.length, origin: J.j_origin || null };
      rows.push(row);
      console.log('ROW', JSON.stringify(row));
    }
    scales.push(rows[rows.length - 1].pxPerUnit);
  }
  for (const r of rows) {
    const tag = `${HOST} axis ${AXIS} zoom ${r.zoom} (${r.pxPerUnit} px/unit) ${r.name}: `;
    assert(r.originBefore && r.marker, tag + 'the new design has its origin joint and the origin marker is drawn; got ' + JSON.stringify(r));
    assert.deepStrictEqual(r.origin, { x: 0, y: 0, fixed: true, ...(r.origin && r.origin.sketchId ? { sketchId: r.origin.sketchId } : {}) }, tag + 'the origin stays fixed at (0, 0)');
    assert(r.shapes >= 1, tag + 'an element was made');
    assert.strictEqual(r.shown, 'joint:j_origin', tag + 'the snap shown on the origin is the origin joint (not an axis, not the grid)');
    assert(r.usesOrigin || r.coincidentAtOrigin >= 1, tag + 'the element is attached to the origin (uses j_origin, or a joint at exactly (0, 0) coincident with it); got ' + JSON.stringify(r));
  }
  for (const r of rows) if (r.zoom !== 0) assert.notStrictEqual(r.pxPerUnit, baseScale, 'a zoomed level is not the default scale: ' + JSON.stringify({ baseScale, r }));
  for (let i = 1; i < scales.length; i++) assert.notStrictEqual(scales[i], scales[i - 1], 'each zoom level is a different scale: ' + JSON.stringify(scales));

  if (AWAY) {
    // axis snap AWAY from the origin, in a new design: a line end released 9 px off the X axis, far from the origin
    await newDesign();
    const o = toScreen(0, 0);
    tool('line'); click(o.x + 160, o.y - 90); move(o.x + 220, o.y + 30); move(o.x + 200, o.y + 9);
    const awayShown = snapShown();
    click(o.x + 200, o.y + 9); esc();
    const d = await readDoc(); const J = jmap(d);
    const h = d.constraints.filter((c) => c.type === 'pointOnLine' && c.shape === 'ref_axis_x'); // task 539: the axis snap is a point-on-line with the built-in X axis
    const end = d.shapes[0] && d.shapes[0].joints[1];
    console.log('AWAY', JSON.stringify({ axis: AXIS, shown: awayShown, h: h.length, end: J[end] }));
    if (AXIS === 'on') {
      assert.strictEqual(awayShown, 'axis-x:axis-x', 'away from the origin the X axis snap is shown');
      assert(h.length === 1 && h[0].joint === end && J[end].y === 0, 'the line end sits on the X axis with pointOnLine(end, ref_axis_x): ' + JSON.stringify({ h, end: J[end] }));
    } else {
      assert.notStrictEqual(awayShown, 'axis-x:axis-x', 'axis snap off: no X axis snap');
      assert.strictEqual(h.length, 0, 'axis snap off: no point-on-line with the X axis');
    }
  }
  console.log(`origin-snap-node ${HOST} axis ${AXIS} zooms ${ZOOMS.join(',')}: ok (${rows.length} cells)`);
} catch (e) { failed = e; } finally {
  await app.close();
}
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
