// TASK 1000B — Independent Solver UI/UX Audit (Auditor B): CORE solver, ConstraintManager,
// dimension-seams, delete-manager, constraint-status, fillet/mirror/offset/pattern, undo/redo, perf.
// Run: node tests/audits/solver-ux-audit-1000b-core.mjs
// AUDIT ONLY: observes and reports verbatim; exits 0.

import * as ops from '#core/tool-ops.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { commitDimensionEdit, commitDimensionEdits, applyParameterChange, toggleDriving, isDimensionDetermined } from '#core/dimension-seams.js';
import { previewDimensionInput } from '#core/parameters.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { deleteConstraints, deleteShapes, deleteJoints, deleteSelection, removeGeometry } from '#core/delete-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { arcSweepInfo, getDist, perpendicularDistance } from '#core/geometry.js';
import { mirrorObjects, mirrorObjectsOf } from '#core/mirror.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { applyPattern, patternObjectsOf, patternDefaults } from '#core/pattern.js';
import { applyFillet, findCornerBetweenLines } from '#core/fillet.js';
import { makeBezier } from '#core/shapes.js';
import { addSketch, setSketchLocked } from '#core/sketch-model.js';

function fresh() {
  const state = ops.newSketchState();
  const notices = [];
  setConstraintNotifier((msg, type) => notices.push({ type: type || 'info', msg: String(msg) }));
  return { state, engine: state.engine, notices };
}

function snapGeom(state) {
  const j = {};
  for (const [id, pt] of state.joints) j[id] = { x: +pt.x.toFixed(6), y: +pt.y.toFixed(6), fixed: !!pt.fixed };
  const r = {};
  for (const s of state.shapes) if (s.type === 'circle') r[s.id] = +s.radius.toFixed(6);
  return { j, r, cCount: state.constraints.length };
}

function maxMove(state, before) {
  let m = 0;
  for (const [id, pt] of state.joints) {
    const b = before.j[id];
    if (b) m = Math.max(m, Math.hypot(pt.x - b.x, pt.y - b.y));
  }
  for (const s of state.shapes) {
    if (s.type === 'circle' && before.r[s.id] != null) m = Math.max(m, Math.abs(s.radius - before.r[s.id]));
  }
  return m;
}

function dragJoint(state, jid, dx, dy, steps = 10) {
  const j = state.joints.get(jid);
  const x0 = j.x, y0 = j.y;
  for (let k = 1; k <= steps; k++) {
    const tx = x0 + (dx * k) / steps, ty = y0 + (dy * k) / steps;
    j.dragTarget = { x: tx, y: ty };
    state.engine.solve(20, { dragTarget: { jointId: jid, x: tx, y: ty, stiffness: 1e4 } });
  }
  delete j.dragTarget;
  return state.engine.solve(500);
}

function section(title) { console.log('\n=== ' + title + ' ==='); }

// ---------------------------------------------------------------------------
// 1. STATUS & LOCK: Circle vs Line vs Arc vs Bezier
// ---------------------------------------------------------------------------
section('1. STATUS & LOCK: Circle vs Line vs Arc vs Bezier');
{
  // 1a. Circle locked by fixing its joints (what toggleFixedSelection / F key does)
  const { state, engine } = fresh();
  const c = ops.circle(state, 50, 50, 20);
  state.joints.get(c.c).fixed = true;
  engine.solve(500);
  const st = analyzeConstraintStatus(state);
  const dofBefore = engine.jointFreedom();
  // Drag rim via bodyDragTarget (same as Select rim drag)
  const rimStart = { x: 70, y: 50 };
  const sCircle = state.shapes.find(s => s.id === c.id);
  const bt = engine.bodyDragTarget({ shape: c.id, kind: 'circle', param: 0 }, { x: 95, y: 50 });
  sCircle.dragTarget = { param: bt.body.param, hold: bt.body.hold, x: bt.x, y: bt.y };
  engine.solve(500, { dragTarget: { ...bt, stiffness: 1e4 } });
  delete sCircle.dragTarget;
  console.log('1a LOCKED CIRCLE:', JSON.stringify({
    centerFixed: state.joints.get(c.c).fixed,
    nullity: dofBefore.nullity,
    radiusFree: dofBefore.radiusFree.has(c.id),
    inFixedShapes: st.fixedShapes.has(c.id),
    radiusBefore: 20,
    radiusAfterRimDrag: +sCircle.radius.toFixed(4),
  }));

  // Compare with locked line
  const { state: sL, engine: eL } = fresh();
  const a = ops.click(sL, 0, 0), b = ops.click(sL, 50, 0);
  sL.shapes.push({ id: 'L1', type: 'line', joints: [a, b] });
  sL.joints.get(a).fixed = true; sL.joints.get(b).fixed = true;
  eL.solve(500);
  const stL = analyzeConstraintStatus(sL);
  console.log('1a-ref LOCKED LINE:', JSON.stringify({
    nullity: eL.jointFreedom().nullity,
    inFixedShapes: stL.fixedShapes.has('L1'),
  }));

  // 1b. Bezier with fixed endpoints: reported fully constrained (black) while control points are free!
  const { state: sB, engine: eB } = fresh();
  const ba = ops.click(sB, 0, 0), bb = ops.click(sB, 60, 0);
  sB.joints.get(ba).fixed = true; sB.joints.get(bb).fixed = true;
  const bz = makeBezier(sB.joints, ba, bb, [20, 30], [40, -30]);
  const bzShape = bz.shapes[0];
  sB.shapes.push(bzShape);
  eB.solve(500);
  const stB = analyzeConstraintStatus(sB);
  console.log('1b FIXED-ENDPOINTS BEZIER:', JSON.stringify({
    nullity: eB.jointFreedom().nullity,
    inFixedShapes: stB.fixedShapes.has(bzShape.id),
    c1: bzShape.c1, c2: bzShape.c2,
    note: 'control points c1/c2 are unconstrained shape data yet fixedShapes marks bezier black/rigid',
  }));
}

