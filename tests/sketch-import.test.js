// tests/sketch-import.test.js — TASK 566: the ONE SVG / DXF importer (#ui/sketch-import.js) and its File-menu entry, live in headless Edge.
//  A. the shared importer on small SVG / DXF fixtures gives the SAME shapes the old Shaper-only path gave (tests/fixtures/svg/import-baseline-shaper.json,
//     captured from the old Shaper code before it was deleted) and lands as ONE undo step;
//  B. in SketchStudio, Shaper, Pen Plotter AND Trace: the File menu has "Import SVG / DXF…", a real file chooser import of an SVG and of a DXF
//     shows the shapes, Ctrl+Z removes each import in ONE step, and a dropped file imports through the same importer.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser } from './helpers/cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseline = JSON.parse(fs.readFileSync(FIX('svg', 'import-baseline-shaper.json'), 'utf8'));

await (async () => {
  const cdp = await launchBrowser({ tag: '566', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    const nav = async (url) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([l, sleep(8000)]); };

    // ── B. every app with the shared sidebar ──────────────────────────────────────────────────────────────────────────────────────────────────
    const apps = [
      { name: 'SketchStudio', url: '/apps/sketchstudio/index.html', ready: `!!document.getElementById('tool-line')`, canvas: '#svgCanvas', drop: '#svgCanvas' },
      { name: 'Shaper', url: '/apps/shaper/index.html', ready: `!!document.querySelector('[data-mode="design"]')`, prep: `document.querySelector('[data-mode="design"]').click()`, canvas: '#design-canvas', drop: '#design-view' },
      { name: 'Pen Plotter', url: '/apps/penplotter/index.html', ready: `!!window.__sketch`, prep: `(document.querySelector('.stage-btn[data-stage="design"]') || document.body).click()`, canvas: '#design-canvas', count: `window.__sketch.controller.state.shapes.length`, drop: '#design-canvas-wrap' },
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
    // ── A. (run last: a page left open on another app's saved design must not matter) the shared importer = the old Shaper path ──────────────────────────────────────────────────────────────────────────────────────────
    await nav('/apps/shaper/index.html');
    await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, 'the Shaper page');
    const runShared = (text, name, keep) => evalJs(`(async () => {
      const { importIntoSketch } = await import('/packages/ui/sketch-import.js');
      const { createSketches } = await import('/packages/core/sketch-model.js');
      let n = 0; const saves = [];
      const state = { ...createSketches(), joints: new Map(), shapes: [], genJ: () => 'j' + (++n), saveState: (l) => saves.push(l) };
      const res = importIntoSketch(${JSON.stringify(text)}, ${JSON.stringify(name)}, { state }, { keepDescIds: ${keep} });
      const J = (id) => { const j = state.joints.get(id); return [Math.round(j.x * 1e6) / 1e6, Math.round(j.y * 1e6) / 1e6]; };
      return JSON.stringify({ ok: res.ok, message: res.message, saves, shapes: state.shapes.map((s) => ({ type: s.type, joints: s.joints.map(J), radius: s.radius == null ? null : Math.round(s.radius * 1e6) / 1e6, sweep: s.sweep == null ? null : s.sweep, isConstruction: !!s.isConstruction, descId: s.descId || null })), sketches: state.sketches.map((s) => s.name) });
    })()`).then(JSON.parse);
    const cases = [
      ['import-basic.svg', FIX('svg', 'import-basic.svg'), 'import-basic.svg'],
      ['dxf:part-mm.dxf', FIX('dxf', 'part-mm.dxf'), 'part-mm.dxf'],
      ['dxf:fusion-sketch4.dxf', FIX('dxf', 'fusion-sketch4.dxf'), 'fusion-sketch4.dxf'],
      ['svg:fusion-shaper-addin-arcs.svg', FIX('svg', 'fusion-shaper-addin-arcs.svg'), 'fusion-shaper-addin-arcs.svg'],
    ];
    for (const [key, file, name] of cases) {
      const r = await runShared(fs.readFileSync(file, 'utf8'), name, true);
      assert.ok(r.ok, key + ': ' + r.message);
      assert.deepStrictEqual(r.shapes, baseline[key].shapes, key + ': the same shapes (types, joint coordinates, radii, sweeps, construction flags) as the old Shaper path');
      assert.deepStrictEqual(r.sketches, baseline[key].sketches, key + ': the same new sketch');
      assert.strictEqual(r.saves.length, 1, key + ': ONE undo snapshot per import');
      console.log(key, '->', r.shapes.length, 'shapes |', r.message);
    }
    const basic = await runShared(fs.readFileSync(FIX('svg', 'import-basic.svg'), 'utf8'), 'x.svg', false);
    assert.ok(basic.shapes.every((s) => s.descId === null), 'descIds are dropped unless the host keeps them');
    assert.ok(basic.shapes.some((s) => s.type === 'arc') && basic.shapes.some((s) => s.type === 'circle'), 'the arc path and the circle became real arc / circle shapes');
    const bad = await runShared('<svg><oops', 'bad.svg', false);
    assert.ok(!bad.ok && /^Import failed: /.test(bad.message) && bad.saves.length === 0 && bad.shapes.length === 0, 'a malformed SVG is a readable failure and changes nothing: ' + bad.message);

    console.log('sketch-import: ok');
  } finally {
    await cdp.close();
  }
})();
