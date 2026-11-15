// tests/slot-tool-node.test.js — TASK 673: pure geometry, solver DOF, width diameter edit, drag, undo/redo, save/load, construction & pointer flow for all 5 Fusion slot types.
import assert from 'node:assert/strict';
import { TOOL_MODES, SLOT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { createEngine } from '#core/constraint-solver.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { arcSweepInfo } from '#core/geometry.js';
import {
  circumcenter3Pt,
  arcSweepFor3Pt,
  arcAngleSpan,
  makeSlotCenterToCenter,
  makeSlotOverall,
  makeSlotCenterPoint,
  makeSlotThreePointArc,
  makeSlotCenterPointArc,
} from '#core/slot.js';
import { createSketchState } from '#ui/sketch-state.js';
import { commitDimensionEdit, toggleDriving } from '#ui/dimension-seams.js';
import { formatConstraintValue } from '#ui/svg-renderer.js';
import { handleSlotPointerDown, handleSlotPointerMove, handleSlotPointerUp, resetSlotState } from '#ui/input-handlers/slot-tool.js';
import { handleDrawingPointerDown, handleDrawingPointerMove, handleDrawingPointerUp, setupDrawingTools } from '#ui/input-handlers/drawing-tools.js';

const view = { width: 800, height: 600, x: 0, y: 0, w: 400, h: 300, panX: 0, panY: 0, zoom: 1 };
const ALLOWED_TYPES = new Set([
  CONSTRAINT_TYPES.EQUAL,
  CONSTRAINT_TYPES.TANGENT,
  CONSTRAINT_TYPES.PARALLEL,
  CONSTRAINT_TYPES.POINT_ON_LINE,
  CONSTRAINT_TYPES.MIDPOINT,
  CONSTRAINT_TYPES.DISTANCE,
]);

function near(a, b, tol = 1e-4, msg = '') {
  assert(Math.abs(a - b) <= tol, `${msg}: expected ${a} ~= ${b} (diff=${Math.abs(a - b)})`);
}

function makeFreshState() {
  const engine = createEngine();
  engine.init();
  const state = createSketchState(engine, { ...view });
  return { engine, state };
}

function verifyArcCapOutward(joints, capArc, sideTargetPt, label) {
  const c = joints.get(capArc.joints[0]);
  const s = joints.get(capArc.joints[1]);
  const e = joints.get(capArc.joints[2]);
  const info = arcSweepInfo(c, s, e, { sweep: capArc.sweep });
  const aMid = info.a0 + info.dir * (info.span * 0.5);
  const r = Math.hypot(s.x - c.x, s.y - c.y);
  const midPt = { x: c.x + r * Math.cos(aMid), y: c.y + r * Math.sin(aMid) };
  // Midpoint of outward cap must be AWAY from the opposite end center
  const dMid = Math.hypot(midPt.x - sideTargetPt.x, midPt.y - sideTargetPt.y);
  const dCen = Math.hypot(c.x - sideTargetPt.x, c.y - sideTargetPt.y);
  assert(dMid > dCen, `${label}: end cap bows inward instead of outward (dMid=${dMid.toFixed(2)}, dCen=${dCen.toFixed(2)})`);
}

function verifyArcTangency(joints, aArc, bArc, sharedJointId, label) {
  const ca = joints.get(aArc.joints[0]), cb = joints.get(bArc.joints[0]);
  const p = joints.get(sharedJointId);
  const r1x = p.x - ca.x, r1y = p.y - ca.y;
  const r2x = p.x - cb.x, r2y = p.y - cb.y;
  const l1 = Math.hypot(r1x, r1y), l2 = Math.hypot(r2x, r2y);
  const cross = Math.abs(r1x * r2y - r1y * r2x) / (l1 * l2);
  near(cross, 0, 1e-4, `${label}: radial vectors at shared joint must be collinear (sin=${cross})`);
}

function verifyLineArcTangency(joints, line, arc, sharedJointId, label) {
  const ca = joints.get(arc.joints[0]);
  const p = joints.get(sharedJointId);
  const q1 = joints.get(line.joints[0]), q2 = joints.get(line.joints[1]);
  const ldx = q2.x - q1.x, ldy = q2.y - q1.y;
  const rx = p.x - ca.x, ry = p.y - ca.y;
  const dot = Math.abs((ldx * rx + ldy * ry) / (Math.hypot(ldx, ldy) * Math.hypot(rx, ry)));
  near(dot, 0, 1e-4, `${label}: line and radius at ${sharedJointId} must be orthogonal (cos=${dot})`);
}

// ── 1. Center to Center Slot ─────────────────────────────────────────────────
{
  const { engine, state } = makeFreshState();
  state.joints.set('jc1', { x: 0, y: 0, fixed: false });
  state.joints.set('jc2', { x: 100, y: 0, fixed: false });
  const res = makeSlotCenterToCenter(state.joints, 'jc1', 'jc2', 20, () => engine.genJ());
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);

  assert.strictEqual(res.shapes.length, 5, 'C2C has 5 shapes');
  assert.strictEqual(res.shapes.filter(s => s.isConstruction).length, 1, 'only centerline is construction');
  assert.strictEqual(res.shapes.filter(s => s.type === 'line' && !s.isConstruction).length, 2, '2 solid side lines');
  assert.strictEqual(res.shapes.filter(s => s.type === 'arc' && !s.isConstruction && s.subType === 'CENTER').length, 2, '2 solid CENTER arcs');
  assert.strictEqual(res.meta.cl.isConstruction, true, 'centerline is construction');
  assert.strictEqual(res.meta.cl.groupId, undefined, 'centerline has no groupId');
  assert(res.constraints.every(c => ALLOWED_TYPES.has(c.type)), 'only existing constraint types used');
  const dims = res.constraints.filter(c => c.type === CONSTRAINT_TYPES.DISTANCE);
  assert.strictEqual(dims.length, 1, 'exactly 1 driving width dim');
  assert.strictEqual(dims[0].isDiameter, true);
  assert.strictEqual(dims[0].isRadius, true);
  assert(formatConstraintValue(dims[0]).startsWith('Ø '), 'width formats as diameter: ' + formatConstraintValue(dims[0]));

  const solveOut = state.engine.solve();
  assert.strictEqual(solveOut.converged, true, 'C2C converges cleanly');
  near(solveOut.error, 0, 1e-6, 'C2C max residual');

  // Outward caps & tangency
  verifyArcCapOutward(state.joints, res.meta.e1, state.joints.get('jc2'), 'C2C e1');
  verifyArcCapOutward(state.joints, res.meta.e2, state.joints.get('jc1'), 'C2C e2');
  verifyLineArcTangency(state.joints, res.meta.s1, res.meta.e1, res.meta.a1Id, 'C2C s1-e1');
  verifyLineArcTangency(state.joints, res.meta.s2, res.meta.e1, res.meta.a2Id, 'C2C s2-e1');
  verifyLineArcTangency(state.joints, res.meta.s1, res.meta.e2, res.meta.b1Id, 'C2C s1-e2');
  verifyLineArcTangency(state.joints, res.meta.s2, res.meta.e2, res.meta.b2Id, 'C2C s2-e2');

  // DOF checks: 4 free, 0 with jc1+jc2 fixed
  assert.strictEqual(state.engine.jointFreedom().nullity, 4, 'C2C free DOF === 4');
  state.joints.get('jc1').fixed = true;
  state.joints.get('jc2').fixed = true;
  assert.strictEqual(state.engine.jointFreedom().nullity, 0, 'C2C fixed ends DOF === 0');

  // Edit width: moves BOTH sides symmetrically while keeping centers pinned
  const a1Before = state.joints.get(res.meta.a1Id).y;
  const a2Before = state.joints.get(res.meta.a2Id).y;
  near(Math.abs(a1Before - a2Before), 20, 1e-4, 'initial width');
  const edit = commitDimensionEdit(state, dims[0], '30');
  assert.strictEqual(edit.reverted, false, 'C2C width edit accepted');
  near(state.joints.get(res.meta.a1Id).y, 15, 1e-3, 'top side shifted +15');
  near(state.joints.get(res.meta.a2Id).y, -15, 1e-3, 'bottom side shifted -15');

  // Unfix jc2 and drag it to (130, 20) -> slot moves cleanly while preserving width 30
  state.joints.get('jc2').fixed = false;
  state.joints.get('jc2').dragTarget = { x: 130, y: 20 };
  const dragOut = state.engine.solve(200);
  delete state.joints.get('jc2').dragTarget;
  assert.strictEqual(dragOut.converged, true, 'C2C drag converges');
  near(state.joints.get('jc2').x, 130, 1e-2, 'dragged jc2.x');
  near(state.joints.get('jc2').y, 20, 1e-2, 'dragged jc2.y');
  near(Math.hypot(
    state.joints.get(res.meta.a1Id).x - state.joints.get(res.meta.a2Id).x,
    state.joints.get(res.meta.a1Id).y - state.joints.get(res.meta.a2Id).y
  ), 30, 1e-2, 'width preserved across drag');
}

