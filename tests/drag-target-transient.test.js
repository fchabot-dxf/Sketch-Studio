// tests/drag-target-transient.test.js -- TASK 575 (node): a drag's solver target (joint.dragTarget / shape.dragTarget, the mouse spring every
// solve pulls toward while it exists) lives exactly as long as the drag. Replacing or clearing state.drag releases it (Esc, a touch hold,
// a new press after a lost release, clearing the document: every path, not only the select tool's pointer-up), and it is never part of
// the drawing: not saved (serializeDocument), not loaded back from a design stored during a drag (deserializeDocument), not in an undo
// snapshot. The live case (Esc then another drag, the owner's drawing) is tests/drag-target-release-live.test.js.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';

const S = L.newSketch(), st = S.state;
const a = L.point(S, 0, 0), b = L.point(S, 10, 0), c = L.point(S, 20, 5);
const line = L.line(S, a, b);
const T = { x: 3, y: 4 };
const targets = () => [...st.joints].filter(([, j]) => j.dragTarget).map(([id]) => id).concat(st.shapes.filter((s) => s.dragTarget).map((s) => s.id));

// 1. clearing the drag releases its joints' targets (what Esc / a touch hold / clearing the document do: state.drag = null)
st.drag = { type: 'cluster', jointIds: [a, b] };
st.joints.get(a).dragTarget = { ...T }; st.joints.get(b).dragTarget = { ...T }; st.joints.get(c).dragTarget = { ...T };
st.drag = null;
assert.deepStrictEqual(targets(), [c], 'clearing the drag releases the targets of ITS joints, and only those');
delete st.joints.get(c).dragTarget;

// 2. a new drag replacing one that never got its release (a lost pointer-up) releases the old one's targets; a body drag its shape's
st.drag = { type: 'line', jointIds: [a, b], body: { shape: line, param: 0.5 } };
L.shape(S, line).dragTarget = { param: 0.5, x: 1, y: 1 };
st.drag = { type: 'joint', jointIds: [c] };
assert.deepStrictEqual(targets(), [], 'a new drag releases the previous drag\'s body target');
st.joints.get(c).dragTarget = { ...T };
st.drag = st.drag; // the same drag set again keeps its targets
assert.deepStrictEqual(targets(), [c], 'setting the same drag again keeps its targets');

// 3. an undo snapshot taken while a target exists does not carry it (an undo or redo would put it back with no drag to release it)
L.shape(S, line).dragTarget = { param: 0.5, x: 1, y: 1 };
const snap = st._captureSnapshot();
assert.ok(![...snap.joints.values()].some((j) => 'dragTarget' in j), 'no joint of an undo snapshot carries a drag target');
assert.ok(!snap.shapes.some((s) => 'dragTarget' in s), 'no shape of an undo snapshot carries a drag target');
assert.strictEqual(st.joints.get(c).dragTarget.x, 3, 'the snapshot copies; the live drag keeps its target');

// 4. a save during the drag (the autosave polls every 1.5 s) writes no target; a design stored with one (by an older build) loads without it
const doc = serializeDocument(st);
assert.ok(!doc.geometry.joints.some(([, j]) => 'dragTarget' in j) && !doc.geometry.shapes.some((s) => 'dragTarget' in s), 'a saved document carries no drag target');
assert.strictEqual(doc.geometry.joints.find(([id]) => id === c)[1].x, 20, 'the joint itself is saved');
doc.geometry.joints.find(([id]) => id === c)[1].dragTarget = { ...T };
doc.geometry.shapes.find((s) => s.id === line).dragTarget = { param: 0.5, x: 1, y: 1 };
st.drag = null;
assert.strictEqual(deserializeDocument(doc, st).ok, true);
assert.deepStrictEqual(targets(), [], 'a loaded design carries no drag target');
assert.strictEqual(st.joints.get(c).x, 20, 'the loaded joint keeps its position');

console.log('drag-target-transient.test.js: ok');
