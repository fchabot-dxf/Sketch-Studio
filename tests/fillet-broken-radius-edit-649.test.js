// TASK 649 (fillet audit, finding F4): a fillet arc that is no longer a whole fillet (one of its two lines deleted, its virtual sharp V
// deleted, or the arc copied and pasted alone) keeps an editable radius dimension: the edit is the plain arc radius edit. Before: the edit
// was refused and reverted with "fillet geometry is incomplete" (the fillet seed needs V and both legs).
import * as L from './harness/audit/lib.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { deleteShapes, deleteJoints } from '#core/delete-manager.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const J = (S, id) => S.state.joints.get(id);
const radiusOf = (S, arcId) => { const a = L.shape(S, arcId); const O = J(S, a.joints[0]); return [1, 2].map((k) => Math.hypot(J(S, a.joints[k]).x - O.x, J(S, a.joints[k]).y - O.y)); };

function filleted() {
  const S = L.newSketch();
  const c = L.point(S, 10, 10), a = L.point(S, 60, 10), b = L.point(S, 10, 40);
  const l1 = L.line(S, c, a), l2 = L.line(S, c, b);
  const fl = L.fillet(S, l1, l2, 8);
  S.engine.solve(L.ITER);
  return { S, fl, l1, l2 };
}
const editTo = (S, arcId, v, tag) => {
  const rd = S.state.constraints.find((k) => k.isRadius && k.shape === arcId);
  assert(rd, `${tag}: the radius dimension is still there`);
  const r = commitDimensionEdit(S.state, rd, v);
  assert(!r.reverted, `${tag}: R -> ${v} is accepted (${r.reason || r.clash || ''})`);
  const [r1, r2] = radiusOf(S, arcId);
  assert(Math.abs(r1 - v) < 1e-4 && Math.abs(r2 - v) < 1e-4, `${tag}: the arc radius is ${v}: ${r1} / ${r2}`);
};

// the intact fillet still goes through the fillet seed (V held at the sharp corner)
{
  const { S, fl } = filleted();
  editTo(S, fl.arc, 12, 'intact fillet');
  const V = J(S, fl.V);
  assert(Math.abs(V.x - 10) < 1e-6 && Math.abs(V.y - 10) < 1e-6, `intact fillet: V stays at the sharp corner (${V.x}, ${V.y})`);
}
// one of its lines deleted
{
  const { S, fl, l2 } = filleted();
  deleteShapes(S.state, [l2]);
  S.engine.solve(L.ITER);
  editTo(S, fl.arc, 12, 'one line deleted');
}
// its virtual sharp deleted (select the cross, Delete)
{
  const { S, fl } = filleted();
  deleteJoints(S.state, [fl.V]);
  S.engine.solve(L.ITER);
  editTo(S, fl.arc, 3, 'V deleted');
}
// the fillet arc copied and pasted alone
{
  const { S, fl } = filleted();
  S.state.selectedShapes = new Set([fl.arc]);
  const env = selectionToEnvelope(S.state);
  const before = S.state.shapes.length;
  assert(pasteDocument(S.state, env.document, { step: 2 }).ok, 'the arc pastes');
  const pasted = S.state.shapes.slice(before).find((s) => s.type === 'arc');
  assert(pasted, 'a pasted arc');
  S.engine.solve(L.ITER);
  editTo(S, pasted.id, 3, 'the fillet arc pasted alone');
}
console.log('fillet-broken-radius-edit-649.test.js: ok');
