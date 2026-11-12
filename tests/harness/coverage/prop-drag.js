// TASK 514 -- DRAG: the select tool's solver seam, headless. selection-tools.js handleSelectionPointerMove sets `joint.dragTarget`, clamps the step to
// SolverConfig.MAX_DRAG_STEP and calls engine.solve(SolverConfig.QUICK_SOLVE, { dragTarget }) once per pointer frame; pointer-up deletes the
// dragTarget (no final full solve). dragJoint() runs exactly those solver calls (the DOM hit-testing and the UI axis mask are not part of the
// solver: the mask is analyzeConstraintStatus, i.e. the panel DOF, which the I2 property and the drawings table already check).
import * as L from '../audit/lib.js';
import { SolverConfig } from '#core/solver-config.js';
import { buildDrawing } from './prop-lib.js';

export function dragJoint(S, id, dx, dy, frames = 5) {
  const j = S.state.joints.get(id), start = { x: j.x, y: j.y };
  for (let f = 1; f <= frames; f++) {
    let tx = start.x + dx * f / frames, ty = start.y + dy * f / frames;
    const sx = tx - j.x, sy = ty - j.y, step = Math.hypot(sx, sy), max = SolverConfig.MAX_DRAG_STEP;
    if (max > 0 && step > max) { tx = j.x + sx * max / step; ty = j.y + sy * max / step; }
    j.dragTarget = { x: tx, y: ty };
    S.engine.solve(SolverConfig.QUICK_SOLVE || 8, { dragTarget: { jointId: id, x: tx, y: ty, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 } });
  }
  delete j.dragTarget;
}

const freeJoints = (S) => L.freedom(S).free.map(f => f.id).filter(id => !S.state.joints.get(id).fixed && id !== L.origin);
const movableJoints = (S) => [...S.state.joints].filter(([id, j]) => !j.fixed && id !== L.origin && !j.isInternal).map(([id]) => id);

// the three drag properties on one drawing module; returns plain numbers for the test and the tables
export function dragProperties(mod, { dx = 6, dy = 4 } = {}) {
  const out = { name: mod.NAME };
  // (1) UNDER-constrained: the first half of the recipe. Every joint with freedom is dragged (from the same start each time).
  {
    const half = Math.max(1, Math.floor(mod.RECIPE.length / 2));
    const { S } = buildDrawing(mod, { steps: half });
    const ref = L.snapshot(S), ids = freeJoints(S);
    let worst = 0, worstId = null, nanCount = 0, moved = 0, settled = 0;
    for (const id of ids) {
      L.restore(S, ref); S.engine.solve(L.ITER);
      const p0 = { ...S.state.joints.get(id) };
      dragJoint(S, id, dx, dy);
      const r = L.residuals(S).max;
      if (!(r <= worst)) { worst = r; worstId = id; }
      if (L.hasNaN(S)) nanCount++;
      const j = S.state.joints.get(id); if (Math.hypot(j.x - p0.x, j.y - p0.y) > 1e-6) moved++;
      S.engine.solve(L.ITER); if (L.residuals(S).max < 1e-6) settled++;   // a full solve after the drag brings the sketch back to a valid state
    }
    Object.assign(out, { under: { steps: half, nullity: L.freedom(S).nullity, dragged: ids.length, moved, worstResidual: worst, worstJoint: worstId, nan: nanCount, settled } });
    L.restore(S, ref);
  }
  // (2) FULLY constrained: the whole recipe (nullity 0): spring-drag every joint, nothing may move.
  {
    const { S } = buildDrawing(mod);
    const full = L.nullity(S) === 0;
    const ref = L.snapshot(S);
    let worstMove = 0, worstJoint = null, worstResidual = 0;
    if (full) for (const id of movableJoints(S)) {
      L.restore(S, ref); S.engine.solve(L.ITER);
      dragJoint(S, id, dx, dy);
      const d = L.maxDeviation(S, ref); if (!(d <= worstMove)) { worstMove = d; worstJoint = id; }
      worstResidual = Math.max(worstResidual, L.residuals(S).max);
    }
    Object.assign(out, { full: { fullyConstrained: full, dragged: full ? movableJoints(S).length : 0, worstMove, worstJoint, worstResidual } });
  }
  // (3) LOCKED: lock one free joint of the under-constrained state, drag every other joint AND the locked one: it never moves.
  {
    const half = Math.max(1, Math.floor(mod.RECIPE.length / 2));
    const { S } = buildDrawing(mod, { steps: half });
    const ids = freeJoints(S);
    let worst = 0, tried = 0;
    if (ids.length > 1) {
      const lockId = ids[0];
      S.state.joints.get(lockId).fixed = true;   // toggleFixedSelection: j.fixed = true, then a solve
      S.engine.solve(L.ITER);
      const ref = L.snapshot(S), p = { ...S.state.joints.get(lockId) };
      for (const id of [...movableJoints(S), lockId]) {
        L.restore(S, ref); S.engine.solve(L.ITER);
        dragJoint(S, id, dx, dy); tried++;
        const j = S.state.joints.get(lockId); worst = Math.max(worst, Math.hypot(j.x - p.x, j.y - p.y));
      }
    }
    Object.assign(out, { locked: { tried, worstLockedMove: worst } });
  }
  return out;
}
