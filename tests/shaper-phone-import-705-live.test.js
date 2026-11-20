// tests/shaper-phone-import-705-live.test.js — TASK 705 (owner turns 1867-1868): Shaper on a PHONE (412 x 900, real touch, mobile viewport), the drawer's
// "Import SVG / DXF…" through the <input type=file> path an Android browser takes (it has no window.showOpenFilePicker: the test deletes it from the
// page, the app keeps its one code path, packages/ui/project-file.js browserFileSeam.open), the file handed to the real chooser by CDP
// (Page.setInterceptFileChooserDialog + Page.fileChooserOpened + DOM.setFileInputFiles):
//  A. from Prepare (TASK 706: 705 started on Explore, the owner's stage then; Explore is gone, and an import from ANY stage is shown in Design): an SVG
//     lands in a NEW sketch, Shaper shows it in Design, every imported shape lies inside the visible Design canvas (the view fits them), the import's
//     message shows over the Design view;
//  B. from Design: a DXF lands the same way, the stage stays Design;
//  C. a drawing the size of the owner's (a grid of ~2070 small squares, ~8300 line segments, generated here) lands, fits, and its time to land and to
//     paint the next frame is printed.
// No console error and no page exception in any step. EVIDENCE_DIR set: screenshots after A and C.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG = path.join(HERE, 'fixtures', 'svg', 'import-basic.svg');
const DXF = path.join(HERE, 'fixtures', 'dxf', 'part-mm.dxf');

