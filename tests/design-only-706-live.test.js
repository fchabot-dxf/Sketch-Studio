// tests/design-only-706-live.test.js — TASK 706 ("everything in Design", owner turns 1884 / 1886), in the REAL pages (headless Edge):
//  A. Shaper has no Explore stage: a fresh Shaper opens on Design (desktop 1280 x 800 and phone 390 x 844 touch), and an existing user's stored
//     MODE_KEY 'explore' opens Design too; the header / drawer list Design, Prepare, Review (TASK 741: no Vcarve).
//  B. Shaper: a file DROPPED anywhere on the page while Prepare shows is imported into Design (shown); a Shaper SVG whose cut attributes sit on a <g>
//     (as Shaper's own export writes them) keeps its cut types: Prepare's cut card shows Pocket for both grouped squares and Outside for the third.
//  C. Pen Plotter: the drawer's Import SVG / DXF… started on Toolpath lands in Design, shown, with its result line.
//  D. SketchStudio: the drawer's Import SVG / DXF… started on the Export view (☰ Export…) lands in Design, shown; New design from the Export view too.
//  E. Trace (declares no showDesign: unchanged): its Import SVG / DXF… started on the Trace tab still opens its Edit tab (its own rule, TASK 566).
// The imports go through the real file chooser (<input type=file>, CDP file chooser intercept; showOpenFilePicker deleted from the page as on Android).
// No console error and no page exception. EVIDENCE_DIR set: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const RECT = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect x="10" y="10" width="40" height="30" fill="none" stroke="#000"/></svg>';
const GROUPED = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="200mm" height="80mm" viewBox="0 0 200 80">' +
  '<g fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.000 mm" shaper:cutOffset="0mm" shaper:toolDia="6.350 mm">' +
  '<path d="M 10 10 L 50 10 L 50 40 L 10 40 Z"/><path d="M 70 10 L 110 10 L 110 40 L 70 40 Z"/></g>' +
  '<path d="M 130 10 L 180 10 L 180 60 L 130 60 Z" fill="#000000" shaper:cutType="outside" shaper:cutDepth="12.000 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/></svg>';

