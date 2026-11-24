// tests/midpoint-arc-875-node.test.js -- TASK 875: Midpoint of an ARC, as Fusion does it (advisor check in Fusion 2706.1.17, 2026-11-24:
// addByThreePoints((0,0),(2,2),(4,0)), a free point at (5,5), addMidPoint(point, arc) -> the point moved to (2,2), the arc's SWEEP midpoint).
// The constraint is stored { type: 'midpoint', joint, shape } (Fusion's addMidPoint(point, curve)); the line form { joints: [a, b, m] } is untouched.
// The oracle is ANGULAR (arcSweepInfo: start angle + dir * span / 2 at the start radius), independent of the solver's chord-normal row.
//  1. core: the point jumps to the arc's middle and the arc stays (who moves: the point, as Fusion); the rows are the finite differences; the
//     constraint removes 2 DOF; it holds while (a) the arc's end is moved, (b) the radius dimension changes, (c) the sweep passes 180 (and on to
//     340: never the mirror point), for a counter-clockwise, a clockwise and a direction-less (shortest way) arc; a duplicate and an impossible one
//     are refused with the over-constrained notice; the line midpoint is unchanged; save / load keeps it.
//  2. the app (node kit): Midpoint tool, a point then an arc (and an arc then a point) through real clicks makes it; Undo removes it, Redo
//     brings it back; dragging the arc's end with the Select tool keeps the point at the middle; the stored design reloads with it.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager, OVER_CONSTRAINED_TEXT } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { arcSweepInfo } from '#core/geometry.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { newSketchState, arc as arcTool } from '#core/tool-ops.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { const d = Math.hypot(a.x - b.x, a.y - b.y); assert.ok(d < tol, `${m}: off by ${d} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`); checks++; };
const P = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const deg = (a) => (a * Math.PI) / 180;

// the arc's sweep midpoint, ANGULAR: start angle + dir * span / 2 at the start radius (arcSweepInfo reads the stored direction)
function sweepMid(st, arc) {
  const c = P(st, arc.joints[0]), s = P(st, arc.joints[1]), e = P(st, arc.joints[2]);
  const info = arcSweepInfo(c, s, e, { sweep: arc.sweep });
  const t = info.a0 + info.dir * info.span / 2, r = Math.hypot(s.x - c.x, s.y - c.y);
  return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), span: info.span };
}
// move the arc's END so the arc sweeps `sweep` (radians, in its own direction) from its start, the way a drag does (the joint held there, the
// sketch solved), then free it. (Placed from the start's CURRENT angle: the least-change solve may turn the arc, so a fixed world angle would
// not be the sweep asked for.)
function moveEnd(S, arc, sweep) {
  const st = S.state, c = P(st, arc.joints[0]), s = P(st, arc.joints[1]), r = Math.hypot(s.x - c.x, s.y - c.y);
  const dir = arcSweepInfo(c, s, P(st, arc.joints[2]), { sweep: arc.sweep }).dir, a = Math.atan2(s.y - c.y, s.x - c.x) + dir * sweep;
  const e = st.joints.get(arc.joints[2]);
  e.x = c.x + r * Math.cos(a); e.y = c.y + r * Math.sin(a); e.fixed = true;
  const res = S.engine.solve(L.ITER);
  e.fixed = false;
  return res;
}
const makeArcAt = (S, cx, cy, r, a0, a1, sweep) => {
  const c = L.point(S, cx, cy), s = L.point(S, cx + r * Math.cos(deg(a0)), cy + r * Math.sin(deg(a0))), e = L.point(S, cx + r * Math.cos(deg(a1)), cy + r * Math.sin(deg(a1)));
  const id = arcTool(S.state, c, s, e, sweep === undefined ? {} : { sweep });   // the Arc tool's maker, with its stored direction
  return L.shape(S, id);
};
const midOf = (st, m) => st.constraints.find((c) => c.type === CONSTRAINT_TYPES.MIDPOINT && c.joint === m);

