// tests/constraint-tool-undo.test.js -- TASK 571: every constraint the constraint tools create is ONE undo step owned by the tool (Fusion: one
// Undo removes one constraint). Through the real tool handler (handleConstraintPointerDown), for every tool in CONSTRAINT_TOOLS: after a
// drawn element (its own step), one constraint is made; one Undo removes ONLY the constraint and puts the positions back; Redo gives the
// identical document; a second Undo removes the drawn element. A refused constraint leaves no step.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { handleConstraintPointerDown, resetConstraintState } from '#ui/input-handlers/constraint-tools.js';
import { serializeDocument } from '#core/document.js';
import { TOOL_MODES, CONSTRAINT_TOOLS } from '#core/constants.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const pos = (st) => JSON.stringify([...st.joints].map(([k, j]) => [k, +j.x.toFixed(9), +j.y.toFixed(9)]).sort());
const doc = (st) => JSON.stringify(serializeDocument(st));

// each case: draw the geometry (returns the picks), then the picks are clicked as [jointId | null, shape | null]
const CASES = {
  [TOOL_MODES.HORIZONTAL_VERTICAL]: (S) => { const a = L.point(S, 0, 0), b = L.point(S, 40, 9); const l = L.line(S, a, b); return [[null, L.shape(S, l)]]; },
  [TOOL_MODES.PARALLEL]: (S) => { const l1 = L.line(S, L.point(S, 0, 0), L.point(S, 40, 5)), l2 = L.line(S, L.point(S, 0, 30), L.point(S, 30, 50)); return [[null, L.shape(S, l1)], [null, L.shape(S, l2)]]; },
  [TOOL_MODES.PERPENDICULAR]: (S) => { const l1 = L.line(S, L.point(S, 0, 0), L.point(S, 40, 5)), l2 = L.line(S, L.point(S, 0, 30), L.point(S, 30, 50)); return [[null, L.shape(S, l1)], [null, L.shape(S, l2)]]; },
  [TOOL_MODES.COINCIDENT]: (S) => { const a = L.point(S, 0, 0), b = L.point(S, 30, 20); L.line(S, a, L.point(S, 10, -40)); return [[a, null], [b, null]]; },
  [TOOL_MODES.COLLINEAR]: (S) => { const l1 = L.line(S, L.point(S, 0, 0), L.point(S, 40, 0)), l2 = L.line(S, L.point(S, 60, 14), L.point(S, 90, 25)); return [[null, L.shape(S, l1)], [null, L.shape(S, l2)]]; },
  [TOOL_MODES.TANGENT]: (S) => { const l = L.line(S, L.point(S, 0, 0), L.point(S, 80, 0)); const c = L.circle(S, 40, 25, 10); return [[null, L.shape(S, l)], [null, L.shape(S, c.id)]]; },
  [TOOL_MODES.EQUAL]: (S) => { const l1 = L.line(S, L.point(S, 0, 0), L.point(S, 40, 0)), l2 = L.line(S, L.point(S, 0, 30), L.point(S, 15, 60)); return [[null, L.shape(S, l1)], [null, L.shape(S, l2)]]; },
  [TOOL_MODES.MIDPOINT]: (S) => { const l = L.line(S, L.point(S, 0, 0), L.point(S, 40, 0)); const m = L.point(S, 28, 17); return [[null, L.shape(S, l)], [m, null]]; },
  [TOOL_MODES.SYMMETRIC]: (S) => { const p = L.point(S, 20, 15), q = L.point(S, 35, -40); const l = L.line(S, L.point(S, 0, -50), L.point(S, 3, 60)); return [[p, null], [q, null], [null, L.shape(S, l)]]; },
};
ok(CONSTRAINT_TOOLS.every(t => CASES[t]), 'a case for every tool in CONSTRAINT_TOOLS: ' + CONSTRAINT_TOOLS.join(','));

for (const tool of CONSTRAINT_TOOLS) {
  const S = L.newSketch(); const st = S.state;
  const before0 = captureEmpty(st);
  const picks = CASES[tool](S);
  st.saveStateForce('draw', before0);                       // the drawn element owns its step (task 549)
  const h0 = st.history.length;
  const posBefore = pos(st), nBefore = st.constraints.length;
  st.currentTool = tool; resetConstraintState(st);
  picks.forEach(([j, shape], i) => {
    const n = st.history.length;
    handleConstraintPointerDown(null, null, st, j ? { id: j, j: st.joints.get(j) } : null, shape ? { shape } : null, null);
    if (i < picks.length - 1) ok(st.history.length === n, `${tool}: pick ${i + 1} (no constraint yet) makes no step`);
  });
  ok(st.constraints.length === nBefore + 1, `${tool}: one constraint made (${nBefore} -> ${st.constraints.length})`);
  ok(st.history.length === h0 + 1, `${tool}: ONE undo step (${h0} -> ${st.history.length})`);
  const posAfter = pos(st), docAfter = doc(st);
  st.undo();
  ok(st.constraints.length === nBefore, `${tool}: Undo removes the constraint`);
  ok(pos(st) === posBefore, `${tool}: Undo puts the positions back`);
  ok(st.shapes.length > 0, `${tool}: Undo left the drawn element`);
  st.redo();
  ok(doc(st) === docAfter && pos(st) === posAfter, `${tool}: Redo gives the identical document`);
  st.undo(); st.undo();
  ok(st.shapes.length === 0 && st.constraints.length === 0, `${tool}: a second Undo removes the drawn element`);
}

// a refused constraint leaves no step: the same coincident twice (a duplicate)
{
  const S = L.newSketch(); const st = S.state;
  const a = L.point(S, 0, 0), b = L.point(S, 30, 20); L.line(S, a, b);
  st.currentTool = TOOL_MODES.COINCIDENT; resetConstraintState(st);
  const hit = (id) => ({ id, j: st.joints.get(id) });
  handleConstraintPointerDown(null, null, st, hit(a), null, null); handleConstraintPointerDown(null, null, st, hit(b), null, null);
  const h = st.history.length, n = st.constraints.length;
  handleConstraintPointerDown(null, null, st, hit(a), null, null); handleConstraintPointerDown(null, null, st, hit(b), null, null);
  ok(st.constraints.length === n && st.history.length === h, 'a refused (duplicate) constraint leaves no undo step');
}
console.log(`constraint-tool-undo: ok (${checks} checks)`);

function captureEmpty(st) { return st.captureUndoSnapshot(); }
