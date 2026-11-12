// Headless dimension SEAMS — pure (state, …) → result, NO DOM. Single source of truth for the
// dimension EDIT and driving-TOGGLE logic, shared by the real UI handlers (numeric-input-manager,
// input-manager) AND the headless harness (tests/harness/sketch.js). Keeping ONE implementation means
// the harness drives the EXACT app logic, so a divergence (like the cross-edge demotion bug) can't hide.
//
// `state` is { joints:Map, shapes:[], constraints:[], engine }.

import { SolverConfig } from '#core/solver-config.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { getDist, perpendicularDistance, isPointLineDistance, getLineIntersection } from '#core/geometry.js';
import { measureShapeSizes, findCollapsedShape } from '#core/constraint-verifier.js';
import { seedFilletForRadius, filletHasCollapsedLine, filletLines } from '#core/fillet.js';
import { snapshotSolverState, restoreSolverState } from '#core/solver/engine.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { angleDimensionChoiceFor } from '#ui/angle-dimension.js';
import { replaceParameters } from '#core/parameters.js';

const ITER = () => SolverConfig.ITERATIONS || 500;
const STEP_FRACTION = 0.1;
const MAX_EDIT_STEPS = 40;

// TASK 507: the history label of a dimension value edit, naming the OLD and NEW value ('edit dimension 23.6 -> 17'). One
// definition shared by every place that snapshots before such an edit.
export function dimensionEditLabel(c, val) {
  const r = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);
  return `edit dimension ${r(c.value)} -> ${r(val)}`;
}

// Commit a numeric edit to a DRIVING dimension's value: the ONE-ELEMENT case of commitDimensionEdits (TASK 535 slice 2), no second path.
// Returns { reverted, clash, reason?, culprit? } so the caller can surface a message. No DOM, no notifications here.
export function commitDimensionEdit(state, c, val) {
  return commitDimensionEdits(state, [{ c, value: val }]);
}

