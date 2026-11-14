// tests/sketch-import.test.js — TASK 566: the ONE SVG / DXF importer (#ui/sketch-import.js) and its File-menu entry, live in headless Edge.
//  A. (moved to tests/sketch-import-shared-node.test.js, TASK 601) the shared importer on small SVG / DXF fixtures gives the SAME shapes the old Shaper-only path gave and lands as ONE undo step;
//  B. in SketchStudio, Shaper, Pen Plotter AND Trace: the File menu has "Import SVG / DXF…", a real file chooser import of an SVG and of a DXF
//     shows the shapes, Ctrl+Z removes each import in ONE step, and a dropped file imports through the same importer.
//     TASK 610: SketchStudio, Shaper and Pen Plotter moved to tests/sketch-import-node.test.js (their import wiring is in modules the kit calls); this browser
//     file keeps TRACE, which is not a kit host (its File menu, import and reload run in the page script).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser } from './helpers/cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '566', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    const nav = async (url) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([l, sleep(8000)]); };

    // ── B. every app with the shared sidebar ──────────────────────────────────────────────────────────────────────────────────────────────────
    const apps = [
      { name: 'Trace', url: '/apps/trace/index.html', ready: `!!document.getElementById('tab-edit')`, canvas: '#design-canvas', drop: '#tab-edit' },
    ];
    const svgText = fs.readFileSync(FIX('svg', 'import-basic.svg'), 'utf8');
    for (const app of apps) {
      await nav(app.url);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn') && ${app.ready}`, 'the ' + app.name + ' page'); await sleep(800);
      if (app.prep) { await evalJs(app.prep); await sleep(1200); }
      const countJs = app.count || `document.querySelectorAll('${app.canvas} .shape-elem').length`; // Pen Plotter draws imported (static) shapes in its underlay, so it is read from its state; Trace's Edit canvas draws them like the others (TASK 567)
      const count = () => evalJs(countJs);
      const undo = async () => {
        await sleep(1000); // the drawer has closed and focus is back on the page
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
        await sleep(600);
      };
      const before = await count();
      for (const [kind, file, n] of [['SVG', FIX('svg', 'import-basic.svg'), 10], ['DXF', FIX('dxf', 'part-mm.dxf'), 7]]) {
        const { label } = await importViaMenu(cdp, file);
        assert.strictEqual(label, 'Import SVG / DXF…', app.name + ': the File menu entry');
        await waitFor(`Promise.resolve(${countJs}).then((c) => c === ${before + n})`, `${app.name}: the ${kind} import's ${n} shapes to appear`);
        await undo();
        assert.strictEqual(await count(), before, `${app.name}: ONE Ctrl+Z removes the whole ${kind} import`);
      }
      // a dropped file: the same importer
      await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(svgText)}], 'dropped.svg', { type: 'image/svg+xml' })); const t = document.querySelector('${app.drop}'); t.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); t.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
      await waitFor(`Promise.resolve(${countJs}).then((c) => c === ${before + 10})`, `${app.name}: the dropped SVG's 10 shapes`);
      await undo();
      assert.strictEqual(await count(), before, app.name + ': ONE Ctrl+Z removes the dropped import');
      console.log(app.name + ': menu entry + SVG + DXF + drop, each one undo step: ok');
    }
    console.log('sketch-import: ok');
  } finally {
    await cdp.close();
  }
})();
