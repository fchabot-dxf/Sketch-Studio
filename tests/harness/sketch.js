// Headless SOLVER/CONSTRAINT scenario harness — plays user-level operations against the
// REAL packages/core (engine + ConstraintManager + shape builders + the driving toggle),
// so solver bugs become reproducible Node scenarios instead of one-off screenshots.
//
// It also LOADS a serialized sketch (s.load) in the app's own model shape
// ({joints, shapes, constraints}) — the "read my window" bridge: a user hits Copy/export
// in the app, and the exact failing sketch replays here.
//
// NOTE: this is harness infrastructure, not a test. The scenarios that exercise it live in
// solver-scenarios.test.js. No fixes here — the harness only observes.

import { createEngine } from '#core/constraint-solver.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints } from '#core/shapes.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
// The harness drives the REAL app edit/toggle logic via shared headless seams (single source of truth).
import { commitDimensionEdit, toggleDriving } from '#app/ui/dimension-seams.js';

const ITER = SolverConfig.ITERATIONS || 500;

export function createSketch() {
  const engine = createEngine(null);
  engine.init();
  // ConstraintManager + constraints.addConstraint operate on a `state` object; the engine's
  // getters return the SAME underlying Map/arrays the solver reads, so this state IS the engine.
  const state = {
    joints: engine.getJoints(),
    shapes: engine.getShapes(),
    constraints: engine.getConstraints(),
    engine,
    genJ: engine.genJ,
  };

  let lastError = null;   // last notification message (core notifier + replicated toggle)
  let lastResult = null;  // last solve() result

  // Capture the core's notifications (the brain's notifier seam) so scenarios can read lastError.
  setConstraintNotifier((msg) => { lastError = msg; });

  const posOf = (id) => { const j = state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };
  const distOf = (a, b) => { const j1 = state.joints.get(a), j2 = state.joints.get(b); return Math.hypot(j2.x - j1.x, j2.y - j1.y); };

  function solve(iter = ITER) { lastResult = engine.solve(iter); return lastResult; }

  // ── builders ──────────────────────────────────────────────────────────────
  function point(x, y, fixed = false) { const id = engine.genJ(); engine.addJoint(id, x, y, fixed); return id; }

  function line(x1, y1, x2, y2) {
    const a = point(x1, y1), b = point(x2, y2);
    const id = 'L_' + a + '_' + b;
    engine.addShape({ id, type: 'line', joints: [a, b] });
    return { id, a, b };
  }

  // Real rectangle: makeRectFromTwoJoints (H/V/welds) routed through ConstraintManager,
  // exactly like rect-tool.js. Optionally pin the first corner.
  function rect(x, y, w, h, { pinFirst = true } = {}) {
    const c1 = point(x, y, pinFirst);
    const c3 = point(x + w, y + h, false);
    const built = makeRectFromTwoJoints(state.joints, c1, c3, engine.genJ);
    for (const s of built.shapes) engine.addShape(s);
    for (const c of built.constraints) ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' });
    const Hs = built.constraints.filter(c => c.type === CONSTRAINT_TYPES.HORIZONTAL);
    const c2 = Hs[0].joints[1];   // top edge [c1, c2]
    const c4 = Hs[1].joints[0];   // bottom edge [c4, c3]
    return { corners: [c1, c2, c3, c4], j1: c1, j3: c3, shapes: built.shapes };
  }

  // ── ops ───────────────────────────────────────────────────────────────────
  // Real distance dimension via ConstraintManager (handles redundant→reference, conflicting→refuse+revert).
  // Refresh lastResult afterwards so converged/conflicts reflect the post-add (possibly reverted) state;
  // lastError carries any refusal (captured from the core notifier).
  function dimension(a, b, value, opts = {}) {
    lastError = null;
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE,
      { joints: [a, b], value, dimMode: opts.dimMode || 'auto' }, { source: 'dimension' });
    lastResult = engine.solve(ITER);
    return findDistance(a, b);
  }

  function findDistance(a, b) {
    for (let i = state.constraints.length - 1; i >= 0; i--) {
      const c = state.constraints[i];
      if (c.type === CONSTRAINT_TYPES.DISTANCE && c.joints && c.joints.length >= 2 &&
        ((c.joints[0] === a && c.joints[1] === b) || (c.joints[0] === b && c.joints[1] === a))) return c;
    }
    return null;
  }
  // Count NON-driven (driving) distance constraints on edge [a,b].
  function drivingDistanceCount(a, b) {
    return state.constraints.filter(c => c.type === CONSTRAINT_TYPES.DISTANCE && !c.isDriven && !c.driven &&
      c.joints && c.joints.length >= 2 &&
      ((c.joints[0] === a && c.joints[1] === b) || (c.joints[0] === b && c.joints[1] === a))).length;
  }

  // Real drag: solve WITH a mouse-spring dragTarget (the path the UI uses).
  function drag(jointId, dx, dy) {
    const j = state.joints.get(jointId);
    const stiffness = (SolverConfig.DRAG_STRENGTH || 1) * 1e4;
    lastResult = engine.solve(ITER, { dragTarget: { jointId, x: j.x + dx, y: j.y + dy, stiffness } });
    return lastResult;
  }

  // Edit a dimension's value via the REAL edit seam (numeric-input-manager handleCommit calls the same
  // function): on a genuine over-constraint it refuses + reverts to the last valid shape.
  function editValue(dim, value) {
    lastError = null;
    const { reverted, clash } = commitDimensionEdit(state, dim, value);
    if (reverted) lastError = `Can't set to ${value}${clash ? ` — conflicts with ${clash}` : ''}. Reverted.`;
    lastResult = engine.solve(ITER); // refresh converged/conflicts
    return lastResult;
  }

  // Make a dimension a REFERENCE via the REAL toggle seam (flip only if it's currently driving).
  function setReference(dim) {
    if (dim && !dim.isDriven && !dim.driven) toggleDriving(state, dim);
    lastResult = engine.solve(ITER);
    return true;
  }

  // Make a dimension DRIVING via the REAL toggle seam (input-manager calls the same function): flips a
  // reference to driving with the one-driver-per-edge SWAP. No-op if it already drives.
  function setDriving(dim) {
    lastError = null;
    if (!dim) return false;
    if (dim.isDriven || dim.driven) {
      const res = toggleDriving(state, dim);
      if (res.error === 'ERR-DRIVE-02') lastError = '[ERR-DRIVE-02] solver did not converge after toggling driving';
    }
    lastResult = engine.solve(ITER);
    return true;
  }

  // ── load / serialize (the bridge) ───────────────────────────────────────────
  // Accepts the app model {joints, shapes, constraints} where joints is a Map, an object
  // {id:{x,y,fixed}}, an array of {id,x,y,fixed}, or an array of [id,{...}] pairs (JSON of a Map).
  function load(model) {
    engine.init();
    const jt = model.joints;
    const addJ = (id, o) => { if (id != null && o) engine.addJoint(id, o.x, o.y, !!o.fixed); };
    if (jt instanceof Map) { for (const [id, o] of jt) addJ(id, o); }
    else if (Array.isArray(jt)) { for (const e of jt) Array.isArray(e) ? addJ(e[0], e[1]) : addJ(e.id, e); }
    else if (jt && typeof jt === 'object') { for (const id of Object.keys(jt)) addJ(id, jt[id]); }
    for (const s of (model.shapes || [])) engine.addShape({ ...s, joints: s.joints ? [...s.joints] : [] });
    for (const c of (model.constraints || [])) engine.addConstraint({
      ...c,
      joints: c.joints ? [...c.joints] : undefined,
      shapes: c.shapes ? [...c.shapes] : undefined,
    });
    return true;
  }

  // App model shape (round-trips load()).
  function serialize() {
    return {
      joints: new Map(Array.from(state.joints.entries()).map(([k, v]) => [k, { ...v }])),
      shapes: state.shapes.map(s => ({ ...s, joints: s.joints ? [...s.joints] : [] })),
      constraints: state.constraints.map(c => ({ ...c })),
    };
  }

  // ── queries / asserts ───────────────────────────────────────────────────────
  // corners in order [c1,c2,c3,c4]: c1-c2 & c3-c4 horizontal, c2-c3 & c4-c1 vertical (within tol).
  function isRectangle(corners, tol = 0.05) {
    if (!corners || corners.length !== 4) return false;
    const p = corners.map(posOf);
    if (p.some(x => !x)) return false;
    const horiz = (a, b) => Math.abs(a.y - b.y) <= tol && Math.abs(a.x - b.x) > tol;
    const vert = (a, b) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) > tol;
    return horiz(p[0], p[1]) && vert(p[1], p[2]) && horiz(p[2], p[3]) && vert(p[3], p[0]);
  }

  return {
    point, line, rect,
    dimension, drag, editValue, setReference, setDriving, solve,
    load, serialize, findDistance, drivingDistanceCount,
    isRectangle, edgeLen: distOf, pos: posOf,
    isDriven: (dim) => !!(dim && (dim.isDriven || dim.driven)),
    get converged() { return lastResult ? lastResult.converged === true : null; },
    get rankDeficient() { return lastResult ? lastResult.rankDeficient === true : null; },
    get conflicts() { return lastResult ? (lastResult.conflicts || []) : []; },
    get lastError() { return lastError; },
    get constraintCount() { return state.constraints.length; },
    state, engine,
  };
}