// ---------------------------------------------------------------------------------------------------- 1. core
{
  // the Fusion check, scaled x 25: centre (50, 0), start (100, 0), end (0, 0), counter-clockwise (increasing angle) through (50, 50)
  const S = L.newSketch(), st = S.state;
  const arc = makeArcAt(S, 50, 0, 50, 0, 180, true);
  const m = L.point(S, 125, 125);
  S.engine.solve(L.ITER);
  const arcBefore = arc.joints.map((id) => P(st, id));
  const n0 = L.nullity(S);
  const made = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.MIDPOINT, { joint: m, shape: arc.id }, { source: 'toolbar' });
  ok(!!made, 'a point and an arc make a midpoint: ' + JSON.stringify(S.msgs));
  const c = midOf(st, m);
  assert.deepStrictEqual({ type: c.type, joint: c.joint, shape: c.shape, joints: c.joints }, { type: 'midpoint', joint: m, shape: arc.id, joints: undefined }, 'stored as { type, joint, shape }');
  near(P(st, m), { x: 50, y: 50 }, 1e-6, 'the point jumped to the arc sweep midpoint (Fusion: (2, 2) x 25)');
  arc.joints.forEach((id, i) => near(P(st, id), arcBefore[i], 1e-9, `the arc stayed (joint ${i}: the point gave way, as in Fusion)`));
  ok(measureResidual(c, st.joints, st.shapes) < 1e-9, 'the verifier reads it satisfied');
  ok(L.nullity(S) === n0 - 2, `the midpoint removes 2 DOF (${n0} -> ${L.nullity(S)})`);
  const fd = L.fdJacobian(S);
  ok(!fd.worst.some((w) => w.type === 'midpoint'), 'the midpoint rows are the finite-difference rows: ' + JSON.stringify(fd.worst));
  ok(fd.nullity === L.nullity(S), `finite-difference nullity ${fd.nullity} = the solver's ${L.nullity(S)}`);

  // (a) the arc's end moved: the point follows, the sweep crossing 180 (and on to 340): never the mirror point
  const spans = [];
  for (const a of [120, 170, 185, 200, 260, 300, 340, 90]) {
    const res = moveEnd(S, arc, deg(a));
    ok(res.converged, `end moved for a ${a} deg sweep: the solve converges`);
    const want = sweepMid(st, arc);
    spans.push(+(want.span * 180 / Math.PI).toFixed(2));
    near(P(st, m), want, 1e-5, `end moved for a ${a} deg sweep (${spans[spans.length - 1]}): the point is at the sweep midpoint`);
  }
  console.log('sweeps the arc went through (deg): ' + spans.join(' '));
  ok(spans.some((v) => v > 180 && v < 270) && spans.some((v) => v > 300) && spans[spans.length - 1] < 180, 'the sweep crossed 180 both ways and reached past 300: ' + spans.join(' '));
  // the jacobian again at a sweep past 180 (the far side), with the point ON the arc and OFF it (mid-solve)
  moveEnd(S, arc, deg(250));
  ok(!L.fdJacobian(S).worst.some((w) => w.type === 'midpoint'), 'rows = finite differences at a 250 deg sweep');
  { const j = st.joints.get(m); j.x += 7; j.y -= 3; ok(!L.fdJacobian(S).worst.some((w) => w.type === 'midpoint'), 'rows = finite differences off the solution'); j.x -= 7; j.y += 3; }

  // (b) the radius dimension changes: the point stays at the middle (on the new circle)
  ok(!!ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { shape: arc.id, isRadius: true, value: 50 }, { source: 'toolbar' }), 'a radius dimension on the arc');
  const rad = st.constraints.find((k) => k.isRadius && k.shape === arc.id);
  for (const v of [80, 30, 50]) {
    const er = commitDimensionEdit(st, rad, v);
    ok(!er.reverted, `radius ${v} accepted: ${JSON.stringify(er)}`);
    const ctr = P(st, arc.joints[0]);
    ok(Math.abs(Math.hypot(P(st, m).x - ctr.x, P(st, m).y - ctr.y) - v) < 1e-5, `radius ${v}: the point is on the new circle`);
    near(P(st, m), sweepMid(st, arc), 1e-5, `radius ${v}: the point is at the sweep midpoint`);
  }

  // a duplicate (the same point, the same arc) is refused with THE over-constrained notice
  S.msgs.length = 0;
  const nC = st.constraints.length;
  ok(ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.MIDPOINT, { joint: m, shape: arc.id }, { source: 'toolbar' }) === null, 'a duplicate is refused');
  ok(st.constraints.length === nC && S.msgs.includes(OVER_CONSTRAINED_TEXT), 'the duplicate is told "' + OVER_CONSTRAINED_TEXT + '": ' + JSON.stringify(S.msgs));

  // save / load: the stored record, then a load into a new sketch keeps it holding as the arc's end moves
  const doc = JSON.parse(JSON.stringify(serializeDocument(st)));
  const stored = doc.geometry.constraints.find((k) => k.type === 'midpoint');
  assert.deepStrictEqual(stored, { type: 'midpoint', joint: m, shape: arc.id }, 'the saved record');
  checks++;
  const st2 = newSketchState();
  ok(deserializeDocument(doc, st2).ok, 'the document loads');
  const S2 = { engine: st2.engine, state: st2, msgs: [] };
  ok(!!midOf(st2, m), 'the loaded sketch has the arc midpoint');
  const arc2 = st2.shapes.find((s) => s.id === arc.id);
  moveEnd(S2, arc2, deg(210));
  near(P(st2, m), sweepMid(st2, arc2), 1e-5, 'after load: the arc end moved to a 210 deg sweep, the point follows');
}

