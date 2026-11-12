// TASK 550 -- arcs keep their direction and turn smoothly, like Fusion (owner ruling 2026-11-12). One test per part of the design:
//   1. the large-arc choice is DERIVED from the joints and the arc's direction by ONE function (geometry.js arcSweepInfo) for the renderer, the
//      SVG / DXF exports and the bounds; a stored largeArc (old files) is ignored. Fusion stores centre + radius + start angle + sweep: no flag.
//   2. an arc keeps its side through a solve (the solver's orientation lock, engine.js): Fusion's fixed-ends radius sequence.
//   3. an arc whose own ends are made coincident (zero sweep) is refused (findCollapsedShape measures the sweep too): Fusion "failed to solve".
//   4. an arc is picked only on its drawn sweep (snap-detection.js), not on its whole circle.
//   5. an edited angle dimension turns the moving line continuously to exactly the typed value, up to 179 degrees (Fusion's sequence).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { arcByTool, measureArc } from './harness/coverage/arcs-variants.js';
import { calculateArcPath, arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { svgCircularArcCentre } from '#core/import-arcs.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { measureShapeSizes, findCollapsedShape } from '#core/constraint-verifier.js';
import { findSnap } from '#ui/snap-detection.js';
import { svgStub } from './harness/coverage/matrix-run.js';

const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const muted = (f) => { const l = console.log, e = console.error, w = console.warn, d = console.debug; console.log = console.error = console.warn = console.debug = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; console.debug = d; } };
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const lock = (S, ids) => muted(() => { S.state.selectedJoints = new Set(ids); toggleFixedSelection(S.state); S.state.selectedJoints = new Set(); });
// the flags and end points of an SVG arc path "M x y A r r 0 la sw x y"
const parseArc = (d) => { const m = /M\s*(\S+?)[ ,]\s*(\S+)\s+A\s*(\S+?)[ ,]\s*(\S+)\s+0\s+(\d)[ ,]\s*(\d)\s+(\S+?)[ ,]\s*(\S+?)"?$/.exec(d.trim()); return m ? { x1: +m[1], y1: +m[2], r: +m[3], la: +m[5], sw: +m[6], x2: +m[7], y2: +m[8] } : null; };
// the arc a path draws: its implied centre (SVG F.6.5) and the direction of its middle seen from that centre
const drawnCentre = (a) => svgCircularArcCentre(a.x1, a.y1, a.r, !!a.la, !!a.sw, a.x2, a.y2);

// the select tool's body drag, as tests/body-drag-rim.test.js runs it (the app's pointer handlers + the per-frame solve)
function bodyDrag(S, shapeId, from, to) {
  const st = S.state;
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const ev = (p) => ({ clientX: p.x, clientY: p.y, pointerId: 1, target: { closest: () => null, dataset: {} } });
  muted(() => {
    handleSelectionPointerDown(ev(from), SVG, st, null, { shape: L.shape(S, shapeId), pt: { ...from } }, null);
    for (let i = 1; i <= 20; i++) { handleSelectionPointerMove(ev({ x: from.x + (to.x - from.x) * i / 20, y: from.y + (to.y - from.y) * i / 20 }), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500); }
    handleSelectionPointerUp(ev(to), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500);
  });
}

// ------------------------------------------------------------------------------------------------ 1. the large-arc choice is derived
{
  // (a) the arc tool's 140 degree arc, both ends fixed, pulled by its body past a half circle (Fusion task 540: 140 -> 212, drawn as the major arc)
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 30, 140, 20 * Math.PI / 180);
  const [c, s, e] = A.joints;
  lock(S, [s, e]);
  bodyDrag(S, A.shape, { x: 100, y: 130 }, { x: 100, y: 148 });
  const m = measureArc(S, A.shape), sh = L.shape(S, A.shape), C = P(S, c);
  assert.ok(m.spanDeg > 200 && m.spanDeg < 230, `the pulled arc is past a half circle (sweep ${m.signedDeg})`);
  const drawn = parseArc(calculateArcPath(C, P(S, s), P(S, e), 'CENTER', { sweep: sh.sweep }));
  const dc = drawnCentre(drawn);
  assert.strictEqual(drawn.la, 1, `the renderer draws the ${m.spanDeg.toFixed(1)} degree arc as a LARGE arc (path ${calculateArcPath(C, P(S, s), P(S, e), 'CENTER', { sweep: sh.sweep })})`);
  assert.ok(Math.hypot(dc.cx - C.x, dc.cy - C.y) < 1e-6, `the drawn arc is centred on the arc's centre (drawn centre ${dc.cx}, ${dc.cy}; centre ${C.x}, ${C.y})`);
  const exported = parseArc(/<path d="([^"]*)"/.exec(muted(() => buildSVG(S.state, { precision: 6 })))[1]);
  assert.ok(exported && exported.la === drawn.la && exported.sw === drawn.sw, `the SVG export draws the same arc as the renderer (export ${JSON.stringify(exported)}, renderer ${JSON.stringify(drawn)})`);
  const b = computeGeometryBounds(S.state);
  assert.ok(b.maxY > C.y + m.R - 1e-6, `the bounds reach the arc's far side (maxY ${b.maxY}, centre ${C.y} + R ${m.R})`);
  console.log(`1a fixed-ends arc pulled to ${m.signedDeg.toFixed(2)} deg: drawn and exported large=1 sweep=${drawn.sw}, centred on the arc's centre`);
}
{
  // (b) an OLD file whose stored largeArc no longer matches its joints (an arc that crossed 180 degrees before this task, EA-2): the flag is ignored
  const joints = new Map([['c', { x: 0, y: 0 }], ['s', { x: 10, y: 0 }], ['e', { x: 10 * Math.cos(200 * Math.PI / 180), y: 10 * Math.sin(200 * Math.PI / 180) }]]);
  const sh = { id: 'a', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], largeArc: false, sweep: true };
  const drawn = parseArc(calculateArcPath(joints.get('c'), joints.get('s'), joints.get('e'), 'CENTER', { largeArc: sh.largeArc, sweep: sh.sweep }));
  const dc = drawnCentre(drawn);
  assert.ok(drawn.la === 1 && Math.hypot(dc.cx, dc.cy) < 1e-9, `an old file's stale largeArc=false on a 200 degree arc: drawn as the 200 degree arc about its centre (${JSON.stringify(drawn)})`);
  const info = arcSweepInfo(joints.get('c'), joints.get('s'), joints.get('e'), { sweep: true });
  assert.ok(Math.abs(info.span * 180 / Math.PI - 200) < 1e-9 && info.large === true, 'arcSweepInfo: 200 degrees, large');
  console.log('1b old file, stale largeArc=false on a 200 degree arc: drawn as the 200 degree arc');
}
{
  // (c) a FILLET arc stores no direction (the shortest way): the SVG and DXF exports write the arc the renderer draws, not its mirror / complement
  for (const [name, aS, aE] of [['increasing', -90, 0], ['decreasing', 180, 90]]) {
    const rad = (d) => d * Math.PI / 180;
    const joints = new Map([['c', { x: 50, y: 50 }], ['s', { x: 50 + 10 * Math.cos(rad(aS)), y: 50 + 10 * Math.sin(rad(aS)) }], ['e', { x: 50 + 10 * Math.cos(rad(aE)), y: 50 + 10 * Math.sin(rad(aE)) }]]);
    const state = { joints, shapes: [{ id: 'f', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'] }] };
    const drawn = parseArc(calculateArcPath(joints.get('c'), joints.get('s'), joints.get('e'), 'CENTER', {}));
    const svgArc = parseArc(/<path d="([^"]*)"/.exec(muted(() => buildSVG(state, { precision: 6 })))[1]);
    assert.ok(svgArc.sw === drawn.sw && svgArc.la === drawn.la, `fillet arc (${name} the short way): the SVG export's flags ${svgArc.la} ${svgArc.sw} = the renderer's ${drawn.la} ${drawn.sw}`);
    const t = muted(() => buildDXF(state, { precision: 6 })).split('\r\n'), i = t.indexOf('ARC');
    const a50 = +t[t.indexOf('50', i) + 1], a51 = +t[t.indexOf('51', i) + 1];
    const mid = (aS + aE) / 2, ccw = (x) => ((x - a50) % 360 + 360) % 360;
    assert.ok(ccw(mid) < ccw(a51), `fillet arc (${name}): the DXF ARC (counter-clockwise ${a50} -> ${a51}) contains the drawn arc's middle ${mid} (the 90 degree arc, not the 270)`);
  }
  console.log('1c fillet arcs (no stored direction): SVG and DXF exports = what the renderer draws');
}

// ------------------------------------------------------------------------------------------------ 2. an arc keeps its side (Fusion's fixed-ends radius sequence)
{
  // Fusion 2706.1.17 (advisor, API): both ends fixed, centre free, radius dimension 2.0 -> 1.9 -> 2.5 -> 5.0: sweep 140 -> 163.1 -> 97.49 -> 44.16,
  // always bulging the same way, never the complementary arc. Ours x10 (R 20 -> 19 -> 25 -> 50) through the app's dimension edit seam.
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 20, 140, 20 * Math.PI / 180);
  const [, s, e] = A.joints;
  lock(S, [s, e]);
  const dim = muted(() => ConstraintManager.createConstraint(S.state, 'distance', { shape: A.shape, value: 20, isRadius: true }, { source: 'dimension' }));
  assert.ok(dim && !dim.isDriven, 'the radius dimension is driving');
  const out = [];
  for (const [R, want] of [[19, 163.1], [25, 97.49], [50, 44.16]]) {
    const r = muted(() => commitDimensionEdit(S.state, dim, R));
    const m = measureArc(S, A.shape);
    assert.ok(!r.reverted && Math.abs(m.R - R) < 1e-6, `radius ${R} accepted (${JSON.stringify(r)}, R ${m.R})`);
    assert.ok(Math.abs(m.signedDeg - want) < 0.5, `radius ${R}: sweep ${m.signedDeg.toFixed(3)}, Fusion ${want} (same side, same direction)`);
    out.push(`R ${R}: ${m.signedDeg.toFixed(3)}`);
  }
  console.log(`2  fixed-ends radius sequence like Fusion (140 -> 163.1 -> 97.49 -> 44.16): ${out.join(', ')}`);
}

// ------------------------------------------------------------------------------------------------ 3. an arc whose two ends meet is no solution
{
  // the coincident of an arc's own start and end (Fusion: "failed to solve", the arc unchanged) is refused, the document untouched
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 20, 30);
  const [, s, e] = A.joints;
  const before = JSON.stringify([...S.state.joints]), n0 = S.state.constraints.length;
  const r = muted(() => ConstraintManager.createConstraint(S.state, 'coincident', { joints: [s, e] }, { source: 'coincident' }));
  assert.ok(!r && S.state.constraints.length === n0, `the coincident of a 30 degree arc's own ends is refused (got ${JSON.stringify(r)})`);
  assert.strictEqual(JSON.stringify([...S.state.joints]), before, 'the arc is unchanged');
  // what is NOT a collapse: a radius going to a tiny value keeps the sweep (the radius is the user's own value), and a radius growing a lot
  // shrinks the sweep angle with the two ends still apart (the chord kept)
  const at = (R, deg, c = { x: 0, y: 0 }) => new Map([['c', c], ['s', { x: c.x + R, y: c.y }], ['e', { x: c.x + R * Math.cos(deg * Math.PI / 180), y: c.y + R * Math.sin(deg * Math.PI / 180) }]]);
  const st = (joints, constraints = []) => ({ joints, constraints, shapes: [{ id: 'a', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], sweep: true }] });
  const sizes30 = measureShapeSizes(st(at(30, 30)));
  assert.strictEqual(findCollapsedShape(st(at(30, 0.001)), sizes30) && findCollapsedShape(st(at(30, 0.001)), sizes30).id, 'a', 'ends together (30 -> 0.001 degrees, same radius): collapsed');
  assert.strictEqual(findCollapsedShape(st(at(30, 359.999)), sizes30) && findCollapsedShape(st(at(30, 359.999)), sizes30).id, 'a', 'ends together the long way (30 -> 359.999 degrees): collapsed');
  const chord = 2 * 30 * Math.sin(15 * Math.PI / 180), big = 2 * Math.asin(chord / 2 / 5000) * 180 / Math.PI;
  assert.strictEqual(findCollapsedShape(st(at(5000, big)), sizes30), null, `radius 30 -> 5000 with the chord kept (sweep 30 -> ${big.toFixed(3)} degrees): no collapse`);
  assert.strictEqual(findCollapsedShape(st(at(0.1, 30), [{ type: 'distance', shape: 'a', isRadius: true, value: 0.1 }]), sizes30), null, 'a typed tiny radius (driving radius dimension) is the user\'s own value: no collapse');
  console.log('3  the coincident of an arc\'s own ends is refused; a tiny typed radius or a huge radius with its chord kept is no collapse');
}

