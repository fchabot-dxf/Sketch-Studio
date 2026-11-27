// tests/body-drag-no-snap-1032-node.test.js -- TASK 1032 (node, through tests/helpers/node-app.js, SketchStudio): a drag that starts on a
// curve's BODY (a line by its middle, a circle or arc by its rim), alone or as a selection, takes NO snap during the drag (no snap glyph, no
// pull of the grabbed spot onto what it passes over) and adds NO constraint on release. A drag that starts on a POINT keeps snapping.
// Before (BUG-340): a body drag took the snap at the cursor (selection-tools.js dragToward), so the grabbed spot jumped onto the Y axis /
// a point it passed (the owner's phone: the on-line diamond on the Y axis, the line jumped).
// FUSION, measured by the advisor with the real mouse 2026-11-27 (scratch doc, 101 px/cm):
//  A: one free line dragged by its middle, its end dropped 0.1 cm from another line's end point (8,3): end at (8.0861, 3.0596), no constraint added.
//  C: the grabbed spot itself dropped 0.1 cm from that point: no snap, no constraint.
//  B: two lines box-selected (with their end points), dragged by one line's middle: both move, no snap, no constraint.
// World units here are mm: the point (8,3) cm is T2 = (80, 30); "0.1 cm from it" is the Fusion offset (0.861, 0.596) mm.
// Each body drag passes over the Y axis: at a pointer 1 mm right of it (inside the snap magnet) nothing snaps and nothing is drawn.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { screenToWorld } from '#ui/coords.js';

