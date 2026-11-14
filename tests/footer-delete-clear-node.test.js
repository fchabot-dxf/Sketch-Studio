// tests/footer-delete-clear-node.test.js — TASK 619: footer Delete (#btn-delete-selection) and Clear sketch (#btn-clear-sketch):
//   1. Both buttons exist with exact aria-labels and icon symbols (#icon-circle-x, #icon-trash) across node-app hosts (sketchstudio, shaper, penplotter).
//   2. Disabled states: Delete disabled when nothing is selected, enables on shape / joint / constraint selection and disables again on Esc / delete;
//      Clear sketch disabled when active sketch is empty or locked, enabled when active sketch owns shapes / non-origin joints / constraints.
//   3. Delete button executes the exact same handleDelete path as the Delete key (identical resulting shapes / joints / constraints, ONE undo step, Redo restores).
//   4. Clear sketch opens an in-app alertdialog ("Clear sketch '<name>'? This can be undone."), Cancel preserves state, OK clears ONLY the active sketch
//      (other sketches & locked sketches untouched), ONE undo step restores it, Redo clears again.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { addSketch, activateSketch, setSketchLocked } from '#core/sketch-model.js';
import { clearActiveSketch, canClearActiveSketch, hasSelection } from '#core/delete-manager.js';

const tickMicro = () => new Promise((r) => setTimeout(r, 15));

const snapshot = (s) => ({
  shapes: s.shapes.map((x) => ({ id: x.id, type: x.type, sketchId: x.sketchId || 'sketch-1', joints: [...(x.joints || [])] })),
  joints: [...s.joints.keys()].sort(),
  constraints: s.constraints.map((c) => c.type),
  historyLen: s.history.length,
});

// 1. Delete via button === Delete key (same resulting state, one undo), plus disabled state transitions across hosts
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  // Path A: delete with Delete key
  let resKey;
  {
    const app = await open({ host });
    try {
      const r = app.svg.getBoundingClientRect();
      const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const delBtn = app.document.getElementById('btn-delete-selection');
      const clrBtn = app.document.getElementById('btn-clear-sketch');
      assert(delBtn && clrBtn, host + ': footer Delete and Clear sketch buttons exist');
      assert.strictEqual(delBtn.getAttribute('aria-label'), 'Delete');
      assert.strictEqual(clrBtn.getAttribute('aria-label'), 'Clear sketch');
      assert.strictEqual(delBtn.querySelector('use')?.getAttribute('href'), '#icon-circle-x', host + ': Delete uses #icon-circle-x');
      assert.strictEqual(clrBtn.querySelector('use')?.getAttribute('href'), '#icon-trash', host + ': Clear uses #icon-trash');
      assert.strictEqual(delBtn.disabled, true, host + ': Delete initially disabled with no selection');
      assert.strictEqual(clrBtn.disabled, true, host + ': Clear initially disabled on empty sketch');

      // Draw two lines
      app.document.getElementById('tool-line').click(); app.frames();
      app.click(cv.x - 100, cv.y - 40); app.click(cv.x - 20, cv.y - 40);
      app.key('Escape');
      app.document.getElementById('tool-line').click(); app.frames();
      app.click(cv.x + 20, cv.y + 40); app.click(cv.x + 120, cv.y + 40);
      app.key('Escape');
      assert.strictEqual(app.state.shapes.length, 2, host + ': 2 shapes drawn');
      await tickMicro(); app.frames();
      assert.strictEqual(clrBtn.disabled, false, host + ': Clear enables after drawing');
      assert.strictEqual(delBtn.disabled, true, host + ': Delete still disabled with no selection');

      // Select first line
      app.document.getElementById('tool-select').click(); app.frames();
      app.click(cv.x - 60, cv.y - 40);
      await tickMicro(); app.frames();
      assert.strictEqual(app.state.selectedShapes.size, 1, host + ': first line selected');
      assert.strictEqual(delBtn.disabled, false, host + ': Delete enables on selection');

      // Escape clears selection -> Delete disables again
      app.key('Escape');
      await tickMicro(); app.frames();
      assert.strictEqual(delBtn.disabled, true, host + ': Delete disables after Esc clears selection');

      // Re-select first line and press Delete key
      app.click(cv.x - 60, cv.y - 40);
      await tickMicro(); app.frames();
      const histBefore = app.state.history.length;
      app.key('Delete');
      await tickMicro(); app.frames();
      assert.strictEqual(app.state.shapes.length, 1, host + ': Delete key removed 1 shape');
      assert.strictEqual(app.state.history.length, histBefore + 1, host + ': Delete key is ONE undo step');
      assert.strictEqual(delBtn.disabled, true, host + ': Delete disables after deletion');
      resKey = { afterDelete: snapshot(app.state), shapeCount: app.state.shapes.length };
    } finally { await app.close(); }
  }

  // Path B: delete with #btn-delete-selection
  {
    const app = await open({ host });
    try {
      const r = app.svg.getBoundingClientRect();
      const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const delBtn = app.document.getElementById('btn-delete-selection');
      app.document.getElementById('tool-line').click(); app.frames();
      app.click(cv.x - 100, cv.y - 40); app.click(cv.x - 20, cv.y - 40);
      app.key('Escape');
      app.document.getElementById('tool-line').click(); app.frames();
      app.click(cv.x + 20, cv.y + 40); app.click(cv.x + 120, cv.y + 40);
      app.key('Escape');

      app.document.getElementById('tool-select').click(); app.frames();
      app.click(cv.x - 60, cv.y - 40);
      await tickMicro(); app.frames();
      const histBefore = app.state.history.length;
      delBtn.click();
      await tickMicro(); app.frames();
      assert.strictEqual(delBtn.disabled, true, host + ': Delete button disables after click');
      assert.strictEqual(app.state.history.length, histBefore + 1, host + ': Delete button is ONE undo step');
      const resBtn = snapshot(app.state);
      assert.deepStrictEqual(resBtn.shapes.map((s) => s.type), resKey.afterDelete.shapes.map((s) => s.type), host + ': Delete button === Delete key shape result');
      assert.strictEqual(resBtn.joints.length, resKey.afterDelete.joints.length, host + ': Delete button === Delete key joint count');
      assert.strictEqual(resBtn.constraints.length, resKey.afterDelete.constraints.length, host + ': Delete button === Delete key constraint count');
      assert.strictEqual(resBtn.historyLen, resKey.afterDelete.historyLen, host + ': Delete button === Delete key history len');

      // Undo brings deleted line back in 1 click, Redo deletes again
      app.document.getElementById('btn-undo').click(); app.frames();
      assert.strictEqual(app.state.shapes.length, 2, host + ': ONE Undo restores deleted shape');
      app.document.getElementById('btn-redo').click(); app.frames();
      assert.strictEqual(app.state.shapes.length, 1, host + ': Redo deletes again');
    } finally { await app.close(); }
  }
}