// ---------------------------------------------------------------------------
// 2. DIMENSIONS: Toggle Driving / Reference (H/V, line-line, axis, angle, undo)
// ---------------------------------------------------------------------------
section('2. DIMENSIONS: toggleDriving (H/V warp, line-line stale, axis stale, no undo)');
{
  // 2a. Horizontal reference dim between diagonal points -> toggleDriving uses getDist() (Euclidean!)
  const { state, engine } = fresh();
  const a = ops.click(state, 0, 0), b = ops.click(state, 30, 40);
  state.joints.get(a).fixed = true;
  state.shapes.push({ id: 'L1', type: 'line', joints: [a, b] });
  const c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
    joints: [a, b], value: 30, dimMode: 'horizontal', isDriven: true, driven: true,
  });
  const histBefore = state.history.length;
  const beforePos = { x: state.joints.get(b).x, y: state.joints.get(b).y };
  const res = toggleDriving(state, c);
  const afterPos = { x: +state.joints.get(b).x.toFixed(4), y: +state.joints.get(b).y.toFixed(4) };
  console.log('2a H-REF TOGGLE TO DRIVING:', JSON.stringify({
    beforePos, dimMode: c.dimMode, expectedValue: 30, actualStoredValue: +c.value.toFixed(4),
    afterPos, histBefore, histAfter: state.history.length, res,
  }));

  // 2b. Vertical reference dim between diagonal points -> toggleDriving uses getDist()
  const { state: sV } = fresh();
  const va = ops.click(sV, 0, 0), vb = ops.click(sV, 30, 40);
  sV.joints.get(va).fixed = true;
  sV.shapes.push({ id: 'L1', type: 'line', joints: [va, vb] });
  const cV = ConstraintManager.createConstraint(sV, CONSTRAINT_TYPES.DISTANCE, {
    joints: [va, vb], value: 40, dimMode: 'vertical', isDriven: true, driven: true,
  });
  toggleDriving(sV, cV);
  console.log('2b V-REF TOGGLE TO DRIVING:', JSON.stringify({
    expectedValue: 40, actualStoredValue: +cV.value.toFixed(4),
    afterPos: { x: +sV.joints.get(vb).x.toFixed(4), y: +sV.joints.get(vb).y.toFixed(4) },
  }));

  // 2c. Line-to-line reference dim: drag line, then toggleDriving -> stale value snaps geometry back!
  const { state: sLL } = fresh();
  const p1 = ops.click(sLL, 0, 0), p2 = ops.click(sLL, 50, 0);
  const p3 = ops.click(sLL, 0, 20), p4 = ops.click(sLL, 50, 20);
  sLL.joints.get(p1).fixed = true; sLL.joints.get(p2).fixed = true;
  sLL.shapes.push({ id: 'L1', type: 'line', joints: [p1, p2] });
  sLL.shapes.push({ id: 'L2', type: 'line', joints: [p3, p4] });
  ConstraintManager.createConstraint(sLL, CONSTRAINT_TYPES.HORIZONTAL, { joints: [p3, p4] });
  const cLL = ConstraintManager.createConstraint(sLL, CONSTRAINT_TYPES.DISTANCE, {
    shapes: ['L1', 'L2'], value: 20,
  });
  toggleDriving(sLL, cLL); // now reference
  // Move L2 to y = 55
  sLL.joints.get(p3).y = 55; sLL.joints.get(p4).y = 55;
  sLL.engine.solve(500);
  const yBeforeToggle = sLL.joints.get(p3).y;
  toggleDriving(sLL, cLL); // promote back to driving
  console.log('2c LINE-LINE REF TOGGLE TO DRIVING:', JSON.stringify({
    yBeforeToggle, storedValueAfterToggle: +cLL.value.toFixed(4),
    yAfterToggle: +sLL.joints.get(p3).y.toFixed(4),
  }));

  // 2d. Point-to-axis reference dim: move point, toggleDriving -> state.joints.get('j_ref_x') is undefined!
  const { state: sAx } = fresh();
  const ap = ops.click(sAx, 30, 25);
  const cAx = ConstraintManager.createConstraint(sAx, CONSTRAINT_TYPES.DISTANCE, {
    joints: [ap, 'j_origin', 'j_ref_x'], value: 25,
  });
  toggleDriving(sAx, cAx); // now reference
  sAx.joints.get(ap).y = 60;
  sAx.engine.solve(500);
  toggleDriving(sAx, cAx); // promote back to driving
  console.log('2d POINT-TO-AXIS REF TOGGLE TO DRIVING:', JSON.stringify({
    yBeforeToggle: 60, storedValueAfterToggle: +cAx.value.toFixed(4),
    yAfterToggle: +sAx.joints.get(ap).y.toFixed(4),
  }));
}