const OFF = { x: 0.861, y: 0.596 }; // Fusion's drop offset from (8,3) cm, in mm
const T2 = { x: 80, y: 30 };
const DOC = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['t1', { x: 40, y: 30, fixed: false, sketchId: 'sketch-1' }],
      ['t2', { x: T2.x, y: T2.y, fixed: false, sketchId: 'sketch-1' }],
      ['p', { x: -60, y: -60, fixed: false, sketchId: 'sketch-1' }],
      ['q', { x: -30, y: -60, fixed: false, sketchId: 'sketch-1' }],
      ['r', { x: -60, y: -80, fixed: false, sketchId: 'sketch-1' }],
      ['s', { x: -30, y: -80, fixed: false, sketchId: 'sketch-1' }],
      ['cc', { x: -40, y: 40, fixed: false, sketchId: 'sketch-1' }],
      ['ac', { x: -60, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['as', { x: -40, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['ae', { x: -80, y: 0, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'T', type: 'line', joints: ['t1', 't2'], sketchId: 'sketch-1' },
      { id: 'L', type: 'line', joints: ['p', 'q'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['r', 's'], sketchId: 'sketch-1' },
      { id: 'C', type: 'circle', joints: ['cc'], radius: 10, sketchId: 'sketch-1' },
      { id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], sweep: true, sketchId: 'sketch-1' },
    ],
    constraints: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

const quiet = (fn) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const r3 = (p) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`;

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Body drag 1032', DOC);
const app = await open({ host: 'sketchstudio', profile });
let failed = null;
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('FAIL', msg); } };
try {
  const st = app.state, svg = app.svg;
  app.tool('select');
  const rc = svg.getBoundingClientRect();
  Object.assign(st.view, { x: 0, y: -10, w: 260 }); st.view.h = st.view.w / (rc.width / rc.height); // about 6 px per mm
  svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();
  const pos = (id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
  const W = (s) => screenToWorld(svg, s.x, s.y); // the world point of a screen pixel, as the app reads the pointer
  const axisGlyphs = () => svg.querySelectorAll('[data-snap-axis]').length;
  const snapNow = () => st.activeSnap || st.snapTarget || null;

  // A pointer drag from world `from` to world `to`, passing the pointer 1 mm right of the Y axis (snap magnet) on the way; at that pointer the
  // grabbed spot is read back. Returns { press, pressWorld, startWorld, atAxis: { cursor, snap, glyphs }, end }.
  const drag = (from, to, { grabbed } = {}) => quiet(() => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    const midY = (from.y + to.y) / 2, ax = app.toScreen(1, midY); // 1 mm right of the Y axis
    const legs = [[a, ax], [ax, b]];
    app.move(a.x, a.y); app.down(a.x, a.y);
    const startWorld = st.drag && { ...st.drag.startWorld };
    let atAxis = null;
    const snaps = []; // every pointer of the drag at which a snap was held or a snap glyph drawn
    for (const [p0, p1] of legs) {
      for (let i = 1; i <= 12; i++) {
        const x = Math.round(p0.x + (p1.x - p0.x) * i / 12), y = Math.round(p0.y + (p1.y - p0.y) * i / 12);
        app.move(x, y, { buttons: 1 });
        if (snapNow() || axisGlyphs()) snaps.push(`(${x}, ${y}): ${JSON.stringify(snapNow() && { type: snapNow().type, targetId: snapNow().targetId })}, axis glyphs ${axisGlyphs()}`);
        if (p1 === ax && i === 12) atAxis = { cursor: W({ x, y }), grabbed: grabbed ? grabbed() : null };
      }
    }
    app.up(b.x, b.y); app.frames(3);
    return { pressWorld: W(a), startWorld, atAxis, endCursor: W(b), snaps };
  });
  const undoBack = () => { quiet(() => app.undo()); app.frames(2); };

  // ---- A: a free line by its middle, its END dropped Fusion's 0.1 cm from T2 = (80, 30)
  {
    const p0 = pos('p'), q0 = pos('q'), mid0 = { x: (p0.x + q0.x) / 2, y: (p0.y + q0.y) / 2 };
    const n0 = st.constraints.length, h0 = st.history.length;
    const grabbed = () => { const p = pos('p'), q = pos('q'); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
    const d = drag(mid0, add(mid0, sub(add(T2, OFF), q0)), { grabbed });
    check(d.snaps.length === 0, 'A: no snap held or drawn during the drag: ' + d.snaps.length + ' pointer(s), first ' + d.snaps.slice(0, 2).join('; '));
    const shift = sub(d.endCursor, d.startWorld); // the grabbed spot goes to the cursor: the line translates by the cursor's travel from the grabbed spot
    const want = add(q0, shift);
    console.log('A: end', r3(pos('q')), 'want', r3(want), 'cursor', r3(d.endCursor), '| at the Y axis: cursor', r3(d.atAxis.cursor), 'grabbed', r3(d.atAxis.grabbed));
    check(dist(d.atAxis.grabbed, sub(d.atAxis.cursor, sub(d.startWorld, mid0))) < 0.05, `A: at the Y axis the grabbed spot is at the cursor, not pulled onto the axis: ${r3(d.atAxis.grabbed)} vs cursor ${r3(d.atAxis.cursor)}`);
    check(dist(pos('q'), want) < 1e-3, `A: the end is exactly at the cursor offset ${r3(want)} (not snapped onto T2): ${r3(pos('q'))}`);
    check(dist(pos('q'), T2) > 0.5, 'A: the end did not snap onto T2');
    check(st.constraints.length === n0, 'A: no constraint added' + ' (got ' + (st.constraints.length) + ')');
    check(st.history.length === h0 + 1, 'A: one undo step' + ' (got ' + (st.history.length) + ')');
    undoBack();
    check(dist(pos('q'), q0) < 1e-9, 'A: one Undo puts the line back');
  }

  // ---- C: the GRABBED SPOT itself dropped 0.1 cm from T2
  {
    const p0 = pos('p'), q0 = pos('q'), mid0 = { x: (p0.x + q0.x) / 2, y: (p0.y + q0.y) / 2 };
    const n0 = st.constraints.length, h0 = st.history.length;
    const d = drag(mid0, add(T2, OFF));
    check(d.snaps.length === 0, 'C: no snap held or drawn during the drag: ' + d.snaps.length + ' pointer(s), first ' + d.snaps.slice(0, 2).join('; '));
    const want = add(q0, sub(d.endCursor, d.startWorld));
    const mid = { x: (pos('p').x + pos('q').x) / 2, y: (pos('p').y + pos('q').y) / 2 };
    console.log('C: grabbed spot', r3(mid), 'cursor', r3(d.endCursor), 'end', r3(pos('q')), 'want', r3(want));
    check(dist(pos('q'), want) < 1e-3, `C: the end is exactly at the cursor offset ${r3(want)}: ${r3(pos('q'))}`);
    check(dist(mid, T2) > 0.5, `C: the grabbed spot did not snap onto T2: ${r3(mid)}`);
    check(st.constraints.length === n0, 'C: no constraint added' + ' (got ' + (st.constraints.length) + ')');
    check(st.history.length === h0 + 1, 'C: one undo step' + ' (got ' + (st.history.length) + ')');
    undoBack();
  }

  // ---- B: two lines box-selected (with their end points), dragged by one line's middle onto 0.1 cm from T2: a group drag (task 588)
  {
    const P0 = { p: pos('p'), q: pos('q'), r: pos('r'), s: pos('s') };
    quiet(() => app.drag(app.toScreen(-68, -88), app.toScreen(-22, -52), 6)); // a window box around L and L2
    assert.deepStrictEqual([...st.selectedShapes].sort(), ['L', 'L2'], 'B: the box selects both lines');
    const n0 = st.constraints.length, h0 = st.history.length;
    const mid0 = { x: (P0.p.x + P0.q.x) / 2, y: (P0.p.y + P0.q.y) / 2 };
    const d = drag(mid0, add(T2, OFF));
    check(d.snaps.length === 0, 'B: no snap held or drawn during the drag: ' + d.snaps.length + ' pointer(s), first ' + d.snaps.slice(0, 2).join('; '));
    const shift = sub(d.endCursor, d.pressWorld); // a group drag moves by the cursor's displacement
    for (const id of ['p', 'q', 'r', 's']) check(dist(pos(id), add(P0[id], shift)) < 1e-3, `B: ${id} moved by the cursor's travel: ${r3(pos(id))} vs ${r3(add(P0[id], shift))}`);
    console.log('B: q', r3(pos('q')), 's', r3(pos('s')), 'shift', r3(shift));
    check(st.constraints.length === n0, 'B: no constraint added' + ' (got ' + (st.constraints.length) + ')');
    check(st.history.length === h0 + 1, 'B: one undo step' + ' (got ' + (st.history.length) + ')');
    undoBack();
    quiet(() => app.esc()); app.frames();
  }

  // ---- circle by its RIM (a resize, task 538): the rim dropped 0.1 cm from T2 does not snap; the radius is the cursor's distance from the centre
  {
    const c0 = pos('cc'), rim0 = { x: c0.x + 10, y: c0.y };
    const n0 = st.constraints.length, h0 = st.history.length;
    const d = drag(rim0, add(T2, OFF));
    check(d.snaps.length === 0, 'circle: no snap held or drawn during the drag: ' + d.snaps.length + ' pointer(s), first ' + d.snaps.slice(0, 2).join('; '));
    const C = st.shapes.find((s) => s.id === 'C');
    console.log('circle: radius', C.radius.toFixed(4), 'cursor distance', dist(d.endCursor, pos('cc')).toFixed(4), 'to T2', dist(T2, pos('cc')).toFixed(4));
    check(Math.abs(C.radius - dist(d.endCursor, pos('cc'))) < 1e-3, `circle: the rim is at the cursor (radius ${C.radius} vs ${dist(d.endCursor, pos('cc'))}), not snapped onto T2`);
    check(st.constraints.length === n0, 'circle: no constraint added' + ' (got ' + (st.constraints.length) + ')');
    check(st.history.length === h0 + 1, 'circle: one undo step' + ' (got ' + (st.history.length) + ')');
    undoBack();
  }

  // ---- arc by its RIM (body, task 538): the grabbed rim spot dropped 0.1 cm from T2 does not snap; no constraint
  {
    const c0 = pos('ac'), r0 = dist(pos('as'), c0), rim0 = { x: c0.x, y: c0.y + r0 }; // the top of the half circle from (-40,0) to (-80,0)
    // grab the arc where it is drawn: the top or the bottom rim point, whichever press starts the body drag of A (the sweep side is the app's)
    const pressStarts = (pt) => quiet(() => { const s = app.toScreen(pt.x, pt.y); app.move(s.x, s.y); app.down(s.x, s.y); const ok = !!(st.drag && st.drag.id === 'A' && st.drag.body); app.up(s.x, s.y); app.esc(); return ok; });
    const grab = pressStarts(rim0) ? rim0 : (pressStarts({ x: c0.x, y: c0.y - r0 }) ? { x: c0.x, y: c0.y - r0 } : null);
    assert.ok(grab, 'arc: a press on a rim point of the drawn arc starts its body drag');
    app.frames(); await new Promise((res) => setTimeout(res, 600)); // past the double-click window: the next press is a new press
    const n0 = st.constraints.length, h0 = st.history.length;
    const d = drag(grab, add(T2, OFF));
    check(d.snaps.length === 0, 'arc: no snap held or drawn during the drag: ' + d.snaps.length + ' pointer(s), first ' + d.snaps.slice(0, 2).join('; '));
    const r = dist(pos('as'), pos('ac'));
    console.log('arc: radius', r.toFixed(4), 'cursor distance', dist(d.endCursor, pos('ac')).toFixed(4), 'to T2', dist(T2, pos('ac')).toFixed(4), 'centre', r3(pos('ac')));
    check(Math.abs(r - dist(d.endCursor, pos('ac'))) < 1e-3, `arc: the grabbed rim spot is at the cursor (radius ${r} vs cursor distance ${dist(d.endCursor, pos('ac'))}), not snapped onto T2`);
    check(Math.abs(r - dist(T2, pos('ac'))) > 0.5, 'arc: not snapped onto T2');
    check(st.constraints.length === n0, 'arc: no constraint added' + ' (got ' + (st.constraints.length) + ')');
    check(st.history.length === h0 + 1, 'arc: one undo step' + ' (got ' + (st.history.length) + ')');
    undoBack();
  }

  // ---- guard: a POINT drag (the end q) dropped 0.1 cm from T2 still snaps onto it and adds the coincident
  {
    const q0 = pos('q');
    const coin0 = st.constraints.filter((c) => c.type === 'coincident').length;
    quiet(() => app.drag(app.toScreen(q0.x, q0.y), app.toScreen(T2.x + OFF.x, T2.y + OFF.y), 20));
    app.frames(3);
    console.log('point: q', r3(pos('q')), 'coincident', st.constraints.filter((c) => c.type === 'coincident').map((c) => c.joints));
    check(dist(pos('q'), pos('t2')) < 1e-6, `point drag: q snapped onto t2: ${r3(pos('q'))} vs ${r3(pos('t2'))}`);
    check(st.constraints.filter((c) => c.type === 'coincident').length === coin0 + 1, 'point drag: the coincident is added' + ' (got ' + (st.constraints.filter((c) => c.type === 'coincident').length) + ')');
  }

  if (failures.length) throw new Error(failures.length + ' check(s) failed:\n  ' + failures.join('\n  '));
  console.log('body-drag-no-snap-1032-node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
