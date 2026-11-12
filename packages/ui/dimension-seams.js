// Headless dimension SEAMS — pure (state, …) → result, NO DOM. Single source of truth for the
// dimension EDIT and driving-TOGGLE logic, shared by the real UI handlers (numeric-input-manager,
// input-manager) AND the headless harness (tests/harness/sketch.js). Keeping ONE implementation means
// the harness drives the EXACT app logic, so a divergence (like the cross-edge demotion bug) can't hide.
//
// `state` is { joints:Map, shapes:[], constraints:[], engine }.

import { SolverConfig } from '#core/solver-config.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { getDist, perpendicularDistance, isPointLineDistance } from '#core/geometry.js';
import { measureShapeSizes, findCollapsedShape } from '#core/constraint-verifier.js';
import { seedFilletForRadius, filletHasCollapsedLine } from '#core/fillet.js';

const ITER = () => SolverConfig.ITERATIONS || 500;
const STEP_FRACTION = 0.1;
const MAX_EDIT_STEPS = 40;

// TASK 507: the history label of a dimension value edit, naming the OLD and NEW value ('edit dimension 23.6 -> 17'). One
// definition shared by every place that snapshots before such an edit.
export function dimensionEditLabel(c, val) {
  const r = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);
  return `edit dimension ${r(c.value)} -> ${r(val)}`;
}

// Commit a numeric edit to a DRIVING dimension's value. Snapshot → set → solve; on a genuine
// non-convergence REFUSE + REVERT to the last valid shape (restore value + positions, re-solve).
// Returns { reverted, clash } so the caller can surface a message. No DOM, no notifications here.
export function commitDimensionEdit(state, c, val) {
  // A CIRCLE's radius dimension has no rim joint for the solver to move (engine.js's isRadius row
  // requires shape.joints.length >= 2, but circle-tool.js creates a circle with only the center
  // joint) -- every other consumer (tangent, point-on-circle) already reads shape.radius directly
  // as the source of truth, so an edit here must move THAT, not rely on the (inert) joint row to do
  // it. An ARC's isRadius row DOES have a real rim joint (makeArc creates 3: center + 2 rim points)
  // so the solver already moves it correctly via the Jacobian -- arcs never get a `.radius` field
  // written anywhere (grepped every `.radius =` site), and every reader falls back to a live
  // joint-distance computation when it's absent. Writing `.radius` here for an arc would freeze a
  // stale scalar that those readers would then prefer over live geometry, so this is scoped to
  // shapes with NO rim joint (the same `< 2` the engine itself already keys off of) -- circles today.
  const shapeForRadius = (c.isRadius && c.shape && state && state.shapes)
    ? state.shapes.find(s => s.id === c.shape && (!s.joints || s.joints.length < 2))
    : null;
  const oldRadius = shapeForRadius ? shapeForRadius.radius : undefined;

  const engine = state && state.engine;
  if (!engine || typeof engine.solve !== 'function') {
    c.value = val;
    if (shapeForRadius) shapeForRadius.radius = val;
    return { reverted: false, clash: '' };
  }
  const oldValue = c.value;
  const joints = engine.getJoints ? engine.getJoints() : state.joints;
  const sizesBefore = measureShapeSizes(state);
  const snap = new Map();
  if (joints) joints.forEach((j, id) => snap.set(id, { x: j.x, y: j.y }));

  // A fillet arc: start the solver AT the analytic answer for the new radius (never walks a line through zero
  // length), and refuse the one singular value where a line would collapse. Snapshot above restores on refusal.
  const filletArc = (c.isRadius && c.shape && state.shapes) ? state.shapes.find(s => s.id === c.shape && s.type === 'arc' && s.filletSharp) : null;
  if (filletArc) {
    const seeded = seedFilletForRadius(state, filletArc, val);
    if (!seeded.ok) return { reverted: true, clash: '', reason: seeded.reason };
  }
  c.value = val;
  if (shapeForRadius) shapeForRadius.radius = val;
  // Walk the value in steps of at most STEP_FRACTION of the old value, solving at each: one big jump lets the solver land on
  // the mirrored tangent branch of a fillet (arc reversed / outside its corner), while small steps follow the solution
  // continuously. A fillet radius edit is already seeded analytically above, so it takes the single solve.
  let result;
  const span = Math.abs(val - oldValue);
  const steps = (!filletArc && !shapeForRadius && Number.isFinite(span) && Math.abs(oldValue) > 0)
    ? Math.min(MAX_EDIT_STEPS, Math.max(1, Math.ceil(span / (Math.abs(oldValue) * STEP_FRACTION)))) : 1;
  for (let k = 1; k <= steps; k++) {
    c.value = k === steps ? val : oldValue + (val - oldValue) * (k / steps);
    result = engine.solve(ITER());
    if (result && result.converged === false) break;
  }
  c.value = val;
  if (filletArc && filletHasCollapsedLine(state, filletArc)) {
    c.value = oldValue;
    if (joints) joints.forEach((j, id) => { const s = snap.get(id); if (s) { j.x = s.x; j.y = s.y; } });
    engine.solve(ITER());
    return { reverted: true, clash: '', reason: `R = ${Number(val).toFixed(2)} collapsed a line to zero length` };
  }
  // Any constraint satisfied by collapsing a line / arc / circle to a point is no solution (task 521); the edited dimension's own
  // shape is exempt (a typed 0 or tiny value is the user's own, see findCollapsedShape).
  const collapsed = findCollapsedShape(state, sizesBefore);
  if (collapsed) {
    c.value = oldValue;
    if (shapeForRadius) shapeForRadius.radius = oldRadius;
    if (joints) joints.forEach((j, id) => { const s = snap.get(id); if (s) { j.x = s.x; j.y = s.y; } });
    engine.solve(ITER());
    return { reverted: true, clash: '', reason: `${Number(val).toFixed(2)} would collapse a ${collapsed.type} to a point` };
  }
  if (result && result.converged === false) {
    const clash = [...new Set((result.conflicts || []).map(x => x.type).filter(Boolean))].join(', ');
    c.value = oldValue;
    if (shapeForRadius) shapeForRadius.radius = oldRadius;
    if (joints) joints.forEach((j, id) => { const s = snap.get(id); if (s) { j.x = s.x; j.y = s.y; } });
    engine.solve(ITER());
    return { reverted: true, clash };
  }
  return { reverted: false, clash: '' };
}