// a CLOCKWISE arc (sweep false) and a direction-less arc (no stored sweep: the shortest way, as a fillet arc)
for (const [label, sweep, a0, a1, moves] of [['clockwise', false, 0, -90, [150, 200, 300]], ['shortest-way', undefined, 30, 120, [100, 60, 170]]]) {
  const S = L.newSketch(), st = S.state;
  const arc = makeArcAt(S, 0, 0, 40, a0, a1, sweep);
  const m = L.point(S, -60, 70);
  S.engine.solve(L.ITER);
  ok(!!ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.MIDPOINT, { joint: m, shape: arc.id }, { source: 'toolbar' }), `${label}: made`);
  near(P(st, m), sweepMid(st, arc), 1e-6, `${label}: the point is at the sweep midpoint`);
  for (const a of moves) { moveEnd(S, arc, deg(a)); near(P(st, m), sweepMid(st, arc), 1e-5, `${label}: sweep ${a} deg, the point follows`); }
  ok(!L.fdJacobian(S).worst.some((w) => w.type === 'midpoint'), `${label}: rows = finite differences`);
}

// impossible: the arc and the point all held, the point off the middle -> refused with the over-constrained notice, nothing moves
{
  const S = L.newSketch(), st = S.state;
  const arc = makeArcAt(S, 0, 0, 40, 0, 90, true);
  const m = L.point(S, 100, 100);
  for (const id of [...arc.joints, m]) st.joints.get(id).fixed = true;
  S.msgs.length = 0;
  ok(ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.MIDPOINT, { joint: m, shape: arc.id }, { source: 'toolbar' }) === null, 'impossible (all held): refused');
  ok(S.msgs.includes(OVER_CONSTRAINED_TEXT), 'impossible: told "' + OVER_CONSTRAINED_TEXT + '": ' + JSON.stringify(S.msgs));
  near(P(st, m), { x: 100, y: 100 }, 1e-12, 'impossible: the point did not move');
}

// the LINE midpoint is unchanged: stored { joints: [a, b, m] }, the point at the line's middle
{
  const S = L.newSketch(), st = S.state;
  const a = L.point(S, 0, 0), b = L.point(S, 80, 20), m = L.point(S, 10, 60);
  L.line(S, a, b);
  ok(!!ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.MIDPOINT, { joints: [a, b, m] }, { source: 'toolbar' }), 'line midpoint made');
  const c = st.constraints.find((k) => k.type === 'midpoint');
  assert.deepStrictEqual(c.joints, [a, b, m], 'line midpoint stored as joints [a, b, m]'); checks++;
  ok(c.joint === undefined && c.shape === undefined, 'line midpoint has no joint / shape fields');
  near(P(st, m), { x: (P(st, a).x + P(st, b).x) / 2, y: (P(st, a).y + P(st, b).y) / 2 }, 1e-6, 'line midpoint: the point is at the middle');
}

