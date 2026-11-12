// tests/dimension-determined.test.js -- TASK 516: ONE rule for every dimension mode. A dimension whose quantity the other DRIVING constraints already
// determine (isDimensionDetermined, the engine rank test) cannot be made driving (toggleDriving refuses, nothing changes); once the rest no longer
// determines it, it becomes driving at its current value. Not-determined dimensions are unaffected.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { isDimensionDetermined, toggleDriving } from '#ui/dimension-seams.js';

// a 100 x 60 rectangle, bottom-left corner locked, width and height driven: fully constrained
function square() {
  const S = L.newSketch();
  const r = L.rect(S, 0, 0, 100, 60);
  const J = (id) => S.state.joints.get(id);
  const corners = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
  const pos = (id) => J(id);
  const bl = corners.find((id) => pos(id).x === 0 && pos(id).y === 0), br = corners.find((id) => pos(id).x === 100 && pos(id).y === 0), tr = corners.find((id) => pos(id).x === 100 && pos(id).y === 60), tl = corners.find((id) => pos(id).x === 0 && pos(id).y === 60);
  J(bl).fixed = true;
  const dim = (type, p, extra = {}) => ConstraintManager.createConstraint(S.state, type, { ...p, ...extra }, { source: 'audit' });
  const width = dim('distance', { joints: [bl, br], value: 100, dimMode: 'horizontal' });
  const height = dim('distance', { joints: [br, tr], value: 60, dimMode: 'vertical' });
  S.engine.solve(L.ITER);
  return { S, r, bl, br, tr, tl, width, height, dim };
}
const refuses = (k, c, what) => {
  const before = JSON.stringify([c.isDriven, k.S.state.constraints.map((x) => !!(x.isDriven || x.driven))]);
  assert.strictEqual(isDimensionDetermined(k.S.state, c), true, what + ': the rest of the sketch determines it');
  const res = toggleDriving(k.S.state, c);
  assert.strictEqual(res.refused, true, what + ': Driving is refused');
  assert.strictEqual(JSON.stringify([c.isDriven, k.S.state.constraints.map((x) => !!(x.isDriven || x.driven))]), before, what + ': nothing changed');
};

{ // aligned, horizontal and vertical dimensions of the diagonal
  for (const mode of ['aligned', 'horizontal', 'vertical']) {
    const k = square();
    const d = k.dim('distance', { joints: [k.bl, k.tr], value: mode === 'horizontal' ? 100 : mode === 'vertical' ? 60 : Math.hypot(100, 60), dimMode: mode, isDriven: true, driven: true });
    assert(d && L.isDriven(d), mode + ': the dimension exists as a reference');
    refuses(k, d, mode + ' diagonal');
  }
}
{ // angle between two sides
  const k = square();
  const d = k.dim('angle', { shapes: [k.r.top, k.r.right], value: 90, isDriven: true, driven: true });
  assert(d && L.isDriven(d), 'angle reference exists');
  refuses(k, d, 'angle of two sides');
}
{ // point-to-line: the top-right corner to the left side (three joints, one distance)
  const k = square();
  const left = L.shape(k.S, k.r.left);
  const d = k.dim('distance', { joints: [k.tr, left.joints[0], left.joints[1]], value: 100, isDriven: true, driven: true });
  assert(d && L.isDriven(d), 'point-to-line reference exists');
  refuses(k, d, 'point-to-line');
}
{ // line-to-line: top side to bottom side
  const k = square();
  const d = k.dim('distance', { shapes: [k.r.top, k.r.bottom], value: 60, isDriven: true, driven: true });
  assert(d && L.isDriven(d), 'line-to-line reference exists');
  refuses(k, d, 'line-to-line');
}
{ // the diagonal: refused while determined; after the height dimension is deleted it is no longer determined and becomes driving at its value
  const k = square();
  const d = k.dim('distance', { joints: [k.bl, k.tr], value: Math.hypot(100, 60), dimMode: 'aligned', isDriven: true, driven: true });
  refuses(k, d, 'diagonal');
  deleteConstraints(k.S.state, [k.height]);
  k.S.engine.solve(L.ITER);
  assert.strictEqual(isDimensionDetermined(k.S.state, d), false, 'after deleting the height dimension the diagonal is no longer determined');
  const res = toggleDriving(k.S.state, d);
  assert(res.nowDriving === true && !res.refused && !L.isDriven(d), 'Driving now works');
  assert(Math.abs(d.value - Math.hypot(100, 60)) < 1e-6, 'it drives at its current value: ' + d.value);
}
{ // a dimension that is NOT determined is untouched: the height of the square before it is dimensioned
  const S = L.newSketch(); const r = L.rect(S, 0, 0, 100, 60);
  const corners = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
  const bl = corners.find((id) => S.state.joints.get(id).x === 0 && S.state.joints.get(id).y === 0), br = corners.find((id) => S.state.joints.get(id).x === 100 && S.state.joints.get(id).y === 0);
  S.state.joints.get(bl).fixed = true;
  const w = ConstraintManager.createConstraint(S.state, 'distance', { joints: [bl, br], value: 100, dimMode: 'horizontal' }, { source: 'audit' });
  assert.strictEqual(isDimensionDetermined(S.state, w), false, 'a driving width on a free rectangle is not determined (it drives)');
  const ref = ConstraintManager.createConstraint(S.state, 'distance', { shapes: [r.top, r.bottom], value: 60, isDriven: true, driven: true }, { source: 'audit' });
  assert.strictEqual(isDimensionDetermined(S.state, ref), false, 'the free height is not determined');
  const res = toggleDriving(S.state, ref);
  assert(res.nowDriving === true && !res.refused, 'Driving on an undetermined reference works');
}
{ // the SAFETY NET: a conflict the rank test cannot see (a nonlinear one: a diagonal of 50 against a fixed width of 100) is not caught at placement,
  // so a dimension CREATED with such a preset value (not the pointer path, which always places at the measured value) is still demoted to a
  // reference by ConstraintManager.createConstraint (sandbox-conflict). A TYPED value on a driving dimension never demotes: commitDimensionEdit reverts.
  const k = square();
  deleteConstraints(k.S.state, [k.height]); k.S.engine.solve(L.ITER);   // only the width remains
  const probe = { type: 'distance', joints: [k.bl, k.tr], value: 50, dimMode: 'aligned' };
  assert.strictEqual(k.S.engine.isDistanceRedundant(probe), false, 'the rank test does not see this conflict');
  const made = ConstraintManager.createConstraint(k.S.state, 'distance', probe, { source: 'audit' });
  assert(made && L.isDriven(made) && /sandbox-conflict/.test(made.drivenReason), 'the safety net still demotes it: ' + (made && made.drivenReason));
}
console.log('dimension-determined: ok');