// ── 2. Overall Slot ──────────────────────────────────────────────────────────
{
  const { engine, state } = makeFreshState();
  state.joints.set('jt1', { x: 0, y: 0, fixed: false });
  state.joints.set('jt2', { x: 120, y: 0, fixed: false });
  const res = makeSlotOverall(state.joints, 'jt1', 'jt2', 20, () => engine.genJ());
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);

  assert.strictEqual(state.engine.solve().converged, true, 'Overall slot converges');
  near(state.joints.get(res.meta.c1Id).x, 10, 1e-4, 'Overall c1 inset by r=10');
  near(state.joints.get(res.meta.c2Id).x, 110, 1e-4, 'Overall c2 inset by r=10');
  verifyArcCapOutward(state.joints, res.meta.e1, state.joints.get(res.meta.c2Id), 'Overall e1');
  verifyArcCapOutward(state.joints, res.meta.e2, state.joints.get(res.meta.c1Id), 'Overall e2');

  assert.strictEqual(state.engine.jointFreedom().nullity, 4, 'Overall free DOF === 4');
  state.joints.get('jt1').fixed = true;
  state.joints.get('jt2').fixed = true;
  assert.strictEqual(state.engine.jointFreedom().nullity, 0, 'Overall fixed tips DOF === 0');

  // Width edit keeps tips pinned at (0,0) and (120,0) and shifts c1->20, c2->100 symmetrically
  const edit = commitDimensionEdit(state, res.meta.widthDim, '40');
  assert.strictEqual(edit.reverted, false, 'Overall width edit accepted');
  near(state.joints.get('jt1').x, 0, 1e-3, 't1 stays pinned');
  near(state.joints.get('jt2').x, 120, 1e-3, 't2 stays pinned');
  near(state.joints.get(res.meta.c1Id).x, 20, 1e-2, 'c1 shifts to r=20');
  near(state.joints.get(res.meta.c2Id).x, 100, 1e-2, 'c2 shifts to 120-r=100');
}

