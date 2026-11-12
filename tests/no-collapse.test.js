// tests/no-collapse.test.js -- TASK 521: a constraint is never "satisfied" by collapsing a line (or arc / circle) to a point.
// Found by task 519 (fusion-oracle cell collinear|LL|6,4). Every case below is infeasible EXCEPT by collapsing a line; createConstraint must
// REFUSE it and leave every joint and the constraint list exactly as it was. Everything goes through the real ConstraintManager / dimension seam.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

const quiet = (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } };
const make = (S, type, params) => quiet(() => ConstraintManager.createConstraint(S.state, type, params, { source: 'test' }));
const len = (S, id) => { const [a, b] = L.shape(S, id).joints.map(j => S.state.joints.get(j)); return Math.hypot(b.x - a.x, b.y - a.y); };

// A: (20,26)-(80,26), horizontal, its first end fixed.  B: (95,50)-(150,62), its first end fixed.
function two({ aOrient = 'horizontal', bOrient = null } = {}) {
  const S = L.newSketch();
  const a1 = L.point(S, 20, 26), a2 = L.point(S, 80, 26), b1 = L.point(S, 95, 50), b2 = L.point(S, 150, 62);
  const A = L.line(S, a1, a2), B = L.line(S, b1, b2);
  S.state.joints.get(a1).fixed = true; S.state.joints.get(b1).fixed = true;
  if (aOrient) assert(make(S, aOrient, { joints: [a1, a2] }), 'setup: A ' + aOrient);
  if (bOrient) assert(make(S, bOrient, { joints: [b1, b2] }), 'setup: B ' + bOrient);
  return { S, a1, a2, b1, b2, A, B };
}

const CASES = {
  // the task-519 repro: A is H with one end fixed, B has one end fixed: collinear is impossible
  'collinear (A horizontal, one end fixed; B one end fixed)': (k) => ['collinear', { shapes: [k.A, k.B] }],
  // A horizontal and B vertical can only be parallel at zero length
  'parallel (A horizontal, B vertical)': (k) => ['parallel', { shapes: [k.A, k.B] }],
  // A horizontal and B horizontal can only be perpendicular at zero length
  'perpendicular (A horizontal, B horizontal)': (k) => ['perpendicular', { shapes: [k.A, k.B] }],
  // a line's own two ends cannot be coincident without collapsing it
  'coincident (the two ends of A)': (k) => ['coincident', { joints: [k.a1, k.a2] }],
  // a fixed point off B's (horizontal, one end fixed) line: only a zero-length B has no direction to miss
  'pointOnLine (fixed point off B, B horizontal one end fixed)': (k) => ['pointOnLine', { joint: k.a1, shape: k.B }],
  // the midpoint of B is its own fixed end only when B has no length
  'midpoint (B midpoint is its own fixed end)': (k) => ['midpoint', { joints: [k.b1, k.b2, k.b1] }],
};
const SETUP = { 'pointOnLine (fixed point off B, B horizontal one end fixed)': { bOrient: 'horizontal' }, 'parallel (A horizontal, B vertical)': { bOrient: 'vertical' }, 'perpendicular (A horizontal, B horizontal)': { bOrient: 'horizontal' } };

for (const [name, build] of Object.entries(CASES)) {
  const k = two(SETUP[name] || {});
  const before = L.snapshot(k.S), nBefore = k.S.state.constraints.length, lenA = len(k.S, k.A), lenB = len(k.S, k.B);
  const [type, params] = build(k);
  const res = make(k.S, type, params);
  assert.strictEqual(res, null, `${name}: refused (got ${res && res.type})`);
  assert.strictEqual(k.S.state.constraints.length, nBefore, `${name}: no constraint left behind`);
  assert(L.maxDeviation(k.S, before) < 1e-9, `${name}: every joint unchanged (moved ${L.maxDeviation(k.S, before)})`);
  assert(Math.abs(len(k.S, k.A) - lenA) < 1e-9 && Math.abs(len(k.S, k.B) - lenB) < 1e-9, `${name}: both lines keep their length`);
}