// ---------------------------------------------------------------------------
// 3. DIMENSIONS: Redundant ANGLE vs Redundant DISTANCE
// ---------------------------------------------------------------------------
section('3. DIMENSIONS: Redundant ANGLE vs Redundant DISTANCE');
{
  const { state, notices } = fresh();
  const a = ops.click(state, 0, 0), b = ops.click(state, 50, 0);
  const c = ops.click(state, 0, 0), d = ops.click(state, 0, 50);
  state.joints.get(a).fixed = true;
  state.shapes.push({ id: 'L1', type: 'line', joints: [a, b] });
  state.shapes.push({ id: 'L2', type: 'line', joints: [c, d] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [a, c] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [a, b] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: [c, d] });
  notices.length = 0;
  const ang = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 90 });
  const isDet = ang ? isDimensionDetermined(state, ang) : null;
  console.log('3a REDUNDANT ANGLE ON H+V LINES:', JSON.stringify({
    created: !!ang, isDriven: ang && ang.isDriven, drivenReason: ang && ang.drivenReason,
    isDimensionDetermined: isDet, notices,
  }));

  // Compare with redundant DISTANCE on fixed-distance line
  const { state: s2, notices: n2 } = fresh();
  const da = ops.click(s2, 0, 0), db = ops.click(s2, 50, 0);
  s2.joints.get(da).fixed = true; s2.joints.get(db).fixed = true;
  s2.shapes.push({ id: 'L1', type: 'line', joints: [da, db] });
  n2.length = 0;
  const dist = ConstraintManager.createConstraint(s2, CONSTRAINT_TYPES.DISTANCE, { joints: [da, db], value: 50 });
  console.log('3b REDUNDANT DISTANCE ON FIXED LINE:', JSON.stringify({
    created: !!dist, isDriven: dist && dist.isDriven, drivenReason: dist && dist.drivenReason, notices: n2,
  }));
}

// ---------------------------------------------------------------------------
// 4. DIMENSIONS: Unsolvable values (negative, zero, too large, self-ref, cycle) + undo
// ---------------------------------------------------------------------------
section('4. DIMENSIONS: Unsolvable values & expressions + undo integrity');
{
  const { state } = fresh();
  const a = ops.click(state, 0, 0), b = ops.click(state, 50, 0), c = ops.click(state, 25, 30);
  state.joints.get(a).fixed = true;
  state.shapes.push({ id: 'L1', type: 'line', joints: [a, b] });
  state.shapes.push({ id: 'L2', type: 'line', joints: [b, c] });
  state.shapes.push({ id: 'L3', type: 'line', joints: [c, a] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [a, b] });
  const d1 = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [a, b], value: 50 });
  const d2 = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [b, c], value: 40 });
  const d3 = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [c, a], value: 40 });
  state.saveState('baseline');

  const cases = [
    ['negative -10', '-10'],
    ['zero 0', '0'],
    ['too large 200 (breaks triangle ineq 40+40<200)', '200'],
    ['self-reference d1 + 5', `${d1.name} + 5`],
    ['unknown name foo', 'foo'],
  ];
  for (const [label, text] of cases) {
    const before = snapGeom(state);
    const hBefore = state.history.length;
    const pv = previewDimensionInput(state, d1, text, { unit: 'mm' });
    let ap = null;
    if (pv.ok) ap = applyParameterChange(state, pv.plan, 'test');
    const move = maxMove(state, before);
    console.log(`4 ${label}:`, JSON.stringify({
      pvOk: pv.ok, pvHint: pv.hint, apOk: ap ? ap.ok : null, apReason: ap && (ap.reason || ap.clash),
      d1Value: d1.value, d1Expr: d1.expression, maxMove: +move.toFixed(6),
      histDelta: state.history.length - hBefore,
    }));
  }

  // Mutual cycle: set d2 = d1 + 1, then try d1 = d2 + 1
  const pv2 = previewDimensionInput(state, d2, `${d1.name} + 1`, { unit: 'mm' });
  applyParameterChange(state, pv2.plan, 'set d2');
  const pvCycle = previewDimensionInput(state, d1, `${d2.name} + 1`, { unit: 'mm' });
  console.log('4 mutual cycle d1 = d2 + 1:', JSON.stringify({ pvOk: pvCycle.ok, pvCode: pvCycle.code, pvHint: pvCycle.hint }));

  // Angle across 180 (30 -> 170 -> 190 -> 270 -> 350 -> 360 -> 370 -> 0 -> -10)
  const { state: sA } = fresh();
  const aa = ops.click(sA, 0, 0), ab = ops.click(sA, 50, 0);
  const ac = ops.click(sA, 0, 0), ad = ops.click(sA, 40, 23);
  sA.joints.get(aa).fixed = true;
  sA.shapes.push({ id: 'L1', type: 'line', joints: [aa, ab] });
  sA.shapes.push({ id: 'L2', type: 'line', joints: [ac, ad] });
  ConstraintManager.createConstraint(sA, CONSTRAINT_TYPES.COINCIDENT, { joints: [aa, ac] });
  ConstraintManager.createConstraint(sA, CONSTRAINT_TYPES.HORIZONTAL, { joints: [aa, ab] });
  ConstraintManager.createConstraint(sA, CONSTRAINT_TYPES.DISTANCE, { joints: [aa, ab], value: 50 });
  ConstraintManager.createConstraint(sA, CONSTRAINT_TYPES.DISTANCE, { joints: [ac, ad], value: 50 });
  const cAng = ConstraintManager.createConstraint(sA, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 30 });
  const angResults = [];
  for (const v of [170, 190, 270, 350, 360, 370, 0, -10]) {
    const r = commitDimensionEdit(sA, cAng, v);
    const pt = sA.joints.get(ad);
    angResults.push({ v, reverted: r.reverted, reason: r.reason || r.clash || null, end: [+pt.x.toFixed(2), +pt.y.toFixed(2)] });
  }
  console.log('4b ANGLE ACROSS 180:', JSON.stringify(angResults));
}