// ── 3. Center Point Slot ─────────────────────────────────────────────────────
{
  const { engine, state } = makeFreshState();
  state.joints.set('jm', { x: 50, y: 10, fixed: false });
  state.joints.set('jc2', { x: 100, y: 10, fixed: false });
  const res = makeSlotCenterPoint(state.joints, 'jm', 'jc2', 20, () => engine.genJ());
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);

  assert.strictEqual(state.engine.solve().converged, true, 'Center Point slot converges');
  near(state.joints.get(res.meta.c1Id).x, 0, 1e-4, 'mirrored c1.x');
  near(state.joints.get(res.meta.c1Id).y, 10, 1e-4, 'mirrored c1.y');

  assert.strictEqual(state.engine.jointFreedom().nullity, 4, 'Center Point free DOF === 4');
  state.joints.get('jm').fixed = true;
  assert.strictEqual(state.engine.jointFreedom().nullity, 2, 'Center Point M fixed DOF === 2');

  // Drag jc2 -> c1 mirrors through jm!
  state.joints.get('jc2').dragTarget = { x: 80, y: 30 };
  let dragOut;
  for (let k = 0; k < 5; k++) dragOut = state.engine.solve(200);
  delete state.joints.get('jc2').dragTarget;
  assert.strictEqual(dragOut.converged, true, 'Center Point mirror drag converges');
  near(state.joints.get(res.meta.c1Id).x, 20, 1e-2, 'mirrored c1.x after drag');
  near(state.joints.get(res.meta.c1Id).y, -10, 1e-2, 'mirrored c1.y after drag');

  // Width edit moves both sides symmetrically
  const edit = commitDimensionEdit(state, res.meta.widthDim, '28');
  assert.strictEqual(edit.reverted, false, 'Center Point width edit accepted');
  near(Math.hypot(
    state.joints.get(res.meta.a1Id).x - state.joints.get(res.meta.a2Id).x,
    state.joints.get(res.meta.a1Id).y - state.joints.get(res.meta.a2Id).y
  ), 28, 1e-2, 'Center Point width updated to 28');
}

