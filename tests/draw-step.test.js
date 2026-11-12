// tests/draw-step.test.js - TASK 549: ONE drawn element = ONE undo step (the shared draw step in sketch-state.js + the line tool's chain).
// Real sketch state + the real line / rect / circle handlers, no DOM. Undo and Redo restore the document EXACTLY (deep compare).
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { TOOL_MODES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { handleLinePointerDown, handleLinePointerUp } from '#ui/input-handlers/line-tool.js';
import { deactivateLineTool } from '#ui/input-handlers/line-tool.js';

const mk = () => { const e = createEngine(null); const s = createSketchState(e, { x: 0, y: 0, w: 20, h: 20 }); s.shapes.length = 0; s.constraints.length = 0; for (const k of [...s.joints.keys()]) if (k !== 'j_origin') s.joints.delete(k); s.history.length = 0; s.currentTool = TOOL_MODES.LINE; return s; }; // the shared store is module-level: start each case clean
const doc = (s) => JSON.stringify({
  j: [...s.joints.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  s: s.shapes, c: s.constraints.map((c) => JSON.stringify(c)).sort(),
});
const orphans = (s) => { const used = new Set(); for (const sh of s.shapes) for (const j of sh.joints || []) used.add(j); return [...s.joints.keys()].filter((j) => j !== 'j_origin' && !used.has(j)); };
const ev = (x, y) => ({ clientX: x * 10, clientY: y * 10, pointerId: 1, pointerType: 'mouse', button: 0 });
// a click at world (x, y): pointer down + up (the line tool's own handlers; `snap` = an existing joint to start / end on)
const click = (s, x, y, snap = null) => {
  handleLinePointerDown(ev(x, y), null, s, snap, { x, y });
  handleLinePointerUp(ev(x, y), null, s, snap, { x, y }, false);
};
const onJoint = (s, id) => { const j = s.joints.get(id); return { type: 'joint', targetId: id, pt: { x: j.x, y: j.y }, isLocked: true }; };
const lines = (s) => s.shapes.filter((x) => x.type === 'line').length;
const finish = (s) => { deactivateLineTool(s); s.closeDrawStep(); }; // Esc / Enter

// ---- 1. the state's draw step ----
{
  const s = mk();
  const before = doc(s);
  s.beginDrawStep('thing');
  s.joints.set('ja', { x: 1, y: 1 }); s.joints.set('jb', { x: 2, y: 2 });
  s.shapes.push({ id: 's1', type: 'line', joints: ['ja', 'jb'] });
  s.endUndoGroup();
  assert.strictEqual(s.history.length, 1, 'one element = one step');
  assert.strictEqual(s.history[0].label, 'thing', 'the step is labelled');
  const after = doc(s);
  s.undo(); assert.strictEqual(doc(s), before, 'Undo restores the pre-draw document exactly');
  s.redo(); assert.strictEqual(doc(s), after, 'Redo restores the drawn element exactly');
}
{
  const s = mk();
  const before = doc(s);
  s.beginDrawStep();
  s.joints.set('ja', { x: 1, y: 1 }); // the first click made a start joint, nothing committed
  assert.strictEqual(s.closeDrawStep(), 'cancelled');
  assert.strictEqual(doc(s), before, 'a cancelled draw leaves the document exactly as it was');
  assert.strictEqual(s.history.length, 0, 'a cancelled draw leaves no undo step');
  assert.strictEqual(s.isUndoGroupOpen(), false);
  assert.strictEqual(s.closeDrawStep(), 'none', 'closing twice is harmless');
}
{
  const s = mk();
  s.beginDrawStep(); s.joints.set('ja', { x: 1, y: 1 }); s.joints.set('jb', { x: 2, y: 2 });
  s.shapes.push({ id: 's1', type: 'line', joints: ['ja', 'jb'] });
  assert.strictEqual(s.closeDrawStep(), 'kept', 'something was committed: the step is kept');
  assert.strictEqual(s.history.length, 1);
  assert.strictEqual(s.isUndoGroupOpen(), false);
}
{
  const s = mk();
  const before = doc(s);
  s.beginDrawStep(); s.joints.set('ja', { x: 1, y: 1 });
  s.undo(); // Undo in the middle of a draw cancels THAT draw only
  assert.strictEqual(doc(s), before); assert.strictEqual(s.history.length, 0); assert.strictEqual(s.isUndoGroupOpen(), false);
  const s2 = mk();
  s2.saveState('earlier'); s2.joints.set('jx', { x: 5, y: 5 });
  s2.beginDrawStep(); s2.joints.set('ja', { x: 1, y: 1 });
  s2.undo();
  assert.ok(s2.joints.has('jx'), 'Undo mid-draw cancels the draw, not the previous element'); assert.ok(!s2.joints.has('ja'));
  assert.strictEqual(s2.history.length, 1);
}
{
  const s = mk(); // a group that is NOT a draw (a dimension edit, a delete) is never cancelled by a tool switch
  s.beginUndoGroup('edit'); s.joints.set('ja', { x: 1, y: 1 });
  assert.strictEqual(s.closeDrawStep(), 'none'); assert.ok(s.joints.has('ja')); assert.strictEqual(s.isUndoGroupOpen(), true);
  s.endUndoGroup();
}
{
  const s = mk(); // a step that starts from a snapshot captured EARLIER
  s.joints.set('jk', { x: 3, y: 3 });
  const early = s.captureUndoSnapshot();
  s.joints.set('jfloat', { x: 4, y: 4 }); // made after the snapshot, before the element's first click
  s.beginDrawStep('line', early); s.shapes.push({ id: 's9', type: 'line', joints: ['jk', 'jfloat'] }); s.endUndoGroup();
  s.undo();
  assert.ok(s.joints.has('jk') && !s.joints.has('jfloat') && s.shapes.length === 0, 'Undo goes back to the captured snapshot');
}

// ---- 2. one line, and a chain of three, with the real line tool ----
for (const granularity of ['per-segment', 'per-tool-session']) {
  SettingsManager.set('LINE_CHAIN_UNDO', granularity, { persist: 'none' });
  const s = mk();
  const pre = doc(s);
  click(s, 10, 10); click(s, 30, 10); click(s, 30, 30); click(s, 10, 30); // start, then three committed segments
  finish(s);
  assert.strictEqual(lines(s), 3, granularity + ': three lines drawn');
  assert.deepStrictEqual(orphans(s), [], granularity + ': a finished chain has no loose point');
  const drawn = doc(s);
  const stepsAfterChain = s.history.length;
  if (granularity === 'per-segment') {
    assert.strictEqual(stepsAfterChain, 3, 'per-segment: each committed segment is its own step');
    for (const left of [2, 1, 0]) {
      s.undo();
      assert.strictEqual(lines(s), left, 'per-segment: one Ctrl+Z removes exactly one line');
      assert.deepStrictEqual(orphans(s), [], 'per-segment: no orphan joint after the undo leaving ' + left + ' lines');
    }
    assert.strictEqual(doc(s), pre, 'per-segment: the third Undo restores the pre-chain document exactly');
    s.redo(); s.redo(); s.redo();
    assert.strictEqual(doc(s), drawn, 'per-segment: three Redos restore the chain exactly');
  } else {
    assert.strictEqual(stepsAfterChain, 1, 'per-tool-session: the whole chain is ONE step');
    s.undo();
    assert.strictEqual(doc(s), pre, 'per-tool-session: ONE Undo removes all three lines and their new points');
    s.redo();
    assert.strictEqual(doc(s), drawn, 'per-tool-session: ONE Redo restores the chain exactly');
  }
}
SettingsManager.set('LINE_CHAIN_UNDO', 'per-segment', { persist: 'none' });

// ---- 3. drawing onto an existing point, then undoing, keeps that point and its constraints ----
for (const granularity of ['per-segment', 'per-tool-session']) {
  SettingsManager.set('LINE_CHAIN_UNDO', granularity, { persist: 'none' });
  const s = mk();
  click(s, 10, 10); click(s, 30, 10); finish(s); // an existing line
  const endId = s.shapes[0].joints[1];
  const pre = doc(s);
  const stepsPre = s.history.length;
  click(s, 30, 10, onJoint(s, endId)); click(s, 30, 30); finish(s); // a new line starting ON that point
  assert.strictEqual(lines(s), 2);
  assert.strictEqual(s.history.length, stepsPre + 1, granularity + ': the new line is one step');
  s.undo();
  assert.strictEqual(doc(s), pre, granularity + ': undo removes the new line and keeps the existing point and its constraints');
  assert.ok(s.joints.has(endId));
}

// ---- 4. Esc mid-draw: nothing left, no step ----
for (const granularity of ['per-segment', 'per-tool-session']) {
  SettingsManager.set('LINE_CHAIN_UNDO', granularity, { persist: 'none' });
  const s = mk();
  click(s, 10, 10); click(s, 30, 10); finish(s);
  const pre = doc(s); const steps = s.history.length;
  handleLinePointerDown(ev(50, 50), null, s, null, { x: 50, y: 50 }); handleLinePointerUp(ev(50, 50), null, s, null, { x: 50, y: 50 }, false); // first click only
  finish(s);
  assert.strictEqual(doc(s), pre, granularity + ': Esc after the first click leaves nothing (no loose start point)');
  assert.strictEqual(s.history.length, steps, granularity + ': and no undo step');
  // a chain cancelled between segments keeps the committed segment only
  click(s, 10, 50); click(s, 30, 50); // one segment committed, the next start floating
  finish(s);
  assert.deepStrictEqual(orphans(s), [], granularity + ': Esc between segments leaves no floating start point');
}
SettingsManager.set('LINE_CHAIN_UNDO', 'per-segment', { persist: 'none' });

// ---- 5. the journal label names the tool ----
{
  const s = mk();
  click(s, 10, 10); click(s, 30, 10); finish(s);
  assert.strictEqual(s.history[0].label, 'line', 'the step is labelled with the tool that made it');
}

// ---- 6. Undo with the floating next-start joint present does not bring it back on Redo ----
{
  const s = mk();
  click(s, 10, 10); click(s, 30, 10); // a segment committed, the next start joint floating
  const stepsBefore = s.history.length;
  deactivateLineTool(s); // what the Ctrl+Z key does first
  s.undo();
  s.redo();
  assert.deepStrictEqual(orphans(s), [], 'Redo does not bring back a floating start joint');
  assert.strictEqual(s.history.length, stepsBefore);
}
console.log('draw-step tests passed');