// ------------------------------------------------------------------------------------------------ 4. an arc is picked only on its drawn sweep
{
  // findSnap is the one pick for hover, click and snap (hover-manager.js, input-manager.js). A 60 degree arc, R 100, at the default zoom (1 world unit = 1 px)
  const S = L.newSketch();
  const A = arcByTool(S, 300, 300, 100, 60);
  const [c, s, e] = A.joints;
  const pick = (ang) => findSnap(S.state.joints, S.state.shapes, svgStub, { x: 300 + 100 * Math.cos(ang * Math.PI / 180), y: 300 + 100 * Math.sin(ang * Math.PI / 180) }, [], false, false, 1);
  const on = pick(30), opposite = pick(210), past = pick(90);
  assert.ok(on && on.type === 'shape' && on.targetId === A.shape, `the mouse on the arc (30 degrees, 52 px from both ends) picks the arc (${on && on.type} ${on && on.targetId})`);
  assert.ok(!opposite || opposite.targetId !== A.shape, `the mouse on the CIRCLE opposite the arc (210 degrees) does not pick the arc (${opposite && opposite.type} ${opposite && opposite.targetId})`);
  assert.ok(!past || past.targetId !== A.shape || (Math.hypot(past.x - P(S, e).x, past.y - P(S, e).y) < 1e-9), `past the end (90 degrees, 52 px from the end) the arc is not hit on its circle (${JSON.stringify(past && { type: past.type, id: past.targetId, x: past.x, y: past.y })})`);
  const near = findSnap(S.state.joints, S.state.shapes, svgStub, { x: 300 + 100 * Math.cos(62 * Math.PI / 180), y: 300 + 100 * Math.sin(62 * Math.PI / 180) }, [], false, false, 1);
  assert.ok(near && near.type === 'joint' && near.targetId === e, `just past the end (62 degrees) the END joint is picked (${near && near.type} ${near && near.targetId})`);
  void c; void s;
  console.log('4  arc picked on its sweep only: 30 deg -> the arc, 210 and 90 deg (on the circle) -> not the arc, 62 deg -> the end joint');
}