// ── 4. Three Point Arc Slot (CCW, CW, and >180° major arc!) ─────────────────
for (const [tag, p3, expectSweep] of [
  ['Arc3Pt CCW <180', { x: 60 * Math.SQRT1_2, y: 60 * Math.SQRT1_2 }, true],
  ['Arc3Pt CW major >180', { x: -60 * Math.SQRT1_2, y: -60 * Math.SQRT1_2 }, false],
]) {
  const { engine, state } = makeFreshState();
  state.joints.set('ja', { x: 60, y: 0, fixed: false });
  state.joints.set('jb', { x: 0, y: 60, fixed: false });
  const res = makeSlotThreePointArc(state.joints, 'ja', 'jb', p3, 16, () => engine.genJ());
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);

  assert.strictEqual(res.shapes.length, 5, tag + ' has 5 shapes');
  assert.strictEqual(res.shapes.filter(s => s.isConstruction).length, 1, tag + ' only center arc is construction');
  assert.strictEqual(res.meta.ac.sweep, expectSweep, tag + ' sweep direction');
  const solveOut = state.engine.solve();
  assert.strictEqual(solveOut.converged, true, tag + ' converges cleanly');

  // Tangency at all 4 rim joints
  verifyArcTangency(state.joints, res.meta.ao, res.meta.e1, res.meta.o1Id, tag + ' ao-e1');
  verifyArcTangency(state.joints, res.meta.ai, res.meta.e1, res.meta.i1Id, tag + ' ai-e1');
  verifyArcTangency(state.joints, res.meta.ao, res.meta.e2, res.meta.o2Id, tag + ' ao-e2');
  verifyArcTangency(state.joints, res.meta.ai, res.meta.e2, res.meta.i2Id, tag + ' ai-e2');

  // Outward caps away from arc midpoint along the center arc
  const cm0 = state.joints.get(res.meta.centerId);
  const ja0 = state.joints.get('ja'), jb0 = state.joints.get('jb');
  const acInfo = arcSweepInfo(cm0, ja0, jb0, { sweep: res.meta.ac.sweep });
  const acMidA = acInfo.a0 + acInfo.dir * (acInfo.span * 0.25);
  const nearJaOnArc = {
    x: cm0.x + acInfo.span * 0 + Math.hypot(ja0.x - cm0.x, ja0.y - cm0.y) * Math.cos(acMidA),
    y: cm0.y + Math.hypot(ja0.x - cm0.x, ja0.y - cm0.y) * Math.sin(acMidA),
  };
  verifyArcCapOutward(state.joints, res.meta.e1, nearJaOnArc, tag + ' e1');

  // Width edit from 16 -> 24 moves outer +4 and inner -4
  const edit = commitDimensionEdit(state, res.meta.widthDim, '24');
  assert.strictEqual(edit.reverted, false, tag + ' width edit accepted');
  const cm = state.joints.get(res.meta.centerId);
  const o1 = state.joints.get(res.meta.o1Id), i1 = state.joints.get(res.meta.i1Id);
  near(Math.hypot(o1.x - i1.x, o1.y - i1.y), 24, 1e-2, tag + ' width after edit');
  near(Math.hypot(o1.x - cm.x, o1.y - cm.y) - Math.hypot(i1.x - cm.x, i1.y - cm.y), 24, 1e-2, tag + ' outer - inner === 24');
}

