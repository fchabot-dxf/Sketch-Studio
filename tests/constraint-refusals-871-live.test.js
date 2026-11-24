// tests/constraint-refusals-871-live.test.js — TASK 871 (audit 869 cause G + I): the real SketchStudio page, desktop 1280x800 and phone 390x844.
// The Horizontal / Vertical tool entered from the ribbon (nothing pre-selected), ONE click on a slanted line -> horizontal; a click on an
// arc with the Midpoint tool was told (871); since task 875 an arc is a valid Midpoint pick (tests/midpoint-arc-875-live.test.js), so the
// invalid pick checked here is an arc then a line ("not two curves"): told (a notice), never a silent exit.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: -60, y: 20, sketchId: 'sketch-1' }], ['b', { x: 0, y: 50, sketchId: 'sketch-1' }],
      ['c', { x: 30, y: -20, sketchId: 'sketch-1' }], ['r', { x: 60, y: -20, sketchId: 'sketch-1' }], ['e', { x: 30, y: 10, sketchId: 'sketch-1' }]],
    shapes: [{ id: 'sl', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'ar', type: 'arc', subType: 'CENTER', joints: ['c', 'r', 'e'], sweep: false, sketchId: 'sketch-1', isConstruction: false }],
    constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

async function run({ width, height, tag }) {
  const label = `${width}x${height}`, isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `871-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;
  const clickPt = async (p) => {
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'none', clickCount: 0 });
      await sleep(50);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 1, clickCount: 1 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(200);
  };
  const onLine = (sid, t) => evalJs(`(() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${sid}"]'); if (!e) return null;
    const x1 = +e.getAttribute('x1'), y1 = +e.getAttribute('y1'), x2 = +e.getAttribute('x2'), y2 = +e.getAttribute('y2');
    const p = new DOMPoint(x1 + (x2 - x1) * ${t}, y1 + (y2 - y1) * ${t}).matrixTransform(e.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const onArc = (sid) => evalJs(`(() => { const e = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${sid}"]'); if (!e) return null;
    const L = e.getTotalLength(), q = e.getPointAtLength(L * 0.5); const p = new DOMPoint(q.x, q.y).matrixTransform(e.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const read = () => evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const cur = await m.getProjectStore().loadCurrent({ app: 'sketchstudio' });
    const g = cur.document.geometry; const jm = Object.fromEntries(g.joints); return { types: g.constraints.map((c) => c.type), ay: jm.a.y, by: jm.b.y }; })`);
  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 871', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc)}, { app: 'sketchstudio', id: d.id }); })`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="sl"]')`, 'seeded line rendered');
    await sleep(300);
    const before = await read();
    assert.ok(Math.abs(before.ay - before.by) > 10, `[${label}] the line starts slanted`);

    await pressRibbonTool(evalJs, clickPt, 'tool-hv');
    await waitFor(`document.getElementById('tool-hv')?.classList.contains('active')`, 'H/V tool active');
    await clickPt(await onLine('sl', 0.5));
    await flushAutosave();
    const after = await read();
    assert.ok(after.types.includes('horizontal') || after.types.includes('vertical'), `[${label}] one click on the line made H/V (${JSON.stringify(after)})`);
    assert.ok(Math.abs(after.ay - after.by) < 1e-3 || Math.abs(after.ay - before.ay) < 1e-3, `[${label}] the line is now H or V (${JSON.stringify(after)})`);

    await evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove())`);
    await pressRibbonTool(evalJs, clickPt, 'tool-midpoint');
    await waitFor(`document.getElementById('tool-midpoint')?.classList.contains('active')`, 'Midpoint tool active');
    await clickPt(await onArc('ar'));
    await sleep(150);
    assert.strictEqual(await evalJs(`document.querySelectorAll('#notification-container [data-level]').length`), 0, `[${label}] task 875: an arc is a valid first Midpoint pick (no notice)`);
    await clickPt(await onLine('sl', 0.3));
    await waitFor(`document.querySelectorAll('#notification-container [data-level]').length >= 1`, 'midpoint on an arc then a line is told');
    console.log(`[${label}] PASS`);
  } finally { await close(); }
}
await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
