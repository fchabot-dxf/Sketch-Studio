import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

// TASK 511 (audit F3): an angle dimension on two lines must be satisfiable at the value it MEASURES whichever order the two lines
// were picked in (the solver's angle is signed CCW from line 1 to line 2; ConstraintManager.createConstraint orders the pair).
// Every pair of edges of a triangle, both orders: the dimension is accepted as DRIVING, no length changes, the interior angle is kept.
const PTS = [[0, 0], [100, 0], [40, 70]];
const len = (S, a, b) => Math.hypot(S.state.joints.get(b).x - S.state.joints.get(a).x, S.state.joints.get(b).y - S.state.joints.get(a).y);

let n = 0;
for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
  const interior = [];
  for (const swap of [false, true]) {
    const S = L.newSketch();
    const seg = L.polyline(S, PTS, true);
    S.engine.solve(500);
    const before = seg.map(s => len(S, s.a, s.b));
    const pair = swap ? [seg[j].id, seg[i].id] : [seg[i].id, seg[j].id];
    const value = L.measure(S, { type: 'angle', shapes: pair });
    const made = ConstraintManager.createConstraint(S.state, 'angle', { shapes: pair, value });
    const c = S.state.constraints.find(k => k.type === 'angle');
    const tag = `edges ${i},${j} ${swap ? 'swapped' : 'as picked'}`;
    assert.ok(made && c, `${tag}: angle refused`);
    assert.ok(!c.isDriven && !c.driven, `${tag}: angle became a reference (${c.drivenReason})`);
    assert.ok(S.engine.solve(500).converged, `${tag}: not converged`);
    seg.forEach((s, k) => assert.ok(Math.abs(len(S, s.a, s.b) - before[k]) < 1e-3, `${tag}: edge ${k} length ${before[k]} -> ${len(S, s.a, s.b)}`));
    assert.ok(measureResidual(c, S.state.joints, S.state.shapes) < 1e-6, `${tag}: residual`);
    interior.push(L.measure(S, { type: 'angle', shapes: pair }));
    n++;
  }
  assert.ok(Math.abs(interior[0] - interior[1]) < 1e-6, `edges ${i},${j}: the two orders measure different angles ${interior}`);
}

// A zero-length line has no angle: the verifier must not call it satisfied (else a collapsed solve counts as converged).
{
  const S = L.newSketch();
  const A = L.point(S, 0, 0), B = L.point(S, 0, 0), C = L.point(S, 0, 0), D = L.point(S, 10, 0);
  const l1 = L.line(S, A, B), l2 = L.line(S, C, D);
  assert.ok(measureResidual({ type: 'angle', shapes: [l1, l2], value: 60 }, S.state.joints, S.state.shapes) > 1, 'zero-length line counted as a satisfied angle');
}
console.log(`angle-dimension-order: ${n} order cases and the zero-length verifier case passed.`);
