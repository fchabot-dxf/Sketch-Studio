// tests/import-polish.test.js — TASK 570: (1) after an import the shared importer FITS the view to the imported shapes, in all four apps;
// (2) ONE Ctrl+Z of an import also restores what the host's afterImport changed: Pen Plotter's paper size / pens / shapeStyles / static ids,
// Shaper's cut plan; Ctrl+Y brings the import state back. Live, headless Edge.
//  FIT RULE: the screen box of the imported shapes lies inside the canvas box (1.5 px tolerance) AND fills at least half of the canvas in its
//  tighter dimension (the fit leaves a 10 % margin on every side, so the box takes about 80 %).
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser } from './helpers/cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '570', width: 1400, height: 800 });
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

    // ── 1. FIT in every app ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const apps = [
      { name: 'SketchStudio', url: '/apps/sketchstudio/index.html', ready: `!!document.getElementById('tool-line')`, canvas: '#svgCanvas', shapes: '#svgCanvas .shape-elem' },
      { name: 'Shaper', url: '/apps/shaper/index.html', ready: `!!document.querySelector('[data-mode="design"]')`, prep: `document.querySelector('[data-mode="design"]').click()`, canvas: '#design-canvas', shapes: '#design-canvas .shape-elem' },
      { name: 'Pen Plotter', url: '/apps/penplotter/index.html', ready: `!!window.__sketch`, prep: `(document.querySelector('.stage-btn[data-stage="design"]') || document.body).click()`, canvas: '#design-canvas', shapes: '#pen-underlay path' }, // imported art is static: drawn by the underlay
      { name: 'Trace', url: '/apps/trace/index.html', ready: `!!document.getElementById('tab-edit')`, canvas: '#design-canvas', shapes: '#design-canvas .shape-elem' },
    ];
    const boxes = (app) => evalJs(`(() => {
      const c = document.querySelector('${app.canvas}').getBoundingClientRect();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, n = 0;
      for (const e of document.querySelectorAll('${app.shapes}')) { const q = e.getBoundingClientRect(); if (!q.width && !q.height) continue; n++; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
      return JSON.stringify({ n, canvas: [c.left, c.top, c.right, c.bottom], shapes: [l, t, r, b] });
    })()`).then(JSON.parse);
    for (const app of apps) {
      await nav(app.url);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn') && ${app.ready}`, 'the ' + app.name + ' page'); await sleep(800);
      if (app.prep) { await evalJs(app.prep); await sleep(1200); }
      for (const file of [FIX('svg', 'import-basic.svg'), FIX('dxf', 'part-mm.dxf')]) {
        await importViaMenu(cdp, file); await sleep(2000);
        const { n, canvas: c, shapes: s } = await boxes(app);
        assert.ok(n > 0, `${app.name}: ${path.basename(file)} shows shapes`);
        const tol = 1.5;
        assert.ok(s[0] >= c[0] - tol && s[1] >= c[1] - tol && s[2] <= c[2] + tol && s[3] <= c[3] + tol, `${app.name} ${path.basename(file)}: the shapes' box ${JSON.stringify(s)} lies inside the canvas ${JSON.stringify(c)}`);
        const fill = Math.max((s[2] - s[0]) / (c[2] - c[0]), (s[3] - s[1]) / (c[3] - c[1]));
        assert.ok(fill >= 0.5, `${app.name} ${path.basename(file)}: the shapes fill ${fill.toFixed(2)} of the canvas (>= 0.5)`);
        console.log(`${app.name} ${path.basename(file)}: inside the canvas, fills ${fill.toFixed(2)}`);
        await undo(); // the next file is measured alone
      }
    }

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
    console.log('import-polish: ok');
  } finally {
    await cdp.close();
  }
})();