/** A grid of small closed squares (each a <path>: 4 line segments), the shape of the owner's halftone-like drawing. */
function gridSvg(cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(`<path d="M${(c * 3.8).toFixed(2)} ${(r * 3.8).toFixed(2)} h3.4 v2.9 h-3.4 z"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 3.8}mm" height="${rows * 3.8}mm" viewBox="0 0 ${cols * 3.8} ${rows * 3.8}">${out.join('')}</svg>`;
}

await (async () => {
  const cdp = await launchBrowser({ tag: '705i', width: 412, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, ws, evalJs, waitFor, navigate, waitForApp } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-705-import-'));
  const GRID = path.join(tmp, 'halftone-grid.svg');
  fs.writeFileSync(GRID, gridSvg(46, 45));
  const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
  });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p, what + ': ' + sel + ' not found');
    assert(p.hit, what + ': ' + sel + ' is covered at its centre ' + JSON.stringify(p));
    await tap(p.x, p.y);
  };
  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const activeStage = () => evalJs(`(document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active')).dataset.tab`);
  const openDrawer = async (what) => {
    await press('.sk-sidebar-chevron', what + 'the drawer handle');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + 'the drawer opens'); await sleep(300);
  };
  // the new sketch: its shapes, and how many lie inside the Design canvas on screen
  const landed = () => evalJs(`(() => { const st = window.__designController.state; const sk = st.activeSketchId; const c = document.getElementById('design-canvas').getBoundingClientRect();
    const ids = new Set(st.shapes.filter((s) => s.sketchId === sk).map((s) => s.id));
    const els = [...document.querySelectorAll('#design-canvas .shape-elem')].filter((e) => ids.has(e.dataset.shapeId));
    const inside = els.filter((e) => { const r = e.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }).length;
    const toast = document.getElementById('group-status');
    const tr = toast ? toast.getBoundingClientRect() : null;
    return { sketch: sk, sketches: st.sketches.length, shapes: ids.size, drawn: els.length, inside, canvas: { w: Math.round(c.width), h: Math.round(c.height) },
      toast: toast ? { text: toast.textContent, opacity: getComputedStyle(toast).opacity, shown: !!tr && tr.width > 0 && tr.height > 0 } : null }; })()`);
  // the drawer's Import SVG / DXF… with a real tap; the chooser gets `file`
  const importVia = async (file, what) => {
    await openDrawer(what);
    const chooser = once('Page.fileChooserOpened');
    await press('.sk-sidebar-item[data-action="import-file"]', what + 'Import SVG / DXF…');
    const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
    assert(ch, what + 'the file chooser opened (the <input type=file> path)');
    const t0 = Date.now();
    await send('DOM.setFileInputFiles', { files: [file], backendNodeId: ch.backendNodeId });
    return t0;
  };

  try {
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 900, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await resetBufferLive(cdp);
    await evalJs(`localStorage.removeItem('shaper-mode')`);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    await sleep(500);
    await evalJs(`delete window.showOpenFilePicker; typeof window.showOpenFilePicker`); // an Android browser has none
    assert.strictEqual(await evalJs(`typeof window.showOpenFilePicker`), 'undefined', 'the page has no showOpenFilePicker (as on Android)');
    await send('DOM.getDocument', { depth: 0 });
    await send('Page.setInterceptFileChooserDialog', { enabled: true });

    // A. from Prepare, an SVG
    assert.strictEqual(await activeStage(), 'design', 'A: a fresh Shaper opens on Design (TASK 706: was Explore)');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`); await sleep(500);
    assert.strictEqual(await activeStage(), 'prepare', 'A: on Prepare');
    const before = await evalJs(`window.__designController.state.sketches.length`);
    await importVia(SVG, 'A: ');
    await waitFor(`window.__designController.state.sketches.length === ${before + 1}`, 'A: the import made a new sketch');
    await sleep(800);
    const a = { stage: await activeStage(), ...(await landed()) };
    console.log('A (SVG from Prepare) ' + JSON.stringify(a));
    await shot('import-a-svg-from-prepare.png');
    assert.strictEqual(a.stage, 'design', 'A: the imported drawing is shown in Design');
    assert(a.shapes >= 3 && a.inside === a.shapes, 'A: every imported shape lies inside the visible Design canvas: ' + JSON.stringify(a));
    assert(a.toast && a.toast.shown && a.toast.opacity === '1' && /import/i.test(a.toast.text), 'A: the import message shows over the Design view: ' + JSON.stringify(a.toast));

    // B. from Design, a DXF
    const b0 = await evalJs(`window.__designController.state.sketches.length`);
    await importVia(DXF, 'B: ');
    await waitFor(`window.__designController.state.sketches.length === ${b0 + 1}`, 'B: the DXF import made a new sketch');
    await sleep(800);
    const b = { stage: await activeStage(), ...(await landed()) };
    console.log('B (DXF from Design) ' + JSON.stringify(b));
    assert.strictEqual(b.stage, 'design', 'B: the stage stays Design');
    assert(b.shapes >= 3 && b.inside === b.shapes, 'B: every imported DXF shape lies inside the visible Design canvas: ' + JSON.stringify(b));

    // C. a drawing the size of the owner's
    const c0 = await evalJs(`window.__designController.state.sketches.length`);
    const t0 = await importVia(GRID, 'C: ');
    await waitFor(`window.__designController.state.sketches.length === ${c0 + 1}`, 'C: the grid import made a new sketch', 120000);
    const tLanded = Date.now() - t0;
    await waitFor(`(() => { const st = window.__designController.state; return document.querySelectorAll('#design-canvas .shape-elem').length >= st.shapes.length; })()`, 'C: every shape drawn', 120000);
    const tDrawn = Date.now() - t0;
    const frameMs = await evalJs(`new Promise((res) => { const s = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - s)))); })`);
    await sleep(1500);
    const c = await landed();
    console.log('C (grid of 2070 squares) ' + JSON.stringify({ landedMs: tLanded, drawnMs: tDrawn, nextTwoFramesMs: frameMs, shapes: c.shapes, drawn: c.drawn, inside: c.inside, canvas: c.canvas }));
    await shot('import-c-grid.png');
    assert(c.shapes >= 8000, 'C: ~8300 line segments landed: ' + c.shapes);
    assert.strictEqual(c.inside, c.shapes, 'C: every one lies inside the visible Design canvas');

    assert.deepStrictEqual(problems, [], 'no console error and no page exception');
    console.log('shaper-phone-import-705: all checks pass');
  } finally {
    await cdp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
