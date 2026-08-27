// Headless dimension SEAMS — pure (state, …) → result, NO DOM. Single source of truth for the
// dimension EDIT and driving-TOGGLE logic, shared by the real UI handlers (numeric-input-manager,
// input-manager) AND the headless harness (tests/harness/sketch.js). Keeping ONE implementation means
// the harness drives the EXACT app logic, so a divergence (like the cross-edge demotion bug) can't hide.
//
// `state` is { joints:Map, shapes:[], constraints:[], engine }.

import { SolverConfig } from '#core/solver-config.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { getDist } from '#core/geometry.js';

const ITER = () => SolverConfig.ITERATIONS || 500;

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
  const snap = new Map();
  if (joints) joints.forEach((j, id) => snap.set(id, { x: j.x, y: j.y }));

  c.value = val;
  if (shapeForRadius) shapeForRadius.radius = val;
  const result = engine.solve(ITER());
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

// Toggle a dimension between DRIVING and reference (FLIP). One driver per edge: when promoting a
// reference to driving, demote any other driver on the same edge/shapes (SWAP). When promoting, recompute
// the value from geometry and re-solve. Returns { nowDriving, swapped, error } (error = 'ERR-DRIVE-02'
// when the solve doesn't converge after promoting). No DOM, no notifications here.
export function toggleDriving(state, c) {
  let swapped = false;
  // If c is currently a reference (about to become driving), demote other same-edge/shape drivers.
  if (c.isDriven) {
    let others = [];
    if (c.type === CONSTRAINT_TYPES.DISTANCE) {
      if (c.isRadius && c.shape) {
        others = state.constraints.filter(oc =>
          oc !== c && !oc.isDriven && !oc.driven &&
          oc.type === CONSTRAINT_TYPES.DISTANCE && oc.isRadius && oc.shape === c.shape);
      } else if (c.joints && c.joints.length >= 2) {
        const [j1, j2] = c.joints;
        others = state.constraints.filter(oc =>
          oc !== c && !oc.isDriven && !oc.driven &&
          oc.type === CONSTRAINT_TYPES.DISTANCE && oc.joints && oc.joints.length >= 2 &&
          ((oc.joints[0] === j1 && oc.joints[1] === j2) || (oc.joints[0] === j2 && oc.joints[1] === j1)));
      }
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
      const [s1, s2] = c.shapes;
      others = state.constraints.filter(oc =>
        oc !== c && !oc.isDriven && !oc.driven &&
        oc.type === CONSTRAINT_TYPES.ANGLE && oc.shapes && oc.shapes.length === 2 &&
        ((oc.shapes[0] === s1 && oc.shapes[1] === s2) || (oc.shapes[0] === s2 && oc.shapes[1] === s1)));
    }
    if (others.length) { for (const oc of others) { oc.isDriven = true; oc.driven = true; } swapped = true; }

    // Generalize the swap to RANK-REDUNDANCY (not just same joint-pair): if promoting c would leave it
    // DETERMINED by other drivers — a redundant 2nd driver on a determined measurement, e.g. the opposite
    // edge of a dimensioned rect — demote the driver whose removal makes c carry new info, so c takes over
    // and its partner becomes a reference. Reuses the #6 rank helper. (Same-edge swap above is one case.)
    if (c.type === CONSTRAINT_TYPES.DISTANCE && state.engine && typeof state.engine.isDistanceRedundant === 'function') {
      const cand = { type: c.type, joints: c.joints ? [...c.joints] : undefined, value: c.value, isRadius: c.isRadius, shape: c.shape };
      if (state.engine.isDistanceRedundant(cand)) {
        const drivers = state.constraints.filter(d => d !== c && !d.isDriven && !d.driven && d.type === CONSTRAINT_TYPES.DISTANCE);
        for (const d of drivers) {
          d.isDriven = true; d.driven = true;                                  // tentatively demote
          if (!state.engine.isDistanceRedundant(cand)) { swapped = true; break; } // d determined c → keep demoted
          d.isDriven = false; d.driven = false;                               // not the determiner → restore
        }
      }
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
  return { nowDriving: !c.isDriven, swapped, error };
}