// ---------------------------------------------------------------------------
// 5. CONSTRAINT ADD/DELETE: Duplicate H/V silence, Delete bypass on locked sketch,
//    Delete referenced geometry (mirror line, offset piece, fillet arc)
// ---------------------------------------------------------------------------
section('5. CONSTRAINT ADD/DELETE & REFERENCED GEOMETRY');
{
  // 5a. Duplicate H/V: addHorizontalOrVertical (source:'auto-detect') vs toolbar (source:'toolbar')
  const { state, notices } = fresh();
  const a = ops.click(state, 0, 0), b = ops.click(state, 50, 0);
  state.shapes.push({ id: 'L1', type: 'line', joints: [a, b] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [a, b] }, { source: 'toolbar' });
  notices.length = 0;
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [a, b] }, { source: 'toolbar' });
  const toolbarNotices = notices.slice();
  notices.length = 0;
  ConstraintManager.addHorizontalOrVertical(state, [a, b]);
  const autoDetectNotices = notices.slice();
  console.log('5a DUPLICATE H/V NOTICE ASYMMETRY:', JSON.stringify({ toolbarNotices, autoDetectNotices }));

  // 5b. deleteSelection locked-sketch constraint bypass! (delete-manager.js:178 vs 183-187)
  const { state: sLock } = fresh();
  const la = ops.click(sLock, 0, 0), lb = ops.click(sLock, 50, 0);
  sLock.shapes.push({ id: 'L1', type: 'line', joints: [la, lb] });
  const hc = ConstraintManager.createConstraint(sLock, CONSTRAINT_TYPES.HORIZONTAL, { joints: [la, lb] });
  addSketch(sLock, 'Sketch 2');
  setSketchLocked(sLock, 'sketch-1', true);
  sLock.selectedConstraints.add(hc);
  const countBefore = sLock.constraints.length;
  deleteSelection(sLock);
  console.log('5b DELETE LOCKED-SKETCH CONSTRAINT BYPASS:', JSON.stringify({
    sketch1Locked: sLock.sketches[0].locked,
    constraintsBefore: countBefore,
    constraintsAfterDeleteSelection: sLock.constraints.length,
  }));

  // 5c. Deleting ONE piece of an OFFSET (source or copy): does offset constraint survive broken or clean up?
  const { state: sOff } = fresh();
  const r = ops.rect(sOff, 0, 0, 60, 40);
  const ch = offsetChainOf(sOff, r.top);
  const off = applyOffset(sOff, ch.chain, 5, 1);
  const offCBefore = sOff.constraints.filter(c => c.type === 'offset').length;
  deleteShapes(sOff, [r.top]);
  const offCAfterSourceDel = sOff.constraints.filter(c => c.type === 'offset').length;
  const offShapesAfter = sOff.shapes.filter(s => off.shapes.includes(s.id)).length;
  const solveAfter = sOff.engine.solve(500);
  console.log('5c DELETE ONE SOURCE LINE OF OFFSET:', JSON.stringify({
    offCBefore, offCAfterSourceDel, copyShapesRemaining: offShapesAfter, converged: solveAfter.converged,
  }));

  // 5d. Deleting the MIRROR LINE: do symmetric constraints vanish cleanly?
  const { state: sMir } = fresh();
  const ma = ops.click(sMir, 0, -50), mb = ops.click(sMir, 0, 50);
  sMir.shapes.push({ id: 'mirrorLine', type: 'line', joints: [ma, mb], isConstruction: true });
  const sr = ops.rect(sMir, 20, 0, 50, 30);
  mirrorObjects(sMir, mirrorObjectsOf(sr.lines, []), 'mirrorLine');
  const symBefore = sMir.constraints.filter(c => c.type === 'symmetric').length;
  deleteShapes(sMir, ['mirrorLine']);
  const symAfter = sMir.constraints.filter(c => c.type === 'symmetric').length;
  console.log('5d DELETE MIRROR LINE:', JSON.stringify({ symBefore, symAfter }));

  // 5e. Deleting a constraint causing geometry movement?
  const { state: sDel } = fresh();
  const da = ops.click(sDel, 0, 0), db = ops.click(sDel, 50, 0);
  sDel.joints.get(da).fixed = true;
  sDel.shapes.push({ id: 'L1', type: 'line', joints: [da, db] });
  const cH = ConstraintManager.createConstraint(sDel, CONSTRAINT_TYPES.HORIZONTAL, { joints: [da, db] });
  const cD = ConstraintManager.createConstraint(sDel, CONSTRAINT_TYPES.DISTANCE, { joints: [da, db], value: 50 });
  const before = snapGeom(sDel);
  deleteConstraints(sDel, [cH]);
  console.log('5e DELETE CONSTRAINT MOVEMENT:', JSON.stringify({ maxMove: +maxMove(sDel, before).toFixed(8) }));
}