// Commit N dimension value changes as ONE operation (docs/PARAMETERS-DESIGN.md section D). edits = [{ c, value, name? }] (`name` only
// labels a refusal; default c.name). ALL-OR-NOTHING: snapshot of the whole solver state (joints AND circle radii) and of every edited value,
// ONE combined walk (all edited values move together, step count = the largest any single edit needs, capped at MAX_EDIT_STEPS; each step
// places NOTHING when there are several edits (the placement rule below) and then ONE solve). Any refusal (fillet seed, fillet collapse, task 521 collapse,
// non-convergence) restores every value, position and radius, re-solves, and returns
//   { reverted:true, clash, reason?, culprit: { index, name, reason } | null }
// culprit = the FIRST edit (in the given order) that is impossible ALONE, found by a diagnostic pass on refusal only; null when each one
// passes alone (the combination is impossible). A one-element batch is its own culprit.
// opts.refuseReference (the parameter entry point sets it): an edit on a reference (driven) dimension, or on a dimension the other driving
// constraints already DETERMINE (isDimensionDetermined), is refused before anything changes, and that dimension is the culprit.
// Snapshot / undo of the DOCUMENT (saveState) is the caller's: this seam only guarantees the solver-visible state.
export function commitDimensionEdits(state, edits, opts = {}) {
  // Every dimension, a circle's radius included, drives the geometry through the solve: a circle's radius is a solver unknown
  // (engine.js hasRadiusUnknown), written back to shape.radius by the solve. The snapshot is the whole solver state (joints AND
  // circle radii), so a refusal restores both.
  const engine = state && state.engine;
  if (!engine || typeof engine.solve !== 'function') {
    for (const e of edits) e.c.value = e.value;
    return { reverted: false, clash: '' };
  }
  if (!edits.length) return { reverted: false, clash: '' };
  const labelOf = (e, i) => e.name || e.c.name || `dimension ${i + 1}`;
  const whyOf = (r) => r.reason || (r.clash ? `conflicts with ${r.clash}` : 'did not converge');
  // TASK 550: an ANGLE dimension takes a value above 0 (Fusion's dimension box, measured with real keys: 0 and negative values are refused;
  // the sector keeps opening the same way round as the value grows, see the walk below). Refused before anything changes.
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.c.type === CONSTRAINT_TYPES.ANGLE && !(Number(e.value) > 0)) {
      const why = 'an angle must be more than 0 degrees';
      return { reverted: true, clash: '', reason: why, culprit: { index: i, name: labelOf(e, i), reason: why } };
    }
  }
  if (opts.refuseReference) {
    for (let i = 0; i < edits.length; i++) {
      const c = edits[i].c;
      const why = (c.isDriven || c.driven) ? 'is a reference dimension' : isDimensionDetermined(state, c) ? 'is already determined by the other constraints' : null;
      if (why) return { reverted: true, clash: '', reason: `${labelOf(edits[i], i)} ${why}`, culprit: { index: i, name: labelOf(edits[i], i), reason: why } };
    }
  }
  const joints = engine.getJoints ? engine.getJoints() : state.joints;
  const shapes = engine.getShapes ? engine.getShapes() : state.shapes;
  const snap = snapshotSolverState(joints, shapes);
  const oldValues = edits.map(e => e.c.value);
  const sizesBefore = measureShapeSizes(state);
  const restoreAll = () => { edits.forEach((e, i) => { e.c.value = oldValues[i]; }); restoreSolverState(joints, shapes, snap); };
  const revert = (res) => { restoreAll(); engine.solve(ITER()); return res; };

  // ONE attempt at a list of edits from the snapshot state. On a refusal it leaves the state as it found it (restored + re-solved).
  const attempt = (list) => {
    // A fillet arc: start the solver AT the analytic answer for the new radius (never walks a line through zero length), and
    // refuse the one singular value where a line would collapse. Each is seeded first; a refusal restores the ones already seeded.
    const fillets = list.map(e => (e.c.isRadius && e.c.shape && state.shapes) ? state.shapes.find(s => s.id === e.c.shape && s.type === 'arc' && s.filletSharp) || null : null);
    for (let i = 0; i < list.length; i++) {
      if (!fillets[i]) continue;
      const seeded = seedFilletForRadius(state, fillets[i], list[i].value);
      if (!seeded.ok) { restoreAll(); return { reverted: true, clash: '', reason: seeded.reason }; }
    }
    // Walk the values in steps of at most STEP_FRACTION of each old value, solving at each: one big jump lets the solver land on
    // the mirrored tangent branch of a fillet (arc reversed / outside its corner), while small steps follow the solution
    // continuously. A fillet radius edit is already seeded analytically above, so it is not stepped (it takes its value at once). At each
    // step the operand that gives way is placed at the step's value by the creation placement (the who-moves table, task 525) before the solve.
    // The step is a fraction of the OLD value, or of the NEW one when the old value is 0 (TASK 550: an angle edited from 0, two parallel lines,
    // to 179 turned in one jump and the angle row, satisfied modulo 180 degrees, landed on the reversed line at 1 degree; in steps of 17.9
    // degrees the line turns continuously to exactly 179, like Fusion).
    let steps = 1;
    list.forEach((e, i) => {
      if (fillets[i]) return;
      const old = e.c.value, span = Math.abs(e.value - old), ref = Math.abs(old) > 0 ? Math.abs(old) : Math.abs(e.value);
      if (Number.isFinite(span) && ref > 0) steps = Math.max(steps, Math.min(MAX_EDIT_STEPS, Math.max(1, Math.ceil(span / (ref * STEP_FRACTION)))));
    });
    const from = list.map(e => e.c.value);
    // THE PLACEMENT RULE: "who moves" answers a question about the ONE dimension the user typed, so a batch of exactly ONE edit places per step
    // (bit-identical to the old single edit); a batch of several edits is a re-solve of the sketch at new values (what Fusion does for a
    // parameter change) and does NOT place. Known consequence: N independent single edits may land a different (equally valid) pose than the batch.
    const placing = list.length === 1;
    let result;
    for (let k = 1; k <= steps; k++) {
      list.forEach((e, i) => {
        e.c.value = (fillets[i] || k === steps) ? e.value : from[i] + (e.value - from[i]) * (k / steps);
        if (placing && !fillets[i]) ConstraintManager.placeForCreation(state, e.c.type, e.c);
      });
      result = engine.solve(ITER());
      if (result && result.converged === false) break;
    }
    list.forEach(e => { e.c.value = e.value; });
    const collapsedFillet = fillets.findIndex(f => f && filletHasCollapsedLine(state, f));
    if (collapsedFillet !== -1) return revert({ reverted: true, clash: '', reason: `R = ${Number(list[collapsedFillet].value).toFixed(2)} collapsed a line to zero length` });
    // Any constraint satisfied by collapsing a line / arc / circle to a point (or an arc's two ends together) is no solution (task 521,
    // task 550); the edited dimension's own size is exempt (a typed 0 or tiny value is the user's own, see findCollapsedShape). A FILLET
    // radius edit goes through the same rule for every shape (the fillet arc included: its two ends must not meet) EXCEPT the fillet's own
    // tangent legs, judged above by filletHasCollapsedLine: they legitimately get very short as R approaches the singular value (a short leg,
    // under 1 % of its length, is no collapse; only a zero-length leg is).
    const legs = new Set(fillets.filter(Boolean).flatMap(f => filletLines(state, f).map(l => l.line.id)));
    const collapsed = findCollapsedShape(state, sizesBefore, legs);
    if (collapsed) {
      const own = list.find((e, i) => !fillets[i]) || list[0];
      return revert({ reverted: true, clash: '', reason: `${Number(own.value).toFixed(2)} would collapse a ${collapsed.type} to a point` });
    }
    if (result && result.converged === false) {
      const clash = [...new Set((result.conflicts || []).map(x => x.type).filter(Boolean))].join(', ');
      return revert({ reverted: true, clash });
    }
    return { reverted: false, clash: '' };
  };

  const res = attempt(edits);
  if (!res.reverted) return res;
  // Refused: name the dimension that is the problem. One edit is its own culprit; several: the first impossible ALONE, from the restored state.
  if (edits.length === 1) return { ...res, culprit: { index: 0, name: labelOf(edits[0], 0), reason: whyOf(res) } };
  let culprit = null;
  for (let i = 0; i < edits.length && !culprit; i++) {
    const alone = attempt([edits[i]]);
    if (alone.reverted) culprit = { index: i, name: labelOf(edits[i], i), reason: whyOf(alone) };
    else restoreAll();
  }
  engine.solve(ITER());
  return { ...res, culprit };
}

