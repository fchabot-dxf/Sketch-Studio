// TASK 649 (fillet audit, finding F2): after a line + arc fillet the ARC LEG stays a circle by its own structural equal (makeArc:
// centre-start = centre-end), which now joins its NEW rim (the tangent point), not the virtual sharp V. Before: the equal was taken for a
// "measurement" and re-linked to V, so (a) with the corner at the arc's END it duplicated V's point-on-arc row and left the tangent rim off
// the circle (it drifted when the far end moved), (b) deleting V (select the cross, Delete) removed the equal and the leg was no arc any more.
import * as L from './harness/audit/lib.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';
import { deleteJoints } from '#core/delete-manager.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const J = (S, id) => S.state.joints.get(id);

// a line meets an arc (centre (40,40), radius 42.4) at P (10,10); the corner at the arc's START or END rim
function build(atEnd) {
  const S = L.newSketch();
  const P = L.point(S, 10, 10), c = L.point(S, 40, 40), e = L.point(S, 40 + Math.hypot(30, 30), 40);
  const arcId = atEnd ? L.arc(S, c, e, P) : L.arc(S, c, P, e);
  L.line(S, L.point(S, -50, 10), P);
  S.engine.solve(L.ITER);
  const res = applyFillet(S.state, findCornerAtJoint(S.state, P), 5);
  assert(res && res.success, 'the fillet applies');
  S.engine.solve(L.ITER);
  const leg = L.shape(S, arcId);
  return { S, res, leg, rim: atEnd ? leg.joints[2] : leg.joints[1], far: atEnd ? leg.joints[1] : leg.joints[2] };
}
const radiusOf = (S, leg, j) => { const C = J(S, leg.joints[0]), p = J(S, j); return Math.hypot(p.x - C.x, p.y - C.y); };
const moveFar = (S, far, k) => { const f = J(S, far); f.x += 6; f.y += 9; f.fixed = true; S.engine.solve(L.ITER); f.fixed = false; void k; };

for (const atEnd of [false, true]) {
  const tag = atEnd ? 'corner at the arc END' : 'corner at the arc START';
  // the leg's equal joins its centre, its new rim and its far end
  {
    const { S, res, leg, rim, far } = build(atEnd);
    const eq = S.state.constraints.filter((k) => k.type === 'equal' && k.joints && k.joints[0] === leg.joints[0] && k.joints[2] === leg.joints[0]);
    assert(eq.length === 1, `${tag}: the leg arc keeps one structural equal`);
    assert(eq[0].joints.includes(rim) && eq[0].joints.includes(far) && !eq[0].joints.includes(res.virtualSharp), `${tag}: it joins the new rim and the far end, not V: ${eq[0].joints}`);
    // the far end moved 8 times: centre-rim stays centre-far (the arc stays a circle)
    let worst = 0;
    for (let k = 0; k < 8; k++) { moveFar(S, far, k); worst = Math.max(worst, Math.abs(radiusOf(S, leg, rim) - radiusOf(S, leg, far))); }
    // 1e-4, not 1e-6: the arc-to-fillet tangent at their SHARED rim is a double root for the solver (the queued N-F7), so the END case
    // converges to ~4e-6 here; before this fix the END case drifted 3.3e-3 (the tangent rim was off the circle)
    assert(worst < 1e-4, `${tag}: the leg stays a circle while its far end moves (worst ${worst})`);
  }
  // delete V: the leg is still an arc
  {
    const { S, res, leg, rim, far } = build(atEnd);
    deleteJoints(S.state, [res.virtualSharp]);
    assert(!S.state.joints.has(res.virtualSharp), `${tag}: V is deleted`);
    moveFar(S, far, 0);
    const d = Math.abs(radiusOf(S, leg, rim) - radiusOf(S, leg, far));
    assert(d < 1e-4, `${tag}: after deleting V the leg is still a circle when its far end moves (centre-rim ${radiusOf(S, leg, rim)} vs centre-far ${radiusOf(S, leg, far)})`);
  }
}
console.log('fillet-arc-leg-equal-649.test.js: ok');