// ---------------------------------------------------------------------------
// 6. DRAG: Singular configs, flips (arc/mirror/tangent/fillet), fillet/mirror/pattern/offset under drag
// ---------------------------------------------------------------------------
section('6. DRAG: Flips, singular configs, fillet/mirror/pattern/offset under drag');
{
  // 6a. Mirror of a BEZIER: dragging the original bezier moves mirror endpoints, leaves mirror control points stranded!
  const { state } = fresh();
  const ba = ops.click(state, 20, 10), bb = ops.click(state, 50, 40);
  const bz = makeBezier(state.joints, ba, bb, [30, 50], [40, 0]);
  const bzShape = bz.shapes[0];
  state.shapes.push(bzShape);
  const mRes = mirrorObjects(state, mirrorObjectsOf([bzShape.id], []), 'ref_axis_y');
  const mBz = state.shapes.find(s => s.id === mRes.shapes[0]);
  const mC1Before = [...mBz.c1], mEndBefore = { ...state.joints.get(mBz.joints[0]) };
  dragJoint(state, ba, 40, 50, 10);
  const mEndAfter = { ...state.joints.get(mBz.joints[0]) };
  console.log('6a MIRROR BEZIER UNDER DRAG:', JSON.stringify({
    srcEndAfter: { x: +state.joints.get(ba).x.toFixed(2), y: +state.joints.get(ba).y.toFixed(2) },
    mirrorEndBefore: { x: +mEndBefore.x.toFixed(2), y: +mEndBefore.y.toFixed(2) },
    mirrorEndAfter: { x: +mEndAfter.x.toFixed(2), y: +mEndAfter.y.toFixed(2) },
    mirrorC1Before: mC1Before.map(v => +v.toFixed(2)),
    mirrorC1After: mBz.c1.map(v => +v.toFixed(2)),
  }));

  // 6b. Mirror of a FILLET ARC (no stored .sweep!): drag mirrored or source across mirror line / bend past 180
  const { state: sMF } = fresh();
  const r = ops.rect(sMF, 20, 10, 80, 60);
  const fil = ops.fillet(sMF, r.top, r.right, 10);
  const fArc = sMF.shapes.find(s => s.id === fil.arc);
  const mFil = mirrorObjects(sMF, mirrorObjectsOf([fArc.id], []), 'ref_axis_y');
  const mArc = sMF.shapes.find(s => s.id === mFil.shapes[0]);
  console.log('6b MIRROR FILLET ARC SWEEP:', JSON.stringify({
    srcSweep: fArc.sweep, mirrorSweep: mArc.sweep,
    srcSpanDeg: +(arcSweepInfo(sMF.joints.get(fArc.joints[0]), sMF.joints.get(fArc.joints[1]), sMF.joints.get(fArc.joints[2]), { sweep: fArc.sweep }).span * 180 / Math.PI).toFixed(2),
    mirrorSpanDeg: +(arcSweepInfo(sMF.joints.get(mArc.joints[0]), sMF.joints.get(mArc.joints[1]), sMF.joints.get(mArc.joints[2]), { sweep: mArc.sweep }).span * 180 / Math.PI).toFixed(2),
  }));

  // 6c. Dragging a line mirrored across a FREE mirror line: does dragging source across mirror line flip or push mirror line?
  const { state: sML } = fresh();
  const ma = ops.click(sML, 0, -50), mb = ops.click(sML, 0, 50);
  sML.shapes.push({ id: 'ML', type: 'line', joints: [ma, mb], isConstruction: true });
  const la = ops.click(sML, 20, 0), lb = ops.click(sML, 20, 30);
  sML.shapes.push({ id: 'L1', type: 'line', joints: [la, lb] });
  const mr = mirrorObjects(sML, mirrorObjectsOf(['L1'], []), 'ML');
  const mL = sML.shapes.find(s => s.id === mr.shapes[0]);
  dragJoint(sML, la, -60, 0, 12); // drag across mirror line to x = -40
  console.log('6c DRAG MIRRORED LINE ACROSS FREE MIRROR LINE:', JSON.stringify({
    srcA: [+sML.joints.get(la).x.toFixed(2), +sML.joints.get(la).y.toFixed(2)],
    copyA: [+sML.joints.get(mL.joints[0]).x.toFixed(2), +sML.joints.get(mL.joints[0]).y.toFixed(2)],
    mirrorLineA: [+sML.joints.get(ma).x.toFixed(2), +sML.joints.get(ma).y.toFixed(2)],
    mirrorLineB: [+sML.joints.get(mb).x.toFixed(2), +sML.joints.get(mb).y.toFixed(2)],
  }));

  // 6d. Free-radius fillet under drag (known 846/847 family: fillet inversion!)
  const { state: sFI } = fresh();
  const r2 = ops.rect(sFI, 0, 0, 60, 40);
  const f2 = ops.fillet(sFI, r2.top, r2.right, 10);
  // Delete fillet radius dimension (leaving tangent + equal)
  const rDim = sFI.constraints.find(c => c.isRadius && c.shape === f2.arc);
  deleteConstraints(sFI, [rDim]);
  // Drag right edge left past top edge
  const rightTop = sFI.shapes.find(s => s.id === r2.right).joints[0];
  const fArc2 = sFI.shapes.find(s => s.id === f2.arc);
  dragJoint(sFI, rightTop, -45, 0, 15);
  const fc = sFI.joints.get(fArc2.joints[0]), fs = sFI.joints.get(fArc2.joints[1]), fe = sFI.joints.get(fArc2.joints[2]);
  const rAfter = getDist(fc, fs);
  const vSharp = sFI.joints.get(fArc2.filletSharp);
  console.log('6d FREE-R FILLET UNDER DRAG:', JSON.stringify({
    filletCenter: [+fc.x.toFixed(2), +fc.y.toFixed(2)],
    filletStart: [+fs.x.toFixed(2), +fs.y.toFixed(2)],
    filletEnd: [+fe.x.toFixed(2), +fe.y.toFixed(2)],
    virtualSharp: vSharp ? [+vSharp.x.toFixed(2), +vSharp.y.toFixed(2)] : null,
    radiusAfter: +rAfter.toFixed(3),
    centerOutsideRight: fc.x > fs.x && fc.x > fe.x,
  }));

  // 6e. Tangent line + circle under drag: does circle flip sides across tangent line?
  const { state: sT } = fresh();
  const ta = ops.click(sT, 0, 0), tb = ops.click(sT, 100, 0);
  sT.joints.get(ta).fixed = true; sT.joints.get(tb).fixed = true;
  sT.shapes.push({ id: 'TL', type: 'line', joints: [ta, tb] });
  const tc = ops.circle(sT, 50, 20, 20);
  ConstraintManager.createConstraint(sT, CONSTRAINT_TYPES.DISTANCE, { shape: tc.id, value: 20, isRadius: true });
  ConstraintManager.createConstraint(sT, CONSTRAINT_TYPES.TANGENT, { line: 'TL', circle: tc.id });
  const yBefore = sT.joints.get(tc.c).y;
  dragJoint(sT, tc.c, 0, -50, 15); // pull straight across line to y = -30
  console.log('6e TANGENT CIRCLE DRAGGED ACROSS LINE:', JSON.stringify({
    yBefore: +yBefore.toFixed(2), yAfter: +sT.joints.get(tc.c).y.toFixed(2),
    flippedSide: (yBefore > 0) !== (sT.joints.get(tc.c).y > 0),
  }));

  // 6f. Arc sweep near 0 / 180 / 360 under drag (dragging end across start)
  const { state: sArc } = fresh();
  const ac = ops.click(sArc, 0, 0), as1 = ops.click(sArc, 30, 0), ae1 = ops.click(sArc, 29.5, 5.2); // ~10 deg
  sArc.joints.get(ac).fixed = true; sArc.joints.get(as1).fixed = true;
  const arcId = ops.arc(sArc, ac, as1, ae1);
  const arcShape = sArc.shapes.find(s => s.id === arcId);
  arcShape.sweep = true; // CCW (+1)
  const spanBefore = arcSweepInfo(sArc.joints.get(ac), sArc.joints.get(as1), sArc.joints.get(ae1), { sweep: arcShape.sweep }).span * 180 / Math.PI;
  dragJoint(sArc, ae1, 0, -10.4, 10); // drag end past start to (29.5, -5.2)
  const spanAfter = arcSweepInfo(sArc.joints.get(ac), sArc.joints.get(as1), sArc.joints.get(ae1), { sweep: arcShape.sweep }).span * 180 / Math.PI;
  console.log('6f ARC END DRAGGED PAST START (10 deg -> ?):', JSON.stringify({
    spanBeforeDeg: +spanBefore.toFixed(2), spanAfterDeg: +spanAfter.toFixed(2),
    wrappedToNear360: spanAfter > 330,
  }));

  // 6g. Dragging a line end to ZERO length (collinear / singular collapse)
  const { state: sZ } = fresh();
  const za = ops.click(sZ, 0, 0), zb = ops.click(sZ, 40, 0);
  sZ.joints.get(za).fixed = true;
  sZ.shapes.push({ id: 'ZL', type: 'line', joints: [za, zb] });
  ConstraintManager.createConstraint(sZ, CONSTRAINT_TYPES.HORIZONTAL, { joints: [za, zb] });
  dragJoint(sZ, zb, -40, 0, 10);
  const zLen = getDist(sZ.joints.get(za), sZ.joints.get(zb));
  // Now try to add a length dimension to the zero-length line or drag it back out!
  const dimZ = ConstraintManager.createConstraint(sZ, CONSTRAINT_TYPES.DISTANCE, { joints: [za, zb], value: 25 });
  console.log('6g DRAG TO ZERO LENGTH:', JSON.stringify({
    lenAfterZeroDrag: +zLen.toFixed(6),
    recoverWithDim25: !!dimZ,
    lenAfterRecover: +getDist(sZ.joints.get(za), sZ.joints.get(zb)).toFixed(4),
  }));

  // 6h. Rectangular pattern under later drag of source AND copy
  const { state: sPat } = fresh();
  const pr = ops.rect(sPat, 0, 0, 20, 10);
  const pat = applyPattern(sPat, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, patternObjectsOf(pr.lines, []), {
    ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [60, 30],
  });
  if (!pat.ok) { console.log('6h PATTERN REFUSED:', pat); } else {
  const copy0Id = pat.constraint.instances[0].shapes[0];
  const copy0 = sPat.shapes.find(s => s.id === copy0Id);
  const srcBefore = { ...sPat.joints.get(pr.c1) };
  const copyBefore = { ...sPat.joints.get(copy0.joints[0]) };
  dragJoint(sPat, pr.c1, 10, 5, 8);
  const srcAfter = { ...sPat.joints.get(pr.c1) };
  const copyAfter = { ...sPat.joints.get(copy0.joints[0]) };
  console.log('6h RECT PATTERN UNDER SOURCE DRAG:', JSON.stringify({
    ok: pat.ok,
    srcDelta: [+(srcAfter.x - srcBefore.x).toFixed(2), +(srcAfter.y - srcBefore.y).toFixed(2)],
    copyDelta: [+(copyAfter.x - copyBefore.x).toFixed(2), +(copyAfter.y - copyBefore.y).toFixed(2)],
  }));
  }

  // 6i. Offset under later drag of source AND copy
  const { state: sOD } = fresh();
  const or = ops.rect(sOD, 0, 0, 60, 40);
  sOD.joints.get(or.c1).fixed = true;
  const och = offsetChainOf(sOD, or.top);
  const oRes = applyOffset(sOD, och.chain, 5, 1);
  const offShape0 = sOD.shapes.find(s => s.id === oRes.shapes[0]);
  const copyJ0 = offShape0.joints[0];
  const copyBeforeO = { ...sOD.joints.get(copyJ0) };
  dragJoint(sOD, or.c3, 20, 10, 10);
  const copyAfterSrcDrag = { ...sOD.joints.get(copyJ0) };
  // Now drag source corner inward past 2*d (40 -> 4, where offset=5 cannot fit!)
  dragJoint(sOD, or.c3, -76, -46, 15);
  const srcAfterCollapseDrag = { ...sOD.joints.get(or.c3) };
  const copyJ0AfterCollapse = { ...sOD.joints.get(offShape0.joints[0]) };
  const copyJ1AfterCollapse = { ...sOD.joints.get(offShape0.joints[1]) };
  console.log('6i OFFSET UNDER DRAG:', JSON.stringify({
    copyBeforeO: [+copyBeforeO.x.toFixed(2), +copyBeforeO.y.toFixed(2)],
    copyAfterSrcDrag: [+copyAfterSrcDrag.x.toFixed(2), +copyAfterSrcDrag.y.toFixed(2)],
    srcAfterCollapseDrag: [+srcAfterCollapseDrag.x.toFixed(2), +srcAfterCollapseDrag.y.toFixed(2)],
    copyTopLineAfterCollapse: [[+copyJ0AfterCollapse.x.toFixed(2), +copyJ0AfterCollapse.y.toFixed(2)], [+copyJ1AfterCollapse.x.toFixed(2), +copyJ1AfterCollapse.y.toFixed(2)]],
    offsetInverted: copyJ1AfterCollapse.x < copyJ0AfterCollapse.x,
  }));

  // 6l. Dragging a fully-constrained rect corner (does it stay put or creep?)
  const { state: sFC } = fresh();
  const fr = ops.rect(sFC, 0, 0, 50, 30);
  sFC.joints.get(fr.c1).fixed = true;
  ConstraintManager.createConstraint(sFC, CONSTRAINT_TYPES.DISTANCE, { joints: sFC.shapes.find(s => s.id === fr.top).joints, value: 50 });
  ConstraintManager.createConstraint(sFC, CONSTRAINT_TYPES.DISTANCE, { joints: sFC.shapes.find(s => s.id === fr.right).joints, value: 30 });
  const fcBefore = snapGeom(sFC);
  dragJoint(sFC, fr.c3, 30, 30, 10);
  console.log('6l DRAG FULLY-CONSTRAINED RECT CORNER:', JSON.stringify({
    nullity: sFC.engine.jointFreedom().nullity,
    maxMoveAfterDrag: +maxMove(sFC, fcBefore).toFixed(6),
  }));

  // 6j. Fillet arc midpoint near 180 deg (known open NEW-11): drag angle past 180
  const { state: sFM } = fresh();
  const f1 = ops.click(sFM, 0, 0), f2j = ops.click(sFM, 50, 0), f3 = ops.click(sFM, 50, 0), f4 = ops.click(sFM, 50, 50);
  sFM.shapes.push({ id: 'FL1', type: 'line', joints: [f1, f2j] });
  sFM.shapes.push({ id: 'FL2', type: 'line', joints: [f3, f4] });
  ConstraintManager.createConstraint(sFM, CONSTRAINT_TYPES.COINCIDENT, { joints: [f2j, f3] });
  const fil2 = ops.fillet(sFM, 'FL1', 'FL2', 10);
  const mp = ops.click(sFM, 40, 10);
  ConstraintManager.createConstraint(sFM, CONSTRAINT_TYPES.MIDPOINT, { joint: mp, shape: fil2.arc });
  const fa = sFM.shapes.find(s => s.id === fil2.arc);
  const mpBefore = { ...sFM.joints.get(mp) };
  // Bend FL2 so corner becomes acute (~10 deg -> fillet arc sweep ~170 -> 185 deg)
  dragJoint(sFM, f4, -45, -45, 15);
  const mpAfter = { ...sFM.joints.get(mp) };
  const faInfo = arcSweepInfo(sFM.joints.get(fa.joints[0]), sFM.joints.get(fa.joints[1]), sFM.joints.get(fa.joints[2]), { sweep: fa.sweep });
  console.log('6j FILLET ARC MIDPOINT NEAR 180:', JSON.stringify({
    filletSweepProp: fa.sweep,
    spanDegAfter: +(faInfo.span * 180 / Math.PI).toFixed(2),
    mpBefore: [+mpBefore.x.toFixed(2), +mpBefore.y.toFixed(2)],
    mpAfter: [+mpAfter.x.toFixed(2), +mpAfter.y.toFixed(2)],
    residual: +measureResidual(sFM.constraints.find(c => c.type === 'midpoint'), sFM.joints, sFM.shapes).toFixed(6),
  }));

  // 6k. Tangent circle-circle external: drag moving circle straight across fixed circle -> does it flip to internal or jump?
  const { state: sTCC } = fresh();
  const c1 = ops.circle(sTCC, 0, 0, 20);
  sTCC.joints.get(c1.c).fixed = true;
  ConstraintManager.createConstraint(sTCC, CONSTRAINT_TYPES.DISTANCE, { shape: c1.id, value: 20, isRadius: true });
  const c2 = ops.circle(sTCC, 40, 0, 10);
  ConstraintManager.createConstraint(sTCC, CONSTRAINT_TYPES.DISTANCE, { shape: c2.id, value: 10, isRadius: true });
  const tcc = ConstraintManager.createConstraint(sTCC, CONSTRAINT_TYPES.TANGENT, { shapes: [c1.id, c2.id] });
  dragJoint(sTCC, c2.c, -80, 0, 10); // straight through origin to x = -40
  const c2p = sTCC.joints.get(c2.c);
  console.log('6k TANGENT CIRCLE-CIRCLE DRAG THROUGH CENTER:', JSON.stringify({
    branch: tcc.branch,
    c2After: [+c2p.x.toFixed(2), +c2p.y.toFixed(2)],
    distCenter: +Math.hypot(c2p.x, c2p.y).toFixed(3),
    expectedDist: 30,
  }));
}