await (async () => {
  const cdp = await launchBrowser({ tag: '706', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, ws, evalJs, waitFor, navigate, waitForApp } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-706-'));
  const RECT_FILE = path.join(tmp, 'rect-706.svg');
  fs.writeFileSync(RECT_FILE, RECT);
  const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
  });
  const url = (app) => `http://127.0.0.1:${port}/apps/${app}/index.html`;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  };
  let pointer = mouse;
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p, what + ': ' + sel + ' not found');
    assert(p.hit, what + ': ' + sel + ' is covered at its centre ' + JSON.stringify(p));
    await pointer(p.x, p.y);
  };
  const shot = async (name, clip) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const stageIds = () => evalJs(`[...document.querySelectorAll(getComputedStyle(document.querySelector('header.sk-header')).display === 'none' ? '.sk-sidebar-stage' : '.sk-header-tab')].map((b) => b.dataset.tab)`); // desktop: the header's tabs; phone: the drawer's first row
  const openMenu = async (what) => {
    const phone = await evalJs(`getComputedStyle(document.querySelector('header.sk-header')).display === 'none'`);
    await press(phone ? '.sk-sidebar-handle' : '.sk-sidebar-btn', what + 'the menu');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + 'the menu opens'); await sleep(300);
  };
  // the drawer's Import SVG / DXF… with a real press; the real chooser gets `file`
  const importVia = async (file, what) => {
    await evalJs(`delete window.showOpenFilePicker; typeof window.showOpenFilePicker`);
    await openMenu(what);
    const chooser = once('Page.fileChooserOpened');
    await press('.sk-sidebar-item[data-action="import-file"]', what + 'Import SVG / DXF…');
    const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
    assert(ch, what + 'the file chooser opened');
    await send('DOM.setFileInputFiles', { files: [file], backendNodeId: ch.backendNodeId });
  };
  const fresh = async (app, canvasId, storedMode) => {
    await resetBufferLive(cdp);
    await evalJs(storedMode ? `localStorage.setItem('shaper-mode', '${storedMode}')` : `localStorage.removeItem('shaper-mode')`);
    await navigate(url(app), 15000);
    await waitForApp(canvasId);
    await sleep(600);
    await send('DOM.getDocument', { depth: 0 });
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
  };
  // the drawn shapes of a canvas: how many, and how many lie inside the canvas on screen (the import's fit ran on a shown canvas)
  const inside = (canvasSel, shapeSel = canvasSel + ' .shape-elem') => evalJs(`(() => { const c = document.querySelector('${canvasSel}').getBoundingClientRect(); const els = [...document.querySelectorAll('${shapeSel}')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; });
    return { drawn: els.length, inside: els.filter((e) => { const r = e.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }).length }; })()`);
  const visible = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);

  try {
    await send('Runtime.enable');
    await send('Page.enable');

    // ---- A. Shaper opens on Design: desktop, then phone; fresh and with a stored 'explore' ----
    for (const stored of [null, 'explore']) {
      await fresh('shaper', 'design-canvas', stored);
      const tag = `A desktop (stored ${stored}): `;
      const st = { stage: await activeStage(), stages: await stageIds(), stored: await evalJs(`localStorage.getItem('shaper-mode')`), canvas: await visible('#design-canvas') };
      console.log(tag + JSON.stringify(st));
      await shot(`A-shaper-desktop-${stored || 'fresh'}.png`, { x: 0, y: 0, width: 1280, height: 420 });
      assert.strictEqual(st.stage, 'design', tag + 'Shaper opens on Design');
      assert.deepStrictEqual(st.stages, ['design', 'prepare', 'review'], tag + 'the stages: no Explore (TASK 741: no V-carve)');
      assert.strictEqual(st.canvas, true, tag + 'the Design canvas shows');
      assert.strictEqual(st.stored, 'design', tag + 'the stored stage is now Design');
      assert.strictEqual(await evalJs(`!!document.querySelector('main.layout, #tree, #inspector, #file')`), false, tag + "Explore's markup is gone");
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    for (const stored of [null, 'explore']) {
      await fresh('shaper', 'design-canvas', stored);
      const tag = `A phone 390 (stored ${stored}): `;
      const c = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
      console.log(tag + JSON.stringify({ stage: await activeStage(), canvas: c }));
      await shot(`A-shaper-phone390-${stored || 'fresh'}.png`, { x: 0, y: 0, width: 390, height: 844 });
      assert.strictEqual(await activeStage(), 'design', tag + 'Shaper opens on Design');
      assert(c.w >= 0.9 * 390 && c.h >= 0.4 * 844, tag + 'the Design canvas fills the phone: ' + JSON.stringify(c));
      await openMenu(tag);
      assert.deepStrictEqual(await stageIds(), ['design', 'prepare', 'review'], tag + 'the drawer lists Design, Prepare, Export (ids; TASK 707, TASK 741)');
      await shot(`A-shaper-phone390-drawer-${stored || 'fresh'}.png`, { x: 0, y: 0, width: 390, height: 520 });
      await evalJs(`document.querySelector('.sk-sidebar-backdrop').click()`); await sleep(300);
    }
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    pointer = mouse;

    // ---- B. Shaper: a grouped Shaper SVG dropped on Prepare lands in Design and keeps its cut types ----
    {
      await fresh('shaper', 'design-canvas', null);
      await press('.sk-header-tab[data-tab="prepare"]', 'B: the Prepare tab'); await sleep(600);
      assert.strictEqual(await activeStage(), 'prepare', 'B: on Prepare');
      const n0 = await evalJs(`window.__designController.state.sketches.length`);
      await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(GROUPED)}], 'grouped-shaper.svg', { type: 'image/svg+xml' }));
        const t = document.getElementById('prepare-canvas'); const r = t.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 50, clientY: r.top + 50 };
        t.dispatchEvent(new DragEvent('dragover', o)); t.dispatchEvent(new DragEvent('drop', o)); })()`);
      await waitFor(`window.__designController.state.sketches.length === ${n0 + 1}`, 'B: the dropped file made a new sketch');
      await sleep(800);
      const b = { stage: await activeStage(), shapes: await evalJs(`window.__designController.state.shapes.filter((s) => s.sketchId === window.__designController.state.activeSketchId).length`), status: await evalJs(`document.getElementById('group-status') && document.getElementById('group-status').textContent`) };
      console.log('B after the drop on Prepare ' + JSON.stringify(b));
      await shot('B-shaper-drop-on-prepare-design.png', { x: 0, y: 0, width: 1280, height: 600 });
      assert.strictEqual(b.stage, 'design', 'B: a file dropped on Prepare is imported into Design, shown');
      assert.strictEqual(b.shapes, 12, 'B: its 3 squares (12 lines)');
      assert(/3 cuts kept/.test(b.status), 'B: the status line says the 3 cuts were kept: ' + b.status);
      await press('.sk-header-tab[data-tab="prepare"]', 'B: the Prepare tab'); await sleep(800);
      await waitFor(`window.__prepareView && window.__prepareView.loops.length === 3`, 'B: Prepare found the 3 loops');
      // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): a click on a shape only selects it; its operation's card shows when the operation is opened (its list row, then Edit), and OK closes it
      const cards = await evalJs(`import('/apps/shaper/src/operations-store.js').then((S) => { const v = window.__prepareView; const out = []; for (const l of v.loops) {
        const m = S.membersOf('loop:' + l.id)[0]; if (!m) { out.push(null); continue; }
        document.querySelector('#prepare-ops .ops-row[data-id="' + m.op.id + '"] .ops-pick').click(); document.querySelector('#prepare-ops .ops-row[data-id="' + m.op.id + '"] .ops-edit').click();
        out.push({ type: document.querySelector('.cut-type-cur').textContent, depth: document.querySelector('.cut-depth').value, bit: document.querySelector('.cut-bit').value });
        document.querySelector('#prepare-panel .cut-ok').click(); } return out; })`);
      console.log('B Prepare cut cards ' + JSON.stringify(cards));
      await shot('B-shaper-prepare-cut-card.png', { x: 0, y: 0, width: 1280, height: 600 });
      assert.deepStrictEqual(cards.map((c) => c.type).sort(), ['Outside', 'Pocket', 'Pocket'], "B: Prepare's cut card shows the grouped squares' Pocket and the Outside");
    }

    // ---- C. Pen Plotter: an import started on Toolpath lands in Design ----
    {
      await fresh('penplotter', 'design-canvas', null);
      await press('.sk-header-tab[data-tab="toolpath"]', 'C: the Toolpath tab'); await sleep(600);
      assert.strictEqual(await activeStage(), 'toolpath', 'C: on Toolpath');
      await importVia(RECT_FILE, 'C: ');
      await waitFor(`/Imported 4 shapes/.test(document.getElementById('importStatus').textContent)`, 'C: the import landed');
      await sleep(600);
      const c = { stage: await activeStage(), status: await evalJs(`document.getElementById('importStatus').textContent`), statusShown: await visible('#importStatus'), designShown: await visible('#design-canvas'), shapes: await inside('#design-canvas', '#pen-underlay path[data-shape-id]') }; // Pen Plotter draws imported (static) shapes in its pen underlay
      console.log('C Pen Plotter import from Toolpath ' + JSON.stringify(c));
      await shot('C-penplotter-import-from-toolpath.png');
      assert.strictEqual(c.stage, 'design', 'C: the import is shown in Design');
      assert.strictEqual(c.designShown, true, 'C: the Design canvas shows');
      assert.strictEqual(c.statusShown, true, 'C: its result line is seen');
      assert(c.shapes.drawn >= 4 && c.shapes.inside === c.shapes.drawn, 'C: the imported rectangle lies inside the Design canvas: ' + JSON.stringify(c.shapes));
    }

    // ---- D. SketchStudio: an import (and New design) started on the Export view lands in Design ----
    {
      await fresh('sketchstudio', 'svgCanvas', null);
      await openMenu('D: ');
      await press('.sk-sidebar-item[data-action="export"]', 'D: Export…');
      await waitFor(`!document.getElementById('export-panel').classList.contains('hidden')`, 'D: the Export view');
      await importVia(RECT_FILE, 'D: ');
      await waitFor(`document.getElementById('export-panel').classList.contains('hidden')`, 'D: the Export view is left');
      await sleep(1000);
      const d = { exportHidden: await evalJs(`document.getElementById('export-panel').classList.contains('hidden')`), canvasShown: await visible('#svgCanvas'), shapes: await inside('#svgCanvas') };
      console.log('D SketchStudio import from the Export view ' + JSON.stringify(d));
      await shot('D-sketchstudio-import-from-export.png');
      assert.strictEqual(d.exportHidden, true, 'D: the Export view is left');
      assert.strictEqual(d.canvasShown, true, 'D: the Design canvas shows the import');
      assert(d.shapes.drawn >= 4 && d.shapes.inside === d.shapes.drawn, 'D: the imported rectangle lies inside the Design canvas: ' + JSON.stringify(d.shapes));
      // New design from the Export view
      await openMenu('D2: ');
      await press('.sk-sidebar-item[data-action="export"]', 'D2: Export…');
      await waitFor(`!document.getElementById('export-panel').classList.contains('hidden')`, 'D2: the Export view');
      const tabs0 = await evalJs(`document.querySelectorAll('.sk-doctab').length`);
      await openMenu('D2: ');
      await press('.sk-sidebar-item[data-action="new-design"]', 'D2: New design');
      await waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'D2: the template picker');
      await press('.sk-tp-card[data-template="blank"]', 'D2: Blank design');
      await waitFor(`document.querySelectorAll('.sk-doctab').length > ${tabs0}`, 'D2: a new tab');
      await sleep(800);
      assert.strictEqual(await evalJs(`document.getElementById('export-panel').classList.contains('hidden')`), true, 'D2: a new design started on the Export view shows Design');
      assert.strictEqual(await visible('#svgCanvas'), true, 'D2: the Design canvas shows');
    }

    // ---- E. Trace: unchanged, its import opens Edit ----
    {
      await fresh('trace', 'design-canvas', null);
      await press('.sk-header-tab[data-tab="trace"]', 'E: the Trace tab'); await sleep(500);
      assert.strictEqual(await activeStage(), 'trace', 'E: on the Trace tab');
      await importVia(RECT_FILE, 'E: ');
      await waitFor(`document.querySelector('.sk-header-tab.active').dataset.tab === 'edit'`, 'E: the Edit tab after the import');
      await sleep(600);
      await shot('E-trace-import-opens-edit.png', { x: 0, y: 0, width: 1280, height: 600 });
      assert.strictEqual(await activeStage(), 'edit', 'E: Trace still shows its Edit tab after an import (its own rule, unchanged)');
    }

    assert.deepStrictEqual(problems, [], 'no console error and no page exception');
    console.log('design-only-706-live: all checks pass');
  } finally {
    await cdp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
