// tests/penplotter-pen-undo-node.test.js — TASK 583 (node port of tests/penplotter-pen-undo.test.js, TASK 445): Pen Plotter pen edits are undoable
// (history.js serializes plotColors). On the Toolpath stage, through tests/helpers/node-app.js (the real stages: apps/penplotter/src/stages.js):
// add a pen -> Ctrl+Z gone -> Ctrl+Y back; rename it by typing -> Ctrl+Z the old name; delete a pen a toolpath uses -> Ctrl+Z the pen is back AND
// the toolpath still uses it.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'penplotter' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const P = app.plotter; // the plotter's state (apps/penplotter/src/state.js)
  const observe = () => ({ pens: P.plotColors.map((p) => p.name), tpPens: P.toolpaths.map((t) => t.plotColorId), penIds: P.plotColors.map((p) => p.id) });
  const ctrl = (k) => app.key(k, { ctrl: true });

  pressEl('.stage-btn[data-stage="toolpath"]');
  assert(q('.stage-btn[data-stage="toolpath"]').classList.contains('active') && q('#addPlotColor'), 'toolpath stage shown');

  const base = observe();
  // 1. add a pen -> Ctrl+Z -> gone -> Ctrl+Y -> back
  pressEl('#addPlotColor');
  const added = observe();
  assert.strictEqual(added.pens.length, base.pens.length + 1, 'added one pen');
  ctrl('z');
  const u1 = observe();
  console.log('add pen    :', JSON.stringify(base.pens), '->', JSON.stringify(added.pens), 'Ctrl+Z ->', JSON.stringify(u1.pens));
  assert.deepStrictEqual(u1.pens, base.pens, 'Ctrl+Z removes the added pen');
  ctrl('y');
  const r1 = observe();
  console.log('           Ctrl+Y ->', JSON.stringify(r1.pens));
  assert.deepStrictEqual(r1.pens, added.pens, 'Ctrl+Y brings the pen back');

  // 2. a second pen (so a delete is allowed), then rename it with real typing
  pressEl('#addPlotColor');
  const two = observe();
  const lastName = two.pens[two.pens.length - 1];
  const nameInput = q('.pc-row:last-child .pc-name');
  app.press(nameInput); nameInput.focus(); nameInput.select();
  app.type('Zed');
  app.key('Enter');
  app.click(5, 5); // a click off the input (history.js ignores INPUT targets)
  const renamed = observe();
  assert.strictEqual(renamed.pens[renamed.pens.length - 1], 'Zed', 'renamed to Zed');
  ctrl('z');
  const u2 = observe();
  console.log('rename     :', JSON.stringify(two.pens), '-> Zed; Ctrl+Z ->', JSON.stringify(u2.pens));
  assert.deepStrictEqual(u2.pens, two.pens, 'Ctrl+Z restores the old pen name');
  assert.strictEqual(u2.pens[u2.pens.length - 1], lastName);

  // 3. delete a pen used by a toolpath -> reassign -> Ctrl+Z -> pen back and the toolpath still uses it
  const penId = two.penIds[two.penIds.length - 1];
  // seed (test setup, not the gesture under test): point toolpath 0 at the pen, re-render so its "used by" badge is current
  P.toolpaths[0].plotColorId = penId;
  (await import('../apps/penplotter/src/plot-colors-panel.js')).renderPlotColorsPanel();
  const seeded = observe();
  assert.strictEqual(seeded.tpPens[0], penId, 'seeded: toolpath uses the pen to delete');
  pressEl('.pc-row:last-child .pc-del');
  await app.waitFor(() => !!q('.ui-dialog-ok'), 'delete-pen confirm dialog');
  pressEl('.ui-dialog-ok');
  await app.waitFor(() => P.plotColors.length === two.pens.length - 1, 'pen deleted');
  const deleted = observe();
  console.log('delete pen :', JSON.stringify(seeded.penIds), '-> pens', JSON.stringify(deleted.penIds), 'toolpath pen', seeded.tpPens[0], '->', deleted.tpPens[0]);
  assert.strictEqual(deleted.pens.length, two.pens.length - 1, 'pen deleted');
  assert.notStrictEqual(deleted.tpPens[0], penId, 'toolpath reassigned off the deleted pen');
  ctrl('z');
  const u3 = observe();
  console.log('           Ctrl+Z -> pens', JSON.stringify(u3.penIds), 'toolpath pen', u3.tpPens[0]);
  assert.deepStrictEqual(u3.penIds, two.penIds, 'Ctrl+Z restores the deleted pen');
  assert.strictEqual(u3.tpPens[0], penId, 'the toolpath uses the restored pen again');
  assert(u3.penIds.includes(u3.tpPens[0]), 'toolpath points at a pen that exists');
  console.log('penplotter-pen-undo-node: ok');
} finally {
  await app.close();
}
