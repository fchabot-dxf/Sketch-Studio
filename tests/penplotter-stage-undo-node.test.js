// tests/penplotter-stage-undo-node.test.js — TASK 583 (node port of tests/penplotter-stage-undo.test.js, TASK 444b): ONE keystroke -> ONE history,
// chosen by the active stage. Pen Plotter has two histories: Design = the shared sketch history (state.undo / redo: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z via
// #ui input-manager); Toolpath / Export = history.js (toolpaths / pens / doc). Draw a line (Design), add a toolpath (Toolpath), then: Ctrl+Z on Design
// undoes ONLY the line; Ctrl+Y on Design redoes ONLY the line; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on Toolpath touch ONLY the toolpaths.
// Through tests/helpers/node-app.js with the real stages (apps/penplotter/src/stages.js).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'penplotter' });
try {
  const doc = app.document;
  const pressEl = (sel) => { const e = doc.querySelector(sel); assert(e, sel + ' not found'); app.press(e); };
  const stageTab = (name) => { pressEl(`.stage-btn[data-stage="${name}"]`); assert(doc.querySelector(`.stage-btn[data-stage="${name}"]`).classList.contains('active'), name + ' stage active'); };
  const ctrl = (k, o = {}) => app.key(k, { ctrl: true, ...o });
  const s = app.state, P = app.plotter;
  // sketch lines + sketch history depths (Design history) and toolpaths (history.js)
  const observe = () => ({ lines: s.shapes.filter((x) => x.type === 'line').length, tps: P.toolpaths.length, sketchHistory: s.history.length, sketchRedo: s.redoStack.length });

  stageTab('design');
  // Design: draw ONE line
  const box = app.svg.getBoundingClientRect();
  const bx = Math.round(box.left + box.width * 0.5), by = Math.round(box.top + box.height * 0.6);
  const base = observe();
  app.click(bx, by + 150);
  app.key('l');
  app.click(bx - 120, by); app.click(bx + 120, by);
  app.esc();
  const afterLine = observe();
  assert.strictEqual(afterLine.lines, base.lines + 1, 'drew one line');

  // Toolpath: add ONE toolpath (a click on #addOutlineTp) -> history.js snapshot
  stageTab('toolpath');
  assert(doc.querySelector('#addOutlineTp'), 'toolpath panel ready');
  const toolpathBase = observe();
  pressEl('#addOutlineTp');
  const afterPen = observe();
  assert.strictEqual(afterPen.tps, toolpathBase.tps + 1, 'added one toolpath');
  assert.strictEqual(afterPen.lines, afterLine.lines, 'adding a toolpath does not touch the sketch');

  // Back on Design: ONE Ctrl+Z must undo the line and leave the toolpath
  stageTab('design');
  const before1 = observe();
  ctrl('z');
  const a1 = observe();
  console.log('Design Ctrl+Z    before', JSON.stringify(before1), 'after', JSON.stringify(a1));
  assert.strictEqual(a1.lines, before1.lines - 1, 'Design Ctrl+Z undoes the line');
  assert.strictEqual(a1.tps, before1.tps, 'Design Ctrl+Z must NOT undo the toolpath (toolpath history)');

  // Design: Ctrl+Y redoes the line, toolpath untouched
  ctrl('y');
  const a2 = observe();
  console.log('Design Ctrl+Y    after', JSON.stringify(a2));
  assert.strictEqual(a2.lines, a1.lines + 1, 'Design Ctrl+Y redoes the line');
  assert.strictEqual(a2.tps, a1.tps, 'Design Ctrl+Y must NOT touch the toolpath');

  // Toolpath: Ctrl+Z undoes the toolpath only, sketch untouched
  stageTab('toolpath');
  const before3 = observe();
  ctrl('z');
  const a3 = observe();
  console.log('Toolpath Ctrl+Z  before', JSON.stringify(before3), 'after', JSON.stringify(a3));
  assert.strictEqual(a3.tps, before3.tps - 1, 'Toolpath Ctrl+Z undoes the toolpath');
  assert.strictEqual(a3.lines, before3.lines, 'Toolpath Ctrl+Z must NOT touch the sketch');
  assert.strictEqual(a3.sketchHistory, before3.sketchHistory, 'Toolpath Ctrl+Z must NOT move the sketch history');
  assert.strictEqual(a3.sketchRedo, before3.sketchRedo, 'Toolpath Ctrl+Z must NOT move the sketch redo stack');

  // Toolpath: Ctrl+Y redoes the toolpath only
  ctrl('y');
  const a4 = observe();
  console.log('Toolpath Ctrl+Y  after', JSON.stringify(a4));
  assert.strictEqual(a4.tps, a3.tps + 1, 'Toolpath Ctrl+Y redoes the toolpath');
  assert.strictEqual(a4.lines, a3.lines, 'Toolpath Ctrl+Y must NOT touch the sketch');
  assert.strictEqual(a4.sketchHistory, a3.sketchHistory, 'Toolpath Ctrl+Y must NOT move the sketch history');

  // Toolpath: Ctrl+Z then Ctrl+Shift+Z returns to the same state, sketch untouched
  ctrl('z');
  ctrl('Z', { shift: true });
  const a5 = observe();
  assert.strictEqual(a5.tps, a4.tps, 'Toolpath Ctrl+Z then Ctrl+Shift+Z returns to the same toolpaths');
  assert.strictEqual(a5.lines, a4.lines, 'Toolpath Ctrl+Shift+Z must NOT touch the sketch');
  console.log('penplotter-stage-undo-node: ok');
} finally {
  await app.close();
}
