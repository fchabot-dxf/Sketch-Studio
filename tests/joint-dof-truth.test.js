import { readFileSync } from 'node:fs';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { deserializeDocument } from '#core/document.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

// TASK 496: the joint DOF the renderer reports (black fixed dot = 0) must be the GROUND TRUTH: the nullspace of the
// global constraint Jacobian (engine.jointFreedom), never a heuristic.
const doc = JSON.parse(readFileSync(new URL('./fixtures/owner-trapezoid.document.json', import.meta.url), 'utf8'));
const engine = createEngine(null); engine.init();
const state = createSketchState(engine, { x: 0, y: 0, w: 800, h: 800 });
state.saveState = () => {};
assert(deserializeDocument(doc, state).ok, 'fixture loads');
assert(engine.solve(500).converged, 'fixture converges');

const truth = engine.jointFreedom();
const status = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes, constraints: state.constraints });

// (1) every joint reported fully constrained (DOF 0 / black dot) is truly immovable
const lies = [];
for (const [id] of state.joints) {
  const reported = status.jointDOFs.get(id);
  if (reported === 0 && truth.freedom.get(id) > 0) lies.push(`${id} reported 0, true freedom ${truth.freedom.get(id)}`);
}
assert(lies.length === 0, 'joints reported DOF 0 that can actually move:\n  ' + lies.join('\n  '));

// (2) the reported DOF equals the truth for every joint, and in both directions fixedJoints agrees
for (const [id] of state.joints) {
  assert(status.jointDOFs.get(id) === truth.freedom.get(id), `${id}: reported ${status.jointDOFs.get(id)} != truth ${truth.freedom.get(id)}`);
  assert(status.fixedJoints.has(id) === (truth.freedom.get(id) === 0), `${id}: fixedJoints disagrees with truth`);
}

// (3) the sketch's global DOF equals the nullspace dimension
assert(status.dof === truth.nullity, `global DOF ${status.dof} != nullity ${truth.nullity}`);

// (4) physical cross-check of the truth itself: pinning an immovable joint 0.5 away from where it is must NOT
// be satisfiable; pinning a 2-DOF joint 0.5 away must be.
const pinResidual = (id, dx, dy) => {
  const saved = [...state.joints].map(([, j]) => [j, j.x, j.y, j.fixed]);
  const j = state.joints.get(id); j.x += dx; j.y += dy; j.fixed = true;
  const r = engine.solve(200);
  for (const [o, x, y, f] of saved) { o.x = x; o.y = y; o.fixed = f; }
  return r.error;
};
let checked0 = 0, checked2 = 0;
for (const [id] of state.joints) {
  const f = truth.freedom.get(id);
  if (f === 0 && id !== 'j_origin' && !state.joints.get(id).fixed) {
    for (const [dx, dy] of [[0.5, 0], [0, 0.5]]) assert(pinResidual(id, dx, dy) > 1e-3, `${id} is truth-immovable but could be pinned at (${dx},${dy})`);
    checked0++;
  } else if (f === 2) {
    assert(pinResidual(id, 0.5, 0.5) < 1e-3, `${id} is truth-2DOF but could not be moved`);
    checked2++;
  }
}
console.log(`joint-dof-truth: ${state.joints.size} joints, nullity ${truth.nullity}, immovable checked ${checked0}, 2-DOF checked ${checked2}`);

// (5) performance: nullspace on the fixture and on a 300-joint synthetic chain
const time = (fn, reps = 5) => { fn(); const t = performance.now(); for (let i = 0; i < reps; i++) fn(); return (performance.now() - t) / reps; };
console.log(`PERF fixture (${state.joints.size} joints): ${time(() => engine.jointFreedom()).toFixed(2)} ms`);
{
  const e = createEngine(null); e.init();
  const build = (from, to) => {
    for (let i = from; i < to; i++) e.addJoint('p' + i, (i % 20) * 10, Math.floor(i / 20) * 10 + (i % 3));
    for (let i = Math.max(1, from); i < to; i++) {
      if (i % 20) e.addConstraint({ id: 'h' + i, type: 'horizontal', joints: ['p' + (i - 1), 'p' + i] });
      e.addConstraint({ id: 'd' + i, type: 'distance', joints: ['p' + (i - 1), 'p' + i], value: 10 });
    }
  };
  e.addJoint('p0', 0, 0, true);
  for (const [from, to] of [[1, 100], [100, 300]]) {
    build(from, to);
    const ms = time(() => e.jointFreedom(), 3);
    console.log(`PERF synthetic (${to} joints): ${ms.toFixed(2)} ms, nullity ${e.jointFreedom().nullity}`);
  }
}
