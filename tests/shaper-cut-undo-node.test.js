// tests/shaper-cut-undo-node.test.js — TASK 583 (node port of tests/shaper-cut-undo.test.js, TASK 463): every Shaper cut-plan edit is ONE step of the SHARED sketch history
// (Ctrl+Z / Ctrl+Y on Prepare, the ribbon Undo / Redo), and undoing an SVG import restores the cut plan that existed before it. Through tests/helpers/node-app.js with
// Shaper's declared Prepare stage (apps/shaper/src/prepare-stage.js) and mode router (modes.js); the import is cut-import.js, what the File menu runs after its file chooser.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';
import { importShaperFile } from '../apps/shaper/src/cut-import.js';

const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const openMode = (mode) => { pressEl(`.sk-header-tab[data-tab="${mode}"]`); assert.strictEqual(q('.sk-header-tab.active').dataset.tab, mode, 'the ' + mode + ' tab opens'); };
  const plan = () => [...CUT_PLAN.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const recs = () => plan().map(([, r]) => r);
  const st = app.state;
  const hist = () => st.history.length;
  const ctrl = (k) => app.key(k, { ctrl: true });

  openMode('design');
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  const J = (id, x, y) => st.joints.set(id, { x, y });
  J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
  [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].forEach(([id, p, q2]) => st.shapes.push({ id, type: 'line', joints: [p, q2] }));
  st.history.length = 0; st.redoStack.length = 0; st._notifyHistory();
  openMode('prepare');
  assert(doc.querySelectorAll('#prepare-canvas .sk-edge').length >= 4, 'Prepare shows the seeded geometry');
  const pc = doc.getElementById('prepare-canvas');
  const inside = worldToScreen(pc, { x: 30, y: 20 });
  app.click(Math.round(inside.x), Math.round(inside.y), { target: pc }); // select the loop
  assert(!q('.cut-card').hidden, 'the cut card shows the selected loop');

  // ── cut TYPE: one step, Ctrl+Z (on Prepare) removes it, Ctrl+Y brings it back ──
  let h0 = hist();
  pressEl('.cut-type-trigger');
  assert(q('.cut-type-opt[data-id="pocket"]'), 'the cut type menu');
  pressEl('.cut-type-opt[data-id="pocket"]');
  assert.strictEqual(hist(), h0 + 1, 'picking a cut type is ONE history step');
  assert.deepStrictEqual(recs().map((r) => r.cutType), ['pocket']);
  ctrl('z');
  assert.deepStrictEqual(plan(), [], 'Ctrl+Z on Prepare removes the cut type (the Design-only gate does not block it)');
  assert.strictEqual(hist(), h0, 'and it consumed exactly ONE step (no double-firing)');
  ctrl('y');
  assert.strictEqual(hist(), h0 + 1);
  assert.deepStrictEqual(recs().map((r) => r.cutType), ['pocket'], 'Ctrl+Y brings it back');
  assert.strictEqual(q('.cut-card').hidden, false, 'the selection and the card survive an undo that only changed the plan');

  // ── DEPTH: change -> undo -> old depth ──
  h0 = hist();
  pressEl('.cut-step[data-d="1"]');
  assert.strictEqual(hist(), h0 + 1, 'a depth step is ONE history step');
  const depthSet = recs()[0].cutDepth;
  assert.ok(typeof depthSet === 'number' && depthSet > 0, 'depth set: ' + depthSet);
  ctrl('z');
  assert.strictEqual(hist(), h0);
  assert.strictEqual(recs()[0].cutDepth, 'unset', 'undo restores the old depth');
  ctrl('y');
  assert.strictEqual(hist(), h0 + 1);
  assert.strictEqual(recs()[0].cutDepth, depthSet);

  // ── offset preset, bit preset, cutter shape + angle: each ONE step; a no-op pick adds none ──
  h0 = hist();
  pressEl('.cut-offset');
  assert(q('.cut-offset-pop .cut-preset:nth-child(5)'), 'the offset presets');
  pressEl('.cut-offset-pop .cut-preset:nth-child(5)');
  assert.strictEqual(hist(), h0 + 1, 'an offset preset is ONE step');
  h0 = hist();
  pressEl('.cut-presets .cut-preset:nth-child(3)'); // 1/4 in
  assert.strictEqual(hist(), h0 + 1, 'a bit-diameter preset is ONE step');
  h0 = hist();
  pressEl('.cut-presets .cut-preset:nth-child(3)'); // the same value again: nothing to wait for, only absence to check
  assert.strictEqual(hist(), h0, 'picking the value it already has adds NO step');
  pressEl('.cut-shape-trigger');
  assert(q('.cut-shape-pop .cut-type-opt[data-shape="vbit"]'), 'the cutter shape menu');
  pressEl('.cut-shape-pop .cut-type-opt[data-shape="vbit"]');
  assert(q('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]'), 'the V-bit angle presets');
  h0 = hist();
  pressEl('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]');
  assert.strictEqual(hist(), h0 + 1, 'choosing a V-bit angle (shape + angle) is ONE step');
  let r0 = recs()[0];
  assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 60]);
  ctrl('z');
  assert.strictEqual(hist(), h0);
  r0 = recs()[0];
  assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 90], 'one undo reverts the angle step');
  ctrl('y');
  assert.strictEqual(hist(), h0 + 1);

  // ── the ribbon Undo/Redo buttons (Design) reflect it and drive the same history ──
  h0 = hist();
  pressEl('.cut-presets .cut-preset:nth-child(2)');
  assert.strictEqual(hist(), h0 + 1);
  pressEl('.cut-presets .cut-preset:nth-child(4)');
  assert.strictEqual(hist(), h0 + 2);
  ctrl('z'); // one step undone, one still undoable
  assert.strictEqual(hist(), h0 + 1);
  openMode('design');
  await app.waitFor(() => !!doc.getElementById('btn-redo') && !doc.getElementById('btn-redo').disabled, 'the ribbon Redo to enable');
  assert.strictEqual(doc.getElementById('btn-redo').disabled, false, 'Redo is enabled after an undo of a cut edit');
  assert.strictEqual(doc.getElementById('btn-undo').disabled, false, 'Undo is enabled while cut edits are on the stack');
  const before = JSON.stringify(plan());
  pressEl('#btn-undo');
  assert.strictEqual(hist(), h0);
  assert.notStrictEqual(JSON.stringify(plan()), before, 'the ribbon Undo undoes a cut edit too');
  pressEl('#btn-redo');
  assert.strictEqual(hist(), h0 + 1);
  assert.strictEqual(JSON.stringify(plan()), before, 'and Redo brings it back');

  // ── an SVG import: assign cuts, import (adds records), undo the import -> the plan is back to what it was before it ──
  openMode('prepare');
  assert(doc.querySelectorAll('#prepare-canvas .sk-edge').length >= 4, 'Prepare shows the geometry');
  const planBeforeImport = JSON.stringify(plan());
  const shapesBefore = st.shapes.length;
  openMode('design');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M 200 0 L 240 0 L 240 30 L 200 30 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.350 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/></svg>';
  const imp = importShaperFile(app.controller, svg, 'sk-463-import.svg', () => 'mm');
  assert(imp.ok, 'the import: ' + imp.message);
  assert(st.shapes.length > shapesBefore, 'the imported shapes');
  const planAfterImport = JSON.stringify(plan());
  assert.ok(JSON.parse(planAfterImport).length > JSON.parse(planBeforeImport).length, 'the import added a cut record');
  const shapesAfter = st.shapes.length;
  assert.ok(shapesAfter > shapesBefore, 'and its shapes');
  ctrl('z'); // Design: the shared handler
  assert.strictEqual(st.shapes.length, shapesBefore, 'the import is undone');
  assert.strictEqual(JSON.stringify(plan()), planBeforeImport, 'undoing the import restores the cut plan that existed before it (no stale records)');
  assert.strictEqual(st.shapes.length, shapesBefore, 'and the shapes');
  ctrl('y');
  assert.strictEqual(st.shapes.length, shapesAfter, 'the import is redone');
  assert.strictEqual(JSON.stringify(plan()), planAfterImport, 'redo brings the import and its cuts back');
  console.log('shaper-cut-undo-node: ok');
} finally {
  await app.close();
}