// THE entry point that applies a planChange result (slices 3-5 call only this; parameters.js planChange is pure). plan = the { ok:true, paramsAfter,
// edits:[{ c, name, value, expression }], solve } it returned. ALL-OR-NOTHING including the PARAMETERS: ONE undo step (saveState before), then the
// dimension values go through the batch seam (commitDimensionEdits, reference / determined dimensions refused); only after it succeeds are
// state.parameters and every dimension's name / expression written. A refusal leaves parameters, expressions, names, values, geometry and radii exactly
// as they were and drops the undo step it took (discardSnapshotAt), so the history length is unchanged.
// Returns { ok:true } | { ok:false, reverted:true, clash, reason, culprit } | the refused plan itself ({ ok:false, code, message }; nothing was touched).
export function applyParameterChange(state, plan, label = 'change parameter') {
  if (!plan || !plan.ok) return plan || { ok: false, code: 'SYNTAX', message: 'no plan' };
  const saved = typeof state.saveState === 'function';
  // saveState drops the OLDEST entry when the history is at its cap and clears the redo branch: a refused change must lose neither
  const evicted = saved && state.history && state.history.length >= state.maxHistory ? state.history[0] : null;
  const redo = saved && state.redoStack ? [...state.redoStack] : null;
  if (saved) state.saveState(label);
  const length = saved && state.history ? state.history.length : -1; // discardSnapshotAt pops the newest entry only if the history is still this long
  const moves = plan.edits.filter(e => e.value !== e.c.value).map(e => ({ c: e.c, value: e.value, name: e.name }));
  const res = commitDimensionEdits(state, moves, { refuseReference: true });
  if (res.reverted) {
    if (length >= 0 && typeof state.discardSnapshotAt === 'function') state.discardSnapshotAt(length);
    if (evicted) state.history.unshift(evicted);
    if (redo) state.redoStack.push(...redo);
    if ((evicted || redo) && typeof state._notifyHistory === 'function') state._notifyHistory();
    return { ok: false, ...res };
  }
  replaceParameters(state.parameters, plan.paramsAfter);
  for (const e of plan.edits) {
    e.c.name = e.name;
    if (e.expression) e.c.expression = e.expression; else delete e.c.expression;
  }
  return { ok: true };
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
// Every mode goes through that one test, a radius too (a circle's radius is a solver unknown since task 515, so a second driving
// radius on the same circle, or an equal to a dimensioned circle, determines it: there is no separate radius swap any more).
// When promoting, recompute the value from geometry and re-solve.
// Returns { nowDriving, refused, error } (error = 'ERR-DRIVE-02' when the solve doesn't converge after promoting).
// No DOM, no notifications here.
export function toggleDriving(state, c) {
  if (c.isDriven && isDimensionDetermined(state, c)) return { nowDriving: false, refused: true, error: null };

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
          // the sector the label sits in is what a reference measured (task 543): its span, with `supplement` when it is the other pair
          const int = getLineIntersection(j1a, j1b, j2a, j2b);
          if (int) {
            const ch = angleDimensionChoiceFor(c, j1a, j1b, j2a, j2b, int);
            c.value = ch.value;
            if (ch.supplement) c.supplement = true; else delete c.supplement;
          } else {
            // parallel lines have no sectors: the angle between the directions (0 or 180)
            let v = Math.abs((Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x) - Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x)) * 180 / Math.PI);
            c.value = v > 180 ? 360 - v : v;
          }
        }
      }
    }
    if (state.engine && typeof state.engine.solve === 'function') {
      const result = state.engine.solve(ITER());
      if (result && result.converged === false) error = 'ERR-DRIVE-02';
    }
  }
  return { nowDriving: !c.isDriven, refused: false, error };
}
