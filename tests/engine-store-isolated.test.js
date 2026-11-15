// tests/engine-store-isolated.test.js - TASK 679: every engine owns its own store. Engine A holds a rectangle (in a sketch state);
// engine B is created after it and builds + solves a different shape. A's joints, shapes, constraints and solve result stay as they
// were, and solving A again gives the same geometry. (Before task 679 the joints / shapes / constraints were module-level in
// constraint-solver.js, so B's init() wiped A.)
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#core/sketch-state.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints } from '#core/shapes.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const snap = (state) => JSON.stringify({
  joints: [...state.joints.entries()],
  shapes: state.shapes,
  constraints: state.constraints,
});

// A: a 50 x 100 rectangle with its corner on the fixed origin, dimensioned.
const engineA = createEngine(null);
engineA.init();
const A = createSketchState(engineA, { x: 0, y: 0, w: 200, h: 200 });
const corner = engineA.genJ();
engineA.addJoint(corner, 50, 100, false);
const rect = makeRectFromTwoJoints(A.joints, 'j_origin', corner, engineA.genJ);
for (const s of rect.shapes) engineA.addShape(s);
for (const c of rect.constraints) ConstraintManager.createConstraint(A, c.type, c, { source: 'rect' });
const P = (st, id) => st.joints.get(id);
const lineAt = (f) => A.shapes.find(sh => sh.type === 'line' && f(P(A, sh.joints[0]), P(A, sh.joints[1])));
const top = lineAt((a, b) => Math.abs(a.y) < 1e-6 && Math.abs(b.y) < 1e-6);
const left = lineAt((a, b) => Math.abs(a.x) < 1e-6 && Math.abs(b.x) < 1e-6);
assert.ok(top && left, 'rectangle has a top and a left line');
ConstraintManager.createConstraint(A, CONSTRAINT_TYPES.DISTANCE, { joints: [...top.joints], value: 50 }, { source: 'dim' });
ConstraintManager.createConstraint(A, CONSTRAINT_TYPES.DISTANCE, { joints: [...left.joints], value: 100 }, { source: 'dim' });
const resA1 = engineA.solve(500);
assert.strictEqual(resA1.converged, true, 'A solves');
const beforeA = snap(A);
const statsA1 = JSON.stringify(engineA.getSolveStats());
console.log(`A: ${A.joints.size} joints, ${A.shapes.length} shapes, ${A.constraints.length} constraints, converged=${resA1.converged}`);

// B: created while A is open; init(), a triangle with one dimension, solved.
const engineB = createEngine(null);
engineB.init();
const B = createSketchState(engineB, { x: 0, y: 0, w: 200, h: 200 });
const t = [engineB.genJ(), engineB.genJ(), engineB.genJ()];
engineB.addJoint(t[0], 200, 200, false); engineB.addJoint(t[1], 260, 200, false); engineB.addJoint(t[2], 230, 250, false);
for (let i = 0; i < 3; i++) engineB.addShape({ id: 'tri_' + i, type: 'line', joints: [t[i], t[(i + 1) % 3]] });
ConstraintManager.createConstraint(B, CONSTRAINT_TYPES.DISTANCE, { joints: [t[0], t[1]], value: 40 }, { source: 'dim' });
const resB = engineB.solve(500);
console.log(`B: ${B.joints.size} joints, ${B.shapes.length} shapes, ${B.constraints.length} constraints, converged=${resB.converged}`);
assert.strictEqual(resB.converged, true, 'B solves');
assert.ok(Math.abs(Math.hypot(P(B, t[1]).x - P(B, t[0]).x, P(B, t[1]).y - P(B, t[0]).y) - 40) < 1e-3, 'B holds its dimension');

// A is untouched by B.
assert.notStrictEqual(engineA.getJoints(), engineB.getJoints(), 'A and B own different joints Maps');
assert.notStrictEqual(engineA.getShapes(), engineB.getShapes(), 'A and B own different shapes arrays');
assert.notStrictEqual(engineA.getConstraints(), engineB.getConstraints(), 'A and B own different constraints arrays');
assert.strictEqual(snap(A), beforeA, "A's joints, shapes and constraints are unchanged after B was built and solved");
assert.strictEqual(JSON.stringify(engineA.getSolveStats()), statsA1, "A's solve stats are unchanged by B's solve");
for (const id of t) assert.ok(!A.joints.has(id), 'none of B\'s joints is in A');

// Solving A again gives the same geometry and the same result.
const resA2 = engineA.solve(500);
assert.strictEqual(resA2.converged, resA1.converged, 'A converges the same');
assert.strictEqual(resA2.error, resA1.error, 'A reports the same residual');
for (const [id, j] of A.joints) {
  const was = JSON.parse(beforeA).joints.find(([k]) => k === id)[1];
  assert.ok(Math.abs(j.x - was.x) < 1e-9 && Math.abs(j.y - was.y) < 1e-9, `A joint ${id} keeps its place on a re-solve`);
}
console.log('engine-store-isolated: ok (A unchanged after B was built and solved; A re-solves to the same geometry)');