// A dimension value dragged to a free spot: its label centre follows the pointer in X and Y (constraint.labelPos, world
// units). Pure presentation: no solve. The first move past a few pixels is ONE undo step (the state saved before it).
export const DIM_LABEL_DRAG_THRESHOLD_PX = 4;
export function dragDimensionLabel(state, drag, e, w) {
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) < DIM_LABEL_DRAG_THRESHOLD_PX) return;
    state.saveState('move dimension label');
    drag.started = true;
  }
  drag.constraint.labelPos = { x: w.x, y: w.y };
}

// THE redundancy test for a dimension (owner ruling, task 516): is this dimension's quantity already DETERMINED by the other
// DRIVING constraints of the sketch? One engine rank test (engine.isDistanceRedundant, which reads the constraint's own Jacobian
// row(s), so it covers every mode: aligned / horizontal / vertical, point-to-line, line-line, angle, radius). The dimension is
// lifted out of the constraint list for the test so it is never compared with itself. Every caller (placement, the value box,
// the Driving toggle) asks THIS function.
export function isDimensionDetermined(state, c) {
  if (!c || (c.type !== CONSTRAINT_TYPES.DISTANCE && c.type !== CONSTRAINT_TYPES.ANGLE)) return false;
  if (!state || !state.engine || typeof state.engine.isDistanceRedundant !== 'function') return false;
  const idx = state.constraints.indexOf(c);
  if (idx !== -1) state.constraints.splice(idx, 1);
  try {
    return state.engine.isDistanceRedundant({ ...c, isDriven: false, driven: false });
  } finally {
    if (idx !== -1) state.constraints.splice(idx, 0, c);
  }
}

// Toggle a dimension between DRIVING and reference (FLIP). A reference whose quantity the rest of the sketch still determines
// cannot become driving (Fusion: over-constrained): the toggle is REFUSED and nothing changes, returned as { refused: true }.
// A reference radius keeps the one-driver-per-shape swap. When promoting, recompute the value from geometry and re-solve.
// Returns { nowDriving, swapped, refused, error } (error = 'ERR-DRIVE-02' when the solve doesn't converge after promoting).
// No DOM, no notifications here.
export function toggleDriving(state, c) {
  let swapped = false;
  if (c.isDriven) {
    if (isDimensionDetermined(state, c)) return { nowDriving: false, swapped: false, refused: true, error: null };
    if (c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius && c.shape) {
      const others = state.constraints.filter(oc =>
        oc !== c && !oc.isDriven && !oc.driven &&
        oc.type === CONSTRAINT_TYPES.DISTANCE && oc.isRadius && oc.shape === c.shape);
      if (others.length) { for (const oc of others) { oc.isDriven = true; oc.driven = true; } swapped = true; }
    }
  }

  c.isDriven = !c.isDriven;
  c.driven = c.isDriven; // keep both flags in sync (solver/renderer read isDriven || driven)

  let error = null;
  if (!c.isDriven) {
    // Now DRIVING — sync the value to the current geometry so it doesn't snap to a stale value.
    if (c.isRadius && c.shape) {
      const s = state.shapes.find(x => x.id === c.shape);
      if (s && typeof s.radius === 'number') c.value = s.radius;
    } else if (isPointLineDistance(c)) {
      const pt = state.joints.get(c.joints[0]), la = state.joints.get(c.joints[1]), lb = state.joints.get(c.joints[2]);
      if (pt && la && lb) c.value = Math.abs(perpendicularDistance(pt, la, lb));
    } else if (c.joints && c.joints.length >= 2) {
      const j1 = state.joints.get(c.joints[0]);
      const j2 = state.joints.get(c.joints[1]);
      if (j1 && j2) c.value = getDist(j1, j2);
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
      const s1 = state.shapes.find(s => s.id === c.shapes[0]);
      const s2 = state.shapes.find(s => s.id === c.shapes[1]);
      if (s1 && s2 && s1.joints && s2.joints) {
        const j1a = state.joints.get(s1.joints[0]); const j1b = state.joints.get(s1.joints[1]);
        const j2a = state.joints.get(s2.joints[0]); const j2b = state.joints.get(s2.joints[1]);
        if (j1a && j1b && j2a && j2b) {
          const a1 = Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x);
          const a2 = Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x);
          let v = Math.abs((a1 - a2) * 180 / Math.PI);
          if (v > 180) v = 360 - v;
          c.value = v;
        }
      }
    }
    if (state.engine && typeof state.engine.solve === 'function') {
      const result = state.engine.solve(ITER());
      if (result && result.converged === false) error = 'ERR-DRIVE-02';
    }
  }
  return { nowDriving: !c.isDriven, swapped, refused: false, error };
}
