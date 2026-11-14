// tests/helpers/import-polish-fit.js — TASK 601: the FIT rule of tests/import-polish-fit-*.test.js (TASK 570), shared by the parts that run
// it for some of the four apps each (so no live file runs over ~40 s). runImportFit(appNames, tag) launches a headless browser and runs the
// asserts of the old import-polish.test.js section 1, verbatim, for the named apps.
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './import-via-menu.js';
import { launchBrowser } from './cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runImportFit(appNames, tag) {
  const cdp = await launchBrowser({ tag, width: 1400, height: 800 });
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
    // ── 1. FIT in every app ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const apps = [
      { name: 'SketchStudio', url: '/apps/sketchstudio/index.html', ready: `!!document.getElementById('tool-line')`, canvas: '#svgCanvas', shapes: '#svgCanvas .shape-elem' },
      { name: 'Shaper', url: '/apps/shaper/index.html', ready: `!!document.querySelector('[data-mode="design"]')`, prep: `document.querySelector('[data-mode="design"]').click()`, canvas: '#design-canvas', shapes: '#design-canvas .shape-elem' },
      { name: 'Pen Plotter', url: '/apps/penplotter/index.html', ready: `!!window.__sketch`, prep: `(document.querySelector('.stage-btn[data-stage="design"]') || document.body).click()`, canvas: '#design-canvas', shapes: '#design-paper > rect' }, // TASK 573: Pen Plotter frames the whole PAPER (the SVG sets the paper size, the DXF does not: both)
      { name: 'Trace', url: '/apps/trace/index.html', ready: `!!document.getElementById('tab-edit')`, canvas: '#design-canvas', shapes: '#design-canvas .shape-elem' },
    ];
    const boxes = (app) => evalJs(`(() => {
      const c = document.querySelector('${app.canvas}').getBoundingClientRect();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, n = 0;
      for (const e of document.querySelectorAll('${app.shapes}')) { const q = e.getBoundingClientRect(); if (!q.width && !q.height) continue; n++; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
      return JSON.stringify({ n, canvas: [c.left, c.top, c.right, c.bottom], shapes: [l, t, r, b] });
    })()`).then(JSON.parse);
    for (const app of apps.filter((a) => appNames.includes(a.name))) {
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

    console.log('import-polish-fit ' + tag + ': ok');
  } finally {
    await cdp.close();
  }
}