// ---------------------------------------------------------------------------------------------------- 2. the app (node kit, real clicks)
{
  // the drawing: a line whose far end is the point, and an arc (centre (0, 0), radius 60, from 0 to 120 deg, counter-clockwise)
  const S = L.newSketch(), st0 = S.state;
  const arc0 = makeArcAt(S, 0, 0, 60, 0, 120, true);
  const la = L.point(S, 150, 100), lb = L.point(S, 120, 60);
  L.line(S, la, lb);
  const DOC = JSON.parse(JSON.stringify(serializeDocument(st0)));
  const profile = await createProfile();
  SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 875');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(DOC, { app: 'sketchstudio', id }); }
  let app = await open({ host: 'sketchstudio', profile });
  try {
    let st = app.state;
    const arc = st.shapes.find((s) => s.id === arc0.id);
    ok(!!arc && st.joints.has(lb), 'the drawing loaded');
    Object.assign(st.view, { x: 50, y: 50, w: 400 }); st.view.h = st.view.w / (app.svg.getBoundingClientRect().width / app.svg.getBoundingClientRect().height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
    const onArc = (a) => { const c = P(st, arc.joints[0]), s = P(st, arc.joints[1]), r = Math.hypot(s.x - c.x, s.y - c.y); return app.toScreen(c.x + r * Math.cos(deg(a)), c.y + r * Math.sin(deg(a))); };
    const at = (jid) => app.toScreen(P(st, jid).x, P(st, jid).y);
    const before = P(st, lb), arcBefore = arc.joints.map((j) => P(st, j));

    // a point, then the arc
    app.tool('midpoint');
    app.click(at(lb).x, at(lb).y);
    app.click(onArc(25).x, onArc(25).y);
    const c1 = midOf(st, lb);
    ok(!!c1 && c1.shape === arc.id, 'Midpoint, a point then an arc (real clicks) made the arc midpoint: ' + JSON.stringify(st.constraints.filter((k) => k.type === 'midpoint')));
    near(P(st, lb), { x: 60 * Math.cos(deg(60)), y: 60 * Math.sin(deg(60)) }, 1e-6, 'the point jumped to the arc middle (60 deg)');
    arc.joints.forEach((j, i) => near(P(st, j), arcBefore[i], 1e-9, `the arc stayed (joint ${i})`));
    // Undo removes it (and puts the point back), Redo brings both back
    app.esc(); app.undo();
    ok(!midOf(st, lb), 'Undo removed the midpoint');
    near(P(st, lb), before, 1e-9, 'Undo put the point back');
    app.redo();
    ok(!!midOf(st, lb), 'Redo brought the midpoint back');
    near(P(st, lb), { x: 60 * Math.cos(deg(60)), y: 60 * Math.sin(deg(60)) }, 1e-6, 'Redo: the point at the middle again');
    app.undo();
    ok(!midOf(st, lb), 'Undo again: no midpoint');

    // the arc, then a point
    app.tool('midpoint');
    app.click(onArc(25).x, onArc(25).y);
    app.click(at(lb).x, at(lb).y);
    ok(!!midOf(st, lb), 'Midpoint, an arc then a point made it');
    near(P(st, lb), sweepMid(st, arc), 1e-6, 'arc first: the point is at the middle');
    app.esc();

    // the Select tool drags the arc's END: the point follows
    app.tool('select');
    const e0 = at(arc.joints[2]), e1 = onArc(200);
    app.drag(e0, e1, 16);
    const span = sweepMid(st, arc).span * 180 / Math.PI;
    ok(span > 180, `the drag took the sweep past 180 (${span.toFixed(1)} deg)`);
    near(P(st, lb), sweepMid(st, arc), 1e-4, 'after dragging the arc end: the point is at the sweep midpoint');

    // the stored design reloads with it
    const stored = await app.storedDoc();
    const rec = stored.geometry.constraints.find((k) => k.type === 'midpoint');
    assert.deepStrictEqual({ type: rec.type, joint: rec.joint, shape: rec.shape, joints: rec.joints }, { type: 'midpoint', joint: lb, shape: arc.id, joints: undefined }, 'the autosaved record'); checks++;
    await app.close();
    app = await open({ host: 'sketchstudio', profile });
    st = app.state;
    ok(!!midOf(st, lb), 'the reloaded design has the arc midpoint');
    near(P(st, lb), sweepMid(st, st.shapes.find((s) => s.id === arc0.id)), 1e-4, 'reloaded: the point at the middle');
  } finally { await app.close(); }
}

console.log(`midpoint-arc-875-node: ${checks} checks passed`);
