// TASK 649 (fillet audit, finding F1): a corner whose two curves SHARE one joint (a line drawn from the end of another line or arc reuses
// that joint) keeps each curve's own directional constraints on ITS curve after the fillet. Before: every constraint naming the shared
// corner joint was re-linked to the FIRST curve's tangent point, so the second line's Horizontal / Vertical held the wrong point and the
// line tilted by about the radius (live: a line drawn from an arc's end, Vertical, tilted after filleting that corner).
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const J = (S, id) => S.state.joints.get(id);

// both orders of the two lines in the document (the first one found at the corner is "line A")
for (const hFirst of [true, false]) {
  const tag = hFirst ? 'H line first' : 'V line first';
  const S = L.newSketch();
  const c = L.point(S, 10, 10), a = L.point(S, 60, 10), b = L.point(S, 10, 40);
  const lh = hFirst ? L.line(S, c, a) : null;
  const lv = L.line(S, b, c);
  const lh2 = hFirst ? lh : L.line(S, c, a);
  ConstraintManager.createConstraint(S.state, 'horizontal', { joints: [c, a] }, { source: 'line' });
  ConstraintManager.createConstraint(S.state, 'vertical', { joints: [b, c] }, { source: 'line' });
  S.engine.solve(L.ITER);
  const corner = findCornerAtJoint(S.state, c);
  assert(corner && corner.lineA.cornerJoint === corner.lineB.cornerJoint, `${tag}: the two lines share the corner joint`);
  const res = applyFillet(S.state, corner, 5);
  assert(res && res.success, `${tag}: the fillet applies`);
  const sr = S.engine.solve(L.ITER);
  assert(sr.converged !== false, `${tag}: converged`);
  const lineH = L.shape(S, lh2), lineV = L.shape(S, lv);
  const hc = S.state.constraints.find((k) => k.type === 'horizontal'), vc = S.state.constraints.find((k) => k.type === 'vertical');
  assert(hc.joints.every((j) => lineH.joints.includes(j)), `${tag}: the Horizontal constraint is on the horizontal line's joints: ${hc.joints} vs ${lineH.joints}`);
  assert(vc.joints.every((j) => lineV.joints.includes(j)), `${tag}: the Vertical constraint is on the vertical line's joints: ${vc.joints} vs ${lineV.joints}`);
  const h = lineH.joints.map((j) => J(S, j)), v = lineV.joints.map((j) => J(S, j));
  assert(Math.abs(h[1].y - h[0].y) < 1e-6, `${tag}: the horizontal line stays horizontal (dy ${h[1].y - h[0].y})`);
  assert(Math.abs(v[1].x - v[0].x) < 1e-6, `${tag}: the vertical line stays vertical (dx ${v[1].x - v[0].x})`);
  const O = J(S, res.joints[0]);
  assert(Math.abs(Math.abs(O.y - h[0].y) - 5) < 1e-6 && Math.abs(Math.abs(O.x - v[0].x) - 5) < 1e-6, `${tag}: the fillet centre is 5 from both lines`);
}

// a line drawn from an ARC's end (the live case): its Vertical stays on the line
{
  const S = L.newSketch();
  const P = L.point(S, 40, 10), cc = L.point(S, 40, 40), e = L.point(S, 70, 40);
  L.arc(S, cc, P, e); // the arc is first in the document: it is "curve A"; it leaves P horizontally
  const ln = L.line(S, P, L.point(S, 40, -20)); // the line goes straight down from the arc's end: a 90 degree corner
  ConstraintManager.createConstraint(S.state, 'vertical', { joints: [P, L.shape(S, ln).joints[1]] }, { source: 'line' });
  S.engine.solve(L.ITER);
  const corner = findCornerAtJoint(S.state, P);
  assert(corner && corner.lineA.shape.type === 'arc' && corner.lineA.cornerJoint === corner.lineB.cornerJoint, 'arc + line share the corner joint, the arc first');
  const res = applyFillet(S.state, corner, 4);
  assert(res && res.success, 'the line + arc fillet applies');
  S.engine.solve(L.ITER);
  const l = L.shape(S, ln).joints.map((j) => J(S, j));
  assert(Math.abs(l[1].x - l[0].x) < 1e-6, `the line drawn from the arc's end stays vertical (dx ${l[1].x - l[0].x})`);
}
console.log('fillet-shared-joint-649.test.js: ok');
