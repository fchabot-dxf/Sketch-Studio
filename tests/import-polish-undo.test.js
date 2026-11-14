// tests/import-polish-undo.test.js — TASK 570 / 601 (the undo part of the old import-polish.test.js): ONE Ctrl+Z of an import also restores what the host's
// afterImport changed: Pen Plotter's paper size / pens / shapeStyles / static ids, Shaper's cut plan; Ctrl+Y brings the import state back. Live, headless Edge.
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser } from './helpers/cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '570u', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    const nav = async (url) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([l, sleep(8000)]); };
    const ctrl = async (k, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: 2 });
      await sleep(600);
    };
    const undo = async () => { await sleep(1000); await ctrl('z', 'KeyZ', 90); }; // the menu drawer has closed and focus is back on the page
    const redo = async () => { await sleep(300); await ctrl('y', 'KeyY', 89); };

    // ── 2. Pen Plotter: one Ctrl+Z puts back paper, pens, styles, static ids ─────────────────────────────────────────────────────────────────
    await nav('/apps/penplotter/index.html');
    await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!window.__sketch`, 'the Pen Plotter page'); await sleep(800);
    await evalJs(`(document.querySelector('.stage-btn[data-stage="design"]') || document.body).click()`); await sleep(1200);
    const ppState = () => evalJs(`(async () => { const { state } = await import('/apps/penplotter/src/state.js');
      return JSON.stringify({ doc: state.doc, plotColors: state.plotColors, shapeStyles: [...state.shapeStyles.entries()], staticShapeIds: [...state.staticShapeIds], toolpaths: state.toolpaths.length, shapes: window.__sketch.controller.state.shapes.length }); })()`).then(JSON.parse);
    const ppBefore = await ppState();
    await importViaMenu(cdp, FIX('svg', 'import-basic.svg'));
    await waitFor(`window.__sketch.controller.state.shapes.length > ${ppBefore.shapes}`, 'the Pen Plotter import'); await sleep(1200);
    const ppAfter = await ppState();
    assert.notDeepStrictEqual(ppAfter.doc, ppBefore.doc, 'the import changed the paper size: ' + JSON.stringify(ppBefore.doc) + ' -> ' + JSON.stringify(ppAfter.doc));
    assert.ok(ppAfter.plotColors.length > ppBefore.plotColors.length, 'the import added a pen');
    assert.ok(ppAfter.shapeStyles.length > ppBefore.shapeStyles.length, 'the import added shapeStyles');
    await undo();
    assert.deepStrictEqual(await ppState(), ppBefore, 'Ctrl+Z: shapes, paper size, pens, shapeStyles and static ids equal the before state');
    await redo();
    assert.deepStrictEqual(await ppState(), ppAfter, 'Ctrl+Y: the import state again');
    // a step that is not an import does not carry the host data: a pen added after the import survives the undo of a later sketch step
    await evalJs(`(async () => { const { findOrCreatePlotColor } = await import('/apps/penplotter/src/state.js'); findOrCreatePlotColor('#12ab34'); window.__sketch.controller.state.saveState('probe step'); })()`);
    const pens = (await ppState()).plotColors.length;
    await undo();
    assert.strictEqual((await ppState()).plotColors.length, pens, 'undoing a NON-import step leaves the pens alone');
    console.log('Pen Plotter: import undo / redo restore paper, pens, shapeStyles, static ids; other steps untouched');

    // ── 3. Shaper: the cut plan after Ctrl+Z equals the before state ────────────────────────────────────────────────────────────────────────
    await nav('/apps/shaper/index.html');
    await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!document.querySelector('[data-mode="design"]')`, 'the Shaper page'); await sleep(800);
    await evalJs(`document.querySelector('[data-mode="design"]').click()`); await sleep(1200);
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller');
    const plan = () => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)); })()`).then(JSON.parse);
    const nShapes = () => evalJs(`window.__designController.state.shapes.length`);
    const planBefore = await plan(), shBefore = await nShapes();
    await importViaMenu(cdp, FIX('svg', 'fusion-shaper-addin.svg'));
    await waitFor(`window.__designController.state.shapes.length > ${shBefore}`, 'the Shaper import'); await sleep(1200);
    const planAfter = await plan();
    assert.ok(planAfter.length > planBefore.length, 'the import filled the cut plan: ' + planAfter.length + ' entries');
    await undo();
    assert.deepStrictEqual(await plan(), planBefore, 'Ctrl+Z: the cut plan equals the before state');
    assert.strictEqual(await nShapes(), shBefore, 'Ctrl+Z: the shapes are gone');
    await redo();
    assert.deepStrictEqual(await plan(), planAfter, 'Ctrl+Y: the import cut plan again');
    console.log('Shaper: import undo / redo restore the cut plan');
    console.log('import-polish-undo: ok');
  } finally {
    await cdp.close();
  }
})();