// ── 5. Center Point Arc Slot ────────────────────────────────────────────────
{
  const { engine, state } = makeFreshState();
  state.joints.set('jcm', { x: 0, y: 0, fixed: false });
  state.joints.set('ja', { x: 80, y: 0, fixed: false });
  state.joints.set('jb', { x: 0, y: 80, fixed: false });
  const res = makeSlotCenterPointArc(state.joints, 'jcm', 'ja', 'jb', false, 20, () => engine.genJ());
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);

  assert.strictEqual(res.meta.ac.sweep, false, 'CW sweep preserved');
  assert.strictEqual(state.engine.solve().converged, true, 'Center Point Arc converges');
  verifyArcTangency(state.joints, res.meta.ao, res.meta.e1, res.meta.o1Id, 'CPArc ao-e1');
  verifyArcTangency(state.joints, res.meta.ai, res.meta.e2, res.meta.i2Id, 'CPArc ai-e2');

  // DOF recorded cleanly (pinned N-F7 keeps nullity=9 free / 4 when cm,c1,c2 fixed)
  assert.strictEqual(state.engine.jointFreedom().nullity, 9, 'Arc slot free DOF === 9 (known N-F7)');
  state.joints.get('jcm').fixed = true;
  state.joints.get('ja').fixed = true;
  state.joints.get('jb').fixed = true;
  assert.strictEqual(state.engine.jointFreedom().nullity, 4, 'Arc slot fixed 3 centers DOF === 4 (known N-F7)');

  // Drag jb smoothly along the circle while jcm + ja fixed (0,80) -> (-40, 69.282), then release
  state.joints.get('jb').fixed = false;
  state.joints.get('jb').dragTarget = { x: -40, y: 69.282 };
  for (let k = 0; k < 5; k++) state.engine.solve(200);
  delete state.joints.get('jb').dragTarget;
  const dragOut = state.engine.solve(200);
  assert.strictEqual(dragOut.converged, true, 'Center Point Arc drag converges cleanly on release');
  assert(state.joints.get('jb').x < -10, 'jb moved significantly along the arc');
  near(Math.hypot(state.joints.get('jb').x, state.joints.get('jb').y), 80, 1e-2, 'jb radius stays 80');

  // Toggle driving -> reference -> driving preserves 2*radius width
  const toRef = toggleDriving(state, res.meta.widthDim);
  assert.strictEqual(toRef.refused, false);
  assert.strictEqual(res.meta.widthDim.isDriven, true);
  res.meta.widthDim.value = 999; // corrupt stale value to confirm re-sync from radius*2
  const toDrv = toggleDriving(state, res.meta.widthDim);
  assert.strictEqual(toDrv.refused, false);
  near(res.meta.widthDim.value, 20, 1e-2, 'toggleDriving re-syncs width to 2*radius');
}

// ── 6. Save/Load JSON roundtrip ─────────────────────────────────────────────
{
  const { engine, state } = makeFreshState();
  state.joints.set('ja', { x: 10, y: 20, fixed: false });
  state.joints.set('jb', { x: 90, y: 20, fixed: false });
  const res = makeSlotCenterToCenter(state.joints, 'ja', 'jb', 18, () => engine.genJ(), true);
  state.shapes.push(...res.shapes);
  state.constraints.push(...res.constraints);
  assert.strictEqual(state.shapes.every(s => s.isConstruction === true), true, 'construction mode makes all 5 shapes construction');

  const json = JSON.parse(JSON.stringify(serializeDocument(state)));
  const { engine: eng2, state: state2 } = makeFreshState();
  const loaded = deserializeDocument(json, state2);
  assert.strictEqual(loaded.ok, true, 'deserializeDocument succeeds');
  const d = state2.constraints.find(c => c.type === CONSTRAINT_TYPES.DISTANCE);
  assert.strictEqual(d && d.isDiameter, true, 'isDiameter survives save/load roundtrip');
  assert.strictEqual(state2.shapes.length, 5, 'all 5 slot shapes survive roundtrip');
  assert.strictEqual(eng2.solve().converged, true, 're-solved loaded slot converges');
}

