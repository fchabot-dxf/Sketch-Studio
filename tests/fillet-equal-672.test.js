// tests/fillet-equal-672.test.js -- TASK 672: applyFillet's `equalTo` option (Fusion, owner turn 1739: several corners filleted in ONE Fillet
// command get ONE radius dimension, on the first fillet, and an EQUAL constraint on each later fillet arc). Through the harness's tool-faithful
// rect (the Rect tool's makeRectFromTwoJoints + createConstraint) and the Fillet tool's findCornerBetweenLines + applyFillet:
//   1. without the option: unchanged, each fillet its own driving radius dimension, no equal;
//   2. with it: corner 1 a normal fillet (its radius dimension), corners 2..4 `equalTo` corner 1's arc: ONE radius dimension, THREE equal
//      constraints (arc, arc), every arc the same radius; editing the one radius moves all four; with the rect's width / height dimensioned and
//      the corner anchored, 0 DOF;
//   3. a refused option (not an arc of the sketch) changes nothing.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { findCornerBetweenLines, applyFillet } from '#core/fillet.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

const muted = (f) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };
const arcRadius = (S, a) => { const [c, r] = a.joints.map((id) => S.state.joints.get(id)); return Math.hypot(r.x - c.x, r.y - c.y); };
const roundedRect = (session) => {
  const S = L.newSketch();
  const R = L.rect(S, 0, 0, 60, -40); // world: top-left (0, 0), bottom-right (60, -40)
  ConstraintManager.createConstraint(S.state, 'coincident', { joints: [R.c1, L.origin] }, { source: 'coincident' });
  const sh = (id) => L.shape(S, id);
  ConstraintManager.createConstraint(S.state, 'distance', { joints: sh(R.top).joints.slice(), value: 60, dimMode: 'horizontal' }, { source: 'dimension' });
  ConstraintManager.createConstraint(S.state, 'distance', { joints: sh(R.left).joints.slice(), value: 40, dimMode: 'vertical' }, { source: 'dimension' });
  const corners = [[R.top, R.right], [R.right, R.bottom], [R.bottom, R.left], [R.left, R.top]];
  let first = null;
  const results = corners.map(([a, b]) => {
    const res = muted(() => applyFillet(S.state, findCornerBetweenLines(S.state, sh(a), sh(b)), 5, session && first ? { equalTo: first } : {}));
    assert.ok(res && res.success, 'fillet applies: ' + (res && res.reason));
    first = first || res.arc.id;
    return res;
  });
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], '0 conflicts');
  return { S, results };
};

// ---- 1. without the option: unchanged
{
  const { S, results } = roundedRect(false);
  assert.strictEqual(S.state.constraints.filter((c) => c.type === 'distance' && c.isRadius).length, 4, 'no option: four radius dimensions, one per fillet');
  assert.strictEqual(S.state.constraints.filter((c) => c.type === 'equal' && c.shapes && c.shapes.every((id) => L.shape(S, id).type === 'arc')).length, 0, 'no option: no equal between arcs');
  assert.ok(results.every((r) => r.radiusConstraint && !r.equalConstraint), 'no option: each result carries its radius dimension');
  assert.strictEqual(L.nullity(S), 0, 'no option: 0 DOF (four radius dimensions)');
}
// ---- 2. a session: one radius dimension + three equals
{
  const { S, results } = roundedRect(true);
  const radiusDims = S.state.constraints.filter((c) => c.type === 'distance' && c.isRadius);
  assert.strictEqual(radiusDims.length, 1, 'session: ONE radius dimension');
  assert.strictEqual(radiusDims[0].shape, results[0].arc.id, 'session: on the first fillet');
  const equals = S.state.constraints.filter((c) => c.type === 'equal' && c.shapes && c.shapes.every((id) => L.shape(S, id).type === 'arc'));
  assert.strictEqual(equals.length, 3, 'session: three equal constraints');
  equals.forEach((c, i) => assert.deepStrictEqual(c.shapes, [results[0].arc.id, results[i + 1].arc.id], `session: equal ${i} = first arc, fillet ${i + 2}'s arc`));
  assert.ok(results.slice(1).every((r) => r.radiusConstraint === null && r.equalConstraint === equals[results.indexOf(r) - 1]), 'session: the later results carry their equal, no radius dimension');
  const arcs = S.state.shapes.filter((s) => s.type === 'arc');
  assert.strictEqual(arcs.length, 4, 'four fillet arcs');
  arcs.forEach((a) => assert.ok(Math.abs(arcRadius(S, a) - 5) < 1e-6, 'every arc R5'));
  assert.strictEqual(L.nullity(S), 0, 'session: 0 DOF (one radius dimension + three equals)');
  const res = muted(() => commitDimensionEdit(S.state, radiusDims[0], 8));
  assert.ok(!res.reverted, 'the one radius takes 8');
  muted(() => S.engine.solve(L.ITER));
  arcs.forEach((a) => assert.ok(Math.abs(arcRadius(S, a) - 8) < 1e-5, 'every arc follows: R8 (' + arcRadius(S, a) + ')'));
  assert.strictEqual(L.nullity(S), 0, 'session: still 0 DOF');
}
// ---- 3. a refused option changes nothing
{
  const S = L.newSketch();
  const R = L.rect(S, 0, 0, 60, -40);
  const before = JSON.stringify([...S.state.joints, S.state.shapes, S.state.constraints]);
  const res = applyFillet(S.state, findCornerBetweenLines(S.state, L.shape(S, R.top), L.shape(S, R.right)), 5, { equalTo: R.left });
  assert.deepStrictEqual(res, { success: false, reason: 'The fillet to match is not an arc of this sketch' }, 'equalTo a line: refused');
  assert.strictEqual(JSON.stringify([...S.state.joints, S.state.shapes, S.state.constraints]), before, 'refused: nothing changed');
}
console.log('fillet-equal-672: ok');