// The tolerance is not too tight: a feasible constraint on the same lines is still accepted and may change a length.
{
  const k = two({ aOrient: null });
  const res = make(k.S, 'horizontal', { joints: [k.b1, k.b2] });
  assert(res, 'a feasible horizontal on B is accepted');
  assert(len(k.S, k.B) > 1, 'and B keeps a real length');
}

// A DELIBERATE tiny / zero length is the user's own value and still works: a driving distance dimension on exactly the line's two ends.
{
  const k = two({ aOrient: null });
  const d = make(k.S, 'distance', { joints: [k.b1, k.b2], value: Math.hypot(55, 12) });
  assert(d && !L.isDriven(d), 'a driving length dimension on B is accepted');
  const er = quiet(() => commitDimensionEdit(k.S.state, d, 0.5));
  assert.strictEqual(er.reverted, false, 'typing a tiny length (0.5, a 99% shortening) is NOT treated as a collapse');
  assert(Math.abs(len(k.S, k.B) - 0.5) < 1e-3, 'B is now 0.5 long: ' + len(k.S, k.B));
}

// A dimension edit that makes ANOTHER constraint collapse a line is refused with the geometry restored: A and B tied equal-length,
// then B's length typed to ~0 (A, sized by nothing, would have to follow it down to a point).
{
  const k = two({ aOrient: null });
  assert(make(k.S, 'equal', { shapes: [k.A, k.B] }), 'setup: equal(A, B)');
  const d = make(k.S, 'distance', { joints: [k.b1, k.b2], value: len(k.S, k.B) });
  assert(d, 'setup: B length dimension');
  const before = L.snapshot(k.S), v0 = d.value;
  const er = quiet(() => commitDimensionEdit(k.S.state, d, 0.01));
  assert.strictEqual(er.reverted, true, 'typing 0.01 would collapse A (it must equal B): refused');
  assert(/collapse/.test(er.reason || ''), 'with a reason naming the collapse: ' + er.reason);
  assert.strictEqual(d.value, v0, 'the dimension keeps its old value');
  assert(L.maxDeviation(k.S, before) < 1e-6, 'geometry restored');
}

// CIRCLES (task 515: the radius is a solver unknown). A radius that legitimately changes a lot is no collapse; only a collapse toward zero is,
// and its refusal restores the RADII, not just the joints. A typed radius dimension is the user's own size (exempt), as for a line.
{
  const S = L.newSketch();
  const a = L.circle(S, 0, 50, 30), b = L.circle(S, 100, 50, 8);
  const da = make(S, 'distance', { shape: a.id, value: 30, isRadius: true });
  assert(da && !L.isDriven(da), 'setup: radius dimension on the big circle');
  assert(make(S, 'equal', { shapes: [a.id, b.id] }), 'equal(circle 30, circle 8) accepted: 8 -> 30 is no collapse');
  assert(Math.abs(L.shape(S, b.id).radius - 30) < 1e-4, 'the second circle grew to 30: ' + L.shape(S, b.id).radius);
  const er = quiet(() => commitDimensionEdit(S.state, da, 0.01));
  assert.strictEqual(er.reverted, true, 'typing 0.01 on the big circle would shrink the equal circle to a point: refused');
  assert(/collapse/.test(er.reason || ''), 'with the collapse reason: ' + er.reason);
  assert(Math.abs(L.shape(S, a.id).radius - 30) < 1e-6 && Math.abs(L.shape(S, b.id).radius - 30) < 1e-4, 'both RADII restored: ' + [a, b].map(x => L.shape(S, x.id).radius));
  const solo = L.newSketch(); const c = L.circle(solo, 0, 0, 10);
  const dc = make(solo, 'distance', { shape: c.id, value: 10, isRadius: true });
  const er2 = quiet(() => commitDimensionEdit(solo.state, dc, 0.05));
  assert.strictEqual(er2.reverted, false, 'a typed radius on the circle itself (10 -> 0.05) is the user own size: accepted');
}

console.log('no-collapse: ok');