// ---------------------------------------------------------------------------
// 7. PERFORMANCE: ~200 constrained items, solve ms per drag frame (numbers only)
// ---------------------------------------------------------------------------
section('7. PERFORMANCE: ~200 constrained items, solve ms per drag frame');
{
  for (const nRects of [25, 50]) { // 50 rects = 200 lines + ~400 constraints
    const { state, engine } = fresh();
    let prevBR = null;
    let lastTR = null;
    for (let i = 0; i < nRects; i++) {
      const x = (i % 10) * 35, y = Math.floor(i / 10) * 25;
      const r = ops.rect(state, x, y, x + 25, y + 15);
      if (i === 0) state.joints.get(r.c1).fixed = true;
      else ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [r.c1, prevBR] }, { autoSolve: false, skipVerify: true });
      ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.c1, state.shapes.find(s => s.id === r.top).joints[1]], value: 25 }, { autoSolve: false, skipVerify: true });
      prevBR = r.c3;
      lastTR = state.shapes.find(s => s.id === r.top).joints[1];
    }
    const tSolve0 = performance.now();
    const resInit = engine.solve(500);
    const tSolveMs = performance.now() - tSolve0;

    // Measure 20 drag frames (QUICK_SOLVE = 8 iters + frame solve)
    const j = state.joints.get(lastTR);
    const quickTimes = [], fullTimes = [];
    for (let f = 0; f < 20; f++) {
      const tx = j.x + 1, ty = j.y + 0.5;
      j.dragTarget = { x: tx, y: ty };
      const t0 = performance.now();
      engine.solve(8, { dragTarget: { jointId: lastTR, x: tx, y: ty, stiffness: 1e4 } });
      quickTimes.push(performance.now() - t0);
      const t1 = performance.now();
      engine.solve(500);
      fullTimes.push(performance.now() - t1);
    }
    delete j.dragTarget;
    const tDof0 = performance.now();
    const dof = engine.jointFreedom();
    const tDofMs = performance.now() - tDof0;

    const avg = (arr) => +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
    const p95 = (arr) => +arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * 0.95)].toFixed(2);
    console.log(`7 PERF (${nRects} rects = ${state.shapes.length} shapes, ${state.joints.size} joints, ${state.constraints.length} constraints):`, JSON.stringify({
      initSolveMs: +tSolveMs.toFixed(2),
      converged: resInit.converged,
      quickDrag8MsAvg: avg(quickTimes), quickDrag8MsP95: p95(quickTimes),
      frameSolve500MsAvg: avg(fullTimes), frameSolve500MsP95: p95(fullTimes),
      jointFreedomMs: +tDofMs.toFixed(2),
      nullity: dof.nullity,
    }));
  }
}