// 2. Clear sketch: in-app confirm, multi-sketch isolation, locked sketch protection, disabled states, ONE undo step
{
  const app = await open({ host: 'sketchstudio' });
  try {
    const r = app.svg.getBoundingClientRect();
    const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const clrBtn = app.document.getElementById('btn-clear-sketch');

    // Sketch 1: draw a line with a horizontal constraint (auto or manual)
    app.document.getElementById('tool-line').click(); app.frames();
    app.click(cv.x - 140, cv.y); app.click(cv.x - 40, cv.y);
    app.key('Escape');
    const sk1Shapes = app.state.shapes.filter((s) => (s.sketchId || 'sketch-1') === 'sketch-1').map((s) => s.id);
    assert.strictEqual(sk1Shapes.length, 1);

    // Add Sketch 2 and make it active: currently EMPTY -> Clear sketch must be disabled!
    const sk2 = addSketch(app.state, 'Sketch 2');
    activateSketch(app.state, sk2.id);
    app.frames();
    assert.strictEqual(clrBtn.disabled, true, 'Clear sketch disabled when active Sketch 2 is empty (even while Sketch 1 has geometry)');

    // Draw 2 shapes in Sketch 2
    app.document.getElementById('tool-line').click(); app.frames();
    app.click(cv.x + 20, cv.y - 30); app.click(cv.x + 120, cv.y - 30);
    app.key('Escape');
    app.document.getElementById('tool-circle').click(); app.frames();
    app.drag({ x: cv.x + 60, y: cv.y + 40 }, { x: cv.x + 100, y: cv.y + 40 }, 4);
    app.key('Escape');
    await tickMicro(); app.frames();
    assert.strictEqual(clrBtn.disabled, false, 'Clear sketch enabled when Sketch 2 has shapes');

    // Add Sketch 3 with a shape and LOCK Sketch 3
    const sk3 = addSketch(app.state, 'Locked Ref');
    activateSketch(app.state, sk3.id);
    app.document.getElementById('tool-line').click(); app.frames();
    app.click(cv.x - 80, cv.y + 80); app.click(cv.x, cv.y + 80);
    app.key('Escape');
    activateSketch(app.state, sk2.id);
    const lockRes = setSketchLocked(app.state, sk3.id, true);
    assert.strictEqual(lockRes.ok, true);
    app.frames();

    const sk1Before = app.state.shapes.filter((s) => (s.sketchId || 'sketch-1') === 'sketch-1');
    const sk3Before = app.state.shapes.filter((s) => s.sketchId === sk3.id);
    const sk2Before = app.state.shapes.filter((s) => s.sketchId === sk2.id);
    assert.strictEqual(sk2Before.length, 2, 'Sketch 2 has 2 shapes before clear');

    // Click Clear sketch -> Cancel first
    clrBtn.click();
    await tickMicro();
    let dlg = app.document.querySelector('[role="alertdialog"]');
    assert(dlg, 'in-app confirm dialog opens');
    assert.strictEqual(dlg.textContent.includes("Clear sketch 'Sketch 2'? This can be undone."), true, 'confirm prompt names active sketch: ' + dlg.textContent);
    dlg.querySelector('.cancel').click();
    await tickMicro(); app.frames();
    assert.strictEqual(app.document.querySelector('[role="alertdialog"]'), null, 'Cancel closes confirm dialog');
    assert.strictEqual(app.state.shapes.filter((s) => s.sketchId === sk2.id).length, 2, 'Cancel leaves Sketch 2 intact');

    // Click Clear sketch -> Confirm ("Clear")
    const histBeforeClear = app.state.history.length;
    clrBtn.click();
    await tickMicro();
    dlg = app.document.querySelector('[role="alertdialog"]');
    assert(dlg, 'confirm dialog opens on second click');
    dlg.querySelector('.ok').click();
    await tickMicro(); app.frames();
    assert.strictEqual(app.document.querySelector('[role="alertdialog"]'), null, 'OK closes confirm dialog');

    // Verify ONLY active Sketch 2 was emptied; Sketch 1 and locked Sketch 3 untouched; ONE undo step
    assert.strictEqual(app.state.shapes.filter((s) => s.sketchId === sk2.id).length, 0, 'Sketch 2 is now empty');
    assert.strictEqual(app.state.shapes.filter((s) => (s.sketchId || 'sketch-1') === 'sketch-1').length, sk1Before.length, 'Sketch 1 untouched');
    assert.strictEqual(app.state.shapes.filter((s) => s.sketchId === sk3.id).length, sk3Before.length, 'Locked Sketch 3 untouched');
    assert.strictEqual(app.state.activeSketchId, sk2.id, 'Sketch 2 stays the active sketch');
    assert.strictEqual(clrBtn.disabled, true, 'Clear sketch disabled now that Sketch 2 is empty');
    assert.strictEqual(app.state.history.length, histBeforeClear + 1, 'Clear sketch is ONE undo step');

    // ONE Undo restores Sketch 2
    app.document.getElementById('btn-undo').click(); app.frames();
    assert.strictEqual(app.state.shapes.filter((s) => s.sketchId === sk2.id).length, 2, 'ONE Undo restores Sketch 2 shapes');
    assert.strictEqual(clrBtn.disabled, false, 'Clear sketch re-enables after Undo');

    // Programmatically locked active sketch edge case: refused & disabled
    app.state.sketches.find((s) => s.id === sk2.id).locked = true;
    app.frames();
    assert.strictEqual(canClearActiveSketch(app.state), false, 'locked active sketch cannot be cleared');
    assert.strictEqual(clrBtn.disabled, true, 'Clear sketch disabled if active sketch is locked');
    const lockedAttempt = clearActiveSketch(app.state);
    assert.strictEqual(lockedAttempt.ok, false);
    assert.strictEqual(lockedAttempt.reason, 'it is locked: unlock it first');
    assert.strictEqual(app.state.shapes.filter((s) => s.sketchId === sk2.id).length, 2, 'locked active sketch geometry preserved');

    // Origin joint alone cannot be deleted -> hasSelection is false and Delete stays disabled
    app.state.selectedShapes.clear();
    app.state.selectedConstraints.clear();
    app.state.selectedJoints = new Set(['j_origin']);
    app.frames();
    assert.strictEqual(hasSelection(app.state), false, 'j_origin alone is not deletable');
    assert.strictEqual(app.document.getElementById('btn-delete-selection').disabled, true, 'Delete stays disabled when only j_origin is selected');
  } finally { await app.close(); }
}

console.log('footer-delete-clear-node: ok');
