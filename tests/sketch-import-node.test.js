// tests/sketch-import-node.test.js — TASK 610 (node port of part B of tests/sketch-import.test.js, TASK 566), for the three kit hosts: in SketchStudio, Shaper and Pen Plotter the
// File menu has "Import SVG / DXF…", a file chooser import of an SVG and of a DXF shows the shapes, Ctrl+Z removes each import in ONE step, and a dropped file imports through the
// same importer. The wiring is the apps' own, now in modules the page and the kit both call (SketchStudio design-canvas.js createStudioImporter, Shaper cut-import.js
// createShaperImporter, Pen Plotter sketch-stage.js importDrawing); the menu, the chooser (kit override 15), the drop and the undo key are the app's code. Same asserts and
// counts as the browser test. What stays in the browser (tests/sketch-import.test.js): Trace, which is not a kit host.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './helpers/node-app.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const svgText = fs.readFileSync(FIX('svg', 'import-basic.svg'), 'utf8');

const apps = [
  { name: 'SketchStudio', host: 'sketchstudio', canvas: '#svgCanvas', drop: '#svgCanvas' },
  { name: 'Shaper', host: 'shaper', canvas: '#design-canvas', drop: '#design-view' },
  { name: 'Pen Plotter', host: 'penplotter', canvas: '#design-canvas', count: (app) => app.state.shapes.length, drop: '#design-canvas-wrap' }, // Pen Plotter draws imported (static) shapes in its underlay, so it is read from its state
];
for (const a of apps) {
  const app = await open({ host: a.host, sidebar: true });
  try {
    const doc = app.document;
    const count = a.count ? () => a.count(app) : () => doc.querySelectorAll(`${a.canvas} .shape-elem`).length;
    const undo = async () => { await app.pause(100); app.undo(); await app.pause(100); };
    const before = count();
    for (const [kind, file, n] of [['SVG', FIX('svg', 'import-basic.svg'), 10], ['DXF', FIX('dxf', 'part-mm.dxf'), 7]]) {
      app.press(doc.querySelector('.sk-sidebar-btn')); await app.pause(50);
      const entry = doc.querySelector('[data-action="import-file"]');
      assert.strictEqual(entry && entry.textContent.trim(), 'Import SVG / DXF…', a.name + ': the File menu entry');
      app.press(entry);
      await app.waitFor(() => app.hasFileChooser(), a.name + ': the file chooser to open');
      app.chooseFile({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
      await app.waitFor(() => count() === before + n, `${a.name}: the ${kind} import's ${n} shapes to appear`);
      await undo();
      assert.strictEqual(count(), before, `${a.name}: ONE Ctrl+Z removes the whole ${kind} import`);
    }
    // a dropped file: the same importer
    app.dropFile(doc.querySelector(a.drop), { name: 'dropped.svg', text: svgText });
    await app.waitFor(() => count() === before + 10, `${a.name}: the dropped SVG's 10 shapes`);
    await undo();
    assert.strictEqual(count(), before, a.name + ': ONE Ctrl+Z removes the dropped import');
    console.log(a.name + ': menu entry + SVG + DXF + drop, each one undo step: ok');
  } finally { await app.close(); }
}
console.log('sketch-import-node: ok');