// ── 7. Pointer flow + Undo/Redo + Abort + Active-sketch snapping ────────────
{
  const { state } = makeFreshState();
  const mockSvg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  setupDrawingTools(mockSvg, state);
  state.currentTool = TOOL_MODES.SLOT;
  state.slotMode = SLOT_MODES.CENTER_TO_CENTER;

  const ev = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', button: 0, preventDefault() {} });

  // Mid-draw cancel leaves zero shapes & zero joints
  handleDrawingPointerDown(ev(10, 10), mockSvg, state, null, { x: 10, y: 10 });
  handleDrawingPointerUp(ev(10, 10), mockSvg, state, null, { x: 10, y: 10 }, false);
  handleDrawingPointerMove(ev(60, 10), mockSvg, state, { x: 60, y: 10 });
  assert(state.active && state.active.mode === TOOL_MODES.SLOT, 'slot drawing is active');
  resetSlotState(state);
  assert.strictEqual(state.shapes.length, 0, 'abort adds 0 shapes');
  assert.strictEqual(state.joints.size, 1, 'abort leaves only j_origin');

  // Complete a full slot with 3 clicks -> 1 undo step removes ALL 5 shapes + constraints
  const hist0 = state.history.length;
  handleSlotPointerDown(ev(0, 0), mockSvg, state, { isLocked: true, type: 'joint', jointId: 'j_origin', pt: { x: 0, y: 0 } }, { x: 0, y: 0 });
  handleSlotPointerUp(ev(0, 0), mockSvg, state, { isLocked: true, type: 'joint', jointId: 'j_origin', pt: { x: 0, y: 0 } }, { x: 0, y: 0 });
  handleSlotPointerMove(ev(100, 0), mockSvg, state, { x: 100, y: 0 });
  handleSlotPointerDown(ev(100, 0), mockSvg, state, null, { x: 100, y: 0 });
  handleSlotPointerUp(ev(100, 0), mockSvg, state, null, { x: 100, y: 0 });
  handleSlotPointerMove(ev(50, 12), mockSvg, state, { x: 50, y: 12 });
  handleSlotPointerDown(ev(50, 12), mockSvg, state, null, { x: 50, y: 12 });
  handleSlotPointerUp(ev(50, 12), mockSvg, state, null, { x: 50, y: 12 });

  assert.strictEqual(state.shapes.length, 5, 'pointer flow created 5 shapes');
  assert.strictEqual(state.history.length, hist0 + 1, 'exactly 1 undo step added');
  assert.strictEqual(state.joints.has('j_origin'), true);
  state.undo();
  assert.strictEqual(state.shapes.length, 0, '1 undo removes all 5 shapes');
  assert.strictEqual(state.constraints.length, 0, '1 undo removes all constraints');
  state.redo();
  assert.strictEqual(state.shapes.length, 5, '1 redo restores all 5 shapes');

  // Inactive-sketch snap target is position-only (does not join or constrain to j_other)
  state.undo();
  const baseShapes = state.shapes.length;
  handleSlotPointerDown(ev(25, 10), mockSvg, state, { type: 'joint', jointId: 'j_other', pt: { x: 25, y: 10 }, otherSketch: true }, { x: 25, y: 10 });
  handleSlotPointerUp(ev(25, 10), mockSvg, state, null, { x: 25, y: 10 });
  handleSlotPointerMove(ev(75, 10), mockSvg, state, { x: 75, y: 10 });
  handleSlotPointerDown(ev(75, 10), mockSvg, state, null, { x: 75, y: 10 });
  handleSlotPointerUp(ev(75, 10), mockSvg, state, null, { x: 75, y: 10 });
  handleSlotPointerMove(ev(50, 20), mockSvg, state, { x: 50, y: 20 });
  handleSlotPointerDown(ev(50, 20), mockSvg, state, null, { x: 50, y: 20 });
  handleSlotPointerUp(ev(50, 20), mockSvg, state, null, { x: 50, y: 20 });
  assert.strictEqual(state.shapes.length, baseShapes + 5, 'slot still created from otherSketch coordinates');
  assert.strictEqual(state.constraints.some(c => c.joints?.includes('j_other') || c.jointA === 'j_other' || c.jointB === 'j_other'), false, 'never constrains to inactive-sketch joint');
  assert.strictEqual(state.shapes.some(s => s.joints?.includes('j_other')), false, 'never shares inactive-sketch joint ID');
}

console.log('slot-tool-node: all 5 types, DOFs, edits, drags, roundtrips, and pointer flow passed!');
