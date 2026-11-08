// tests/history-depth.test.js — TASK 466: the shared undo history is HISTORY_DEPTH (100) deep, was 5. 50 edits -> 50 undos in
// order; the redo stack still clears on a new edit; the oldest step drops past the depth; the large-sketch memory stays bounded.
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState, HISTORY_DEPTH } from '#ui/sketch-state.js';

const mk = () => { const engine = createEngine(); engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 }); };
const xOf = (st) => st.joints.get('j').x;

assert.strictEqual(HISTORY_DEPTH, 100, 'depth declared once');
{
  const st = mk();
  assert.strictEqual(st.maxHistory, HISTORY_DEPTH, 'the shared state uses the declared depth');
  st.joints.set('j', { x: 0, y: 0 });
  // 50 edits: x goes 0 -> 50, one saved step each
  for (let i = 1; i <= 50; i++) { st.saveState(); st.joints.get('j').x = i; }
  assert.strictEqual(st.history.length, 50, 'all 50 steps kept (the old cap of 5 would have kept 5)');
  for (let i = 49; i >= 0; i--) { st.undo(); assert.strictEqual(xOf(st), i, `undo restores step ${i}`); } // in order
  assert.strictEqual(st.canUndo(), false, 'all 50 undone');
  for (let i = 1; i <= 50; i++) { st.redo(); assert.strictEqual(xOf(st), i, `redo re-applies step ${i}`); }
  // a new edit clears the redo branch
  st.undo(); st.undo();
  assert.strictEqual(st.canRedo(), true);
  st.saveState(); st.joints.get('j').x = 999;
  assert.strictEqual(st.canRedo(), false, 'a new edit clears the redo stack');
}
{
  // past the depth the OLDEST step drops, the newest HISTORY_DEPTH are kept
  const st = mk();
  st.joints.set('j', { x: 0, y: 0 });
  for (let i = 1; i <= HISTORY_DEPTH + 25; i++) { st.saveState(); st.joints.get('j').x = i; }
  assert.strictEqual(st.history.length, HISTORY_DEPTH, 'capped at the declared depth');
  for (let k = 0; k < HISTORY_DEPTH; k++) st.undo();
  assert.strictEqual(xOf(st), 25, 'the 25 oldest steps were dropped; undo reaches exactly HISTORY_DEPTH steps back');
}
{
  // large sketch: ~2000 shapes, 4000 joints, 500 constraints. Measured heap/JSON ratio ~1.3 (WORK-LOG), so JSON bytes x depth
  // x 1.3 is the heap estimate; the bound is 100 MB.
  const st = mk();
  for (let i = 0; i < 2000; i++) {
    const a = 'ja' + i, b = 'jb' + i;
    st.joints.set(a, { x: (i % 50) * 10, y: Math.floor(i / 50) * 10 }); st.joints.set(b, { x: (i % 50) * 10 + 8, y: Math.floor(i / 50) * 10 + 3 });
    st.shapes.push({ id: 's' + i, type: 'line', joints: [a, b] });
    if (i % 4 === 0) st.constraints.push({ id: 'c' + i, type: 'horizontal', joints: [a, b] });
  }
  const snap = JSON.stringify(st._captureSnapshot(), (k, v) => (v instanceof Map ? [...v.entries()] : v)).length;
  const estimate = snap * HISTORY_DEPTH * 1.3;
  console.log(`large sketch: ${(snap / 1024).toFixed(0)} KB per snapshot, ~${(estimate / 1048576).toFixed(0)} MB at depth ${HISTORY_DEPTH}`);
  assert.ok(estimate < 100 * 1048576, `the large-sketch history stays under 100 MB (estimate ${(estimate / 1048576).toFixed(0)} MB)`);
}
console.log('history-depth: ok');