// ------------------------------------------------------------------------------------------------ 5. an edited angle turns the line continuously to exactly its value
{
  // Fusion (advisor, real dimension box): a fixed line, a second line from the same corner, angle dimension 30; typed 60 / 120 / 179: the
  // free line at exactly 60 / 120 / 179 (no flip at 90, never the 180 complement); 0 and negative values are refused.
  const build = (deg) => {
    const S = L.newSketch();
    const a = L.point(S, 0, 0), b = L.point(S, 50, 0), c = L.point(S, 0, 0), d = L.point(S, 40 * Math.cos(deg * Math.PI / 180), 40 * Math.sin(deg * Math.PI / 180));
    const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
    muted(() => { ConstraintManager.createConstraint(S.state, 'coincident', { joints: [a, c] }, {}); lock(S, [a, b]); S.engine.solve(500); });
    const dim = muted(() => ConstraintManager.createConstraint(S.state, 'angle', { shapes: [l1, l2], value: deg }, { source: 'dimension' }));
    const dir = () => { const p = P(S, c), q = P(S, d); return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; };
    return { S, dim, dir };
  };
  {
    const { S, dim, dir } = build(30);
    const got = [];
    for (const v of [60, 120, 170, 179]) {
      const r = muted(() => commitDimensionEdit(S.state, dim, v));
      assert.ok(!r.reverted && Math.abs(dir() - v) < 1e-6, `angle 30 -> ... -> ${v}: the free line at exactly ${v} degrees (got ${dir()}, ${JSON.stringify(r)})`);
      got.push(dir().toFixed(4));
    }
    console.log(`5a Fusion's sequence 30 -> 60 -> 120 -> 170 -> 179: the line at ${got.join(', ')}`);
  }
  {
    // two lines on top of each other (an angle placed at 0, the coverage cell dim-angle|SS|0,0#huge20 of task 525): typed 179 -> 179, not the reversed line at 1
    const { S, dim, dir } = build(0);
    assert.ok(dim && !dim.isDriven && dim.value === 0, 'an angle dimension placed at 0 on two lines on top of each other');
    const r = muted(() => commitDimensionEdit(S.state, dim, 179));
    assert.ok(!r.reverted && Math.abs(dir() - 179) < 1e-6, `angle 0 -> 179: the free line at exactly 179 degrees, not the reversed line at -1 (got ${dir()})`);
    console.log(`5b angle placed at 0, typed 179: the line at ${dir().toFixed(4)}`);
  }
  {
    // 0 and negative values: refused with a reason (the box shows "Can't set to ... Reverted."), nothing moves
    const { S, dim, dir } = build(30);
    for (const v of [0, -30]) {
      const r = muted(() => commitDimensionEdit(S.state, dim, v));
      assert.ok(r.reverted && /more than 0/.test(r.reason) && dim.value === 30 && Math.abs(dir() - 30) < 1e-9, `angle typed ${v}: refused with a reason, value and line unchanged (${JSON.stringify(r)}, line ${dir()})`);
    }
    console.log('5c angle typed 0 or -30: refused ("an angle must be more than 0 degrees"), nothing moves');
  }
}

console.log('arc-direction: ok');
