import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';

// TASK 511 round 3: collinear / pointOnLine match Fusion 360 (measured on 2706.1.17, L1 (0,0)-(10,1), L2 (15,4)-(25,6)):
// the FIRST-picked line stays unless the second is held more (fixed, or H/V constrained); the other lands on the anchor's line.
// Never "meet in the middle".
const near = (a, b) => Math.abs(a - b) < 1e-6;
function setup(prep) {
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 10, 1), c = L.point(S, 15, 4), d = L.point(S, 25, 6);
  const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
  prep && prep(S, { a, b, c, d });
  return { S, a, b, c, d, l1, l2 };
}
const P = (S, id) => { const j = S.state.joints.get(id); return [j.x, j.y]; };
const onLine = (S, p, q, r) => { const [px, py] = P(S, p), [qx, qy] = P(S, q), [rx, ry] = P(S, r); return Math.abs((qx - px) * (ry - py) - (qy - py) * (rx - px)) / Math.hypot(qx - px, qy - py); };
function run(name, prep, order, stays) {
  const { S, a, b, c, d, l1, l2 } = setup(prep);
  const before = { a: P(S, a), b: P(S, b), c: P(S, c), d: P(S, d) };
  const shapes = order === 1 ? [l1, l2] : [l2, l1];
  const made = ConstraintManager.createConstraint(S.state, 'collinear', { shapes });
  assert.ok(made, name + ': refused');
  assert.ok(S.engine.solve(500).converged, name + ': not converged');
  const [sa, sb, mv1, mv2] = stays === 'L1' ? [a, b, c, d] : [c, d, a, b];
  for (const k of [sa, sb]) { const o = { a, b, c, d }; const key = Object.keys(o).find(q => o[q] === k); assert.ok(near(P(S, k)[0], before[key][0]) && near(P(S, k)[1], before[key][1]), `${name}: anchor joint ${key} moved ${before[key]} -> ${P(S, k)}`); }
  assert.ok(onLine(S, sa, sb, mv1) < 1e-6 && onLine(S, sa, sb, mv2) < 1e-6, `${name}: the other line is not on the anchor's line`);
}
run('both free, L1 first', null, 1, 'L1');
run('both free, L2 first', null, 2, 'L2');
run('L2 horizontal, L1 first', (S, j) => L.applyStep(S, { type: 'horizontal', joints: [j.c, j.d] }, {}), 1, 'L2');
run('L1 one end fixed, L1 first', (S, j) => { S.state.joints.get(j.a).fixed = true; }, 1, 'L1');
run('L1 length-dimensioned only, L1 first', (S, j) => L.applyStep(S, { type: 'distance', joints: [j.a, j.b], value: Math.hypot(10, 1), direct: true }, {}), 1, 'L1');
run('L2 fully fixed, L1 first', (S, j) => { S.state.joints.get(j.c).fixed = true; S.state.joints.get(j.d).fixed = true; }, 1, 'L2');

// pointOnLine: a free point on a free line: the LINE does not move, the point lands on it.
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 10, 1), p = L.point(S, 4, 5);
  const l = L.line(S, a, b);
  assert.ok(ConstraintManager.createConstraint(S.state, 'pointOnLine', { joint: p, shape: l }));
  S.engine.solve(500);
  assert.ok(near(P(S, a)[0], 0) && near(P(S, a)[1], 0) && near(P(S, b)[0], 10) && near(P(S, b)[1], 1), 'pointOnLine: the free line moved ' + P(S, a) + P(S, b));
  assert.ok(onLine(S, a, b, p) < 1e-6, 'pointOnLine: the point is not on the line');
}
// pointOnLine: a FIXED point on a free line: the line moves onto the point.
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 10, 1), p = L.point(S, 4, 5);
  S.state.joints.get(p).fixed = true;
  const l = L.line(S, a, b);
  assert.ok(ConstraintManager.createConstraint(S.state, 'pointOnLine', { joint: p, shape: l }));
  assert.ok(S.engine.solve(500).converged);
  assert.deepStrictEqual(P(S, p), [4, 5]);
  assert.ok(onLine(S, a, b, p) < 1e-6, 'pointOnLine (fixed point): the line did not move onto it');
}
console.log('collinear-fusion-anchor: 6 collinear cases and 2 pointOnLine cases passed.');
