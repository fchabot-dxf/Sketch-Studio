// tests/import-polish-undo-node.test.js — TASK 610 (node port of tests/import-polish-undo.test.js, TASK 570 / 601): ONE Ctrl+Z of an import also restores what the host's
// afterImport changed: Pen Plotter's paper size / pens / shapeStyles / static ids, Shaper's cut plan; Ctrl+Y brings the import state back. The import is the sidebar's
// "Import SVG / DXF…" + the file chooser (kit override 15), into the hosts' own import modules (Pen Plotter sketch-stage.js importDrawing, Shaper cut-import.js
// createShaperImporter). Same asserts, same steps; the old 1 s / 0.6 s sleeps are the kit's events (the import's own async steps are waited for).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './helpers/node-app.js';
import { findOrCreatePlotColor } from '../apps/penplotter/src/state.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const importViaMenu = async (app, file) => {
  app.press(app.document.querySelector('.sk-sidebar-btn')); await app.pause(50);
  app.press(app.document.querySelector('[data-action="import-file"]'));
  await app.waitFor(() => app.hasFileChooser(), 'the file chooser to open');
  app.chooseFile({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
};
const undo = async (app) => { await app.pause(100); app.undo(); await app.pause(100); };
const redo = async (app) => { await app.pause(100); app.redo(); await app.pause(100); };

// ── 2. Pen Plotter: one Ctrl+Z puts back paper, pens, styles, static ids ──
{
  const app = await open({ host: 'penplotter', sidebar: true });
  try {
    const ppState = () => { const s = app.plotter; return JSON.parse(JSON.stringify({ doc: s.doc, plotColors: s.plotColors, shapeStyles: [...s.shapeStyles.entries()], staticShapeIds: [...s.staticShapeIds], toolpaths: s.toolpaths.length, shapes: app.state.shapes.length })); };
    const ppBefore = ppState();
    await importViaMenu(app, FIX('svg', 'import-basic.svg'));
    await app.waitFor(() => app.state.shapes.length > ppBefore.shapes, 'the Pen Plotter import'); await app.pause(100);
    const ppAfter = ppState();
    assert.notDeepStrictEqual(ppAfter.doc, ppBefore.doc, 'the import changed the paper size: ' + JSON.stringify(ppBefore.doc) + ' -> ' + JSON.stringify(ppAfter.doc));
    assert.ok(ppAfter.plotColors.length > ppBefore.plotColors.length, 'the import added a pen');
    assert.ok(ppAfter.shapeStyles.length > ppBefore.shapeStyles.length, 'the import added shapeStyles');
    await undo(app);
    assert.deepStrictEqual(ppState(), ppBefore, 'Ctrl+Z: shapes, paper size, pens, shapeStyles and static ids equal the before state');
    await redo(app);
    assert.deepStrictEqual(ppState(), ppAfter, 'Ctrl+Y: the import state again');
    // a step that is not an import does not carry the host data: a pen added after the import survives the undo of a later sketch step
    findOrCreatePlotColor('#12ab34'); app.state.saveState('probe step');
    const pens = ppState().plotColors.length;
    await undo(app);
    assert.strictEqual(ppState().plotColors.length, pens, 'undoing a NON-import step leaves the pens alone');
    console.log('Pen Plotter: import undo / redo restore paper, pens, shapeStyles, static ids; other steps untouched');
  } finally { await app.close(); }
}

// ── 3. Shaper: the cut plan after Ctrl+Z equals the before state ──
{
  const app = await open({ host: 'shaper', sidebar: true });
  try {
    const plan = () => JSON.parse(JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)));
    const nShapes = () => app.state.shapes.length;
    const planBefore = plan(), shBefore = nShapes();
    await importViaMenu(app, FIX('svg', 'fusion-shaper-addin.svg'));
    await app.waitFor(() => nShapes() > shBefore, 'the Shaper import'); await app.pause(100);
    const planAfter = plan();
    assert.ok(planAfter.length > planBefore.length, 'the import filled the cut plan: ' + planAfter.length + ' entries');
    await undo(app);
    assert.deepStrictEqual(plan(), planBefore, 'Ctrl+Z: the cut plan equals the before state');
    assert.strictEqual(nShapes(), shBefore, 'Ctrl+Z: the shapes are gone');
    await redo(app);
    assert.deepStrictEqual(plan(), planAfter, 'Ctrl+Y: the import cut plan again');
    console.log('Shaper: import undo / redo restore the cut plan');
  } finally { await app.close(); }
}
console.log('import-polish-undo-node: ok');
