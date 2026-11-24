// tests/over-constrained-874-live.test.js — TASK 874: the real SketchStudio page, desktop 1280x800 and phone 390x844. The Parallel tool used twice on
// the same two lines: the second time the toast reads "Sketch geometry over constrained" with the red circle-with-X icon, nothing is added.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/874'); fs.mkdirSync(EVID, { recursive: true });
const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: -60, y: 20, sketchId: 'sketch-1' }], ['b', { x: 0, y: 40, sketchId: 'sketch-1' }],
      ['c', { x: -60, y: 70, sketchId: 'sketch-1' }], ['d', { x: 0, y: 90, sketchId: 'sketch-1' }]],
    shapes: [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'l2', type: 'line', joints: ['c', 'd'], sketchId: 'sketch-1', isConstruction: false }],
    constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

async function run({ width, height, tag }) {
  const label = `${width}x${height}`, isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `874-${tag}`, width, height });
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
    return cur.document.geometry.constraints.map((c) => c.type); })`);
  const parallelOnce = async () => {
    await pressRibbonTool(evalJs, clickPt, 'tool-parallel');
    await waitFor(`document.getElementById('tool-parallel')?.classList.contains('active')`, 'Parallel tool active');
    await clickPt(await onLine('l1', 0.5)); await clickPt(await onLine('l2', 0.5));
  };
  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 874', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc)}, { app: 'sketchstudio', id: d.id }); })`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="l1"]')`, 'seeded lines rendered');
    await sleep(300);
    await parallelOnce();
    await flushAutosave();
    const first = await read();
    assert.deepStrictEqual(first, ['parallel'], `[${label}] the first Parallel is made (${JSON.stringify(first)})`);
    assert.strictEqual(await evalJs(`document.querySelectorAll('#notification-container [data-level]').length`), 0, `[${label}] the first Parallel shows no notice`);
    await parallelOnce();
    await waitFor(`document.querySelectorAll('#notification-container [data-level="overconstrained"]').length === 1`, 'the over-constrained notice');
    await sleep(500);
    const txt = await evalJs(`document.querySelector('#notification-container [data-level]').textContent.trim()`);
    assert.strictEqual(txt, 'Sketch geometry over constrained', `[${label}] the toast text`);
    assert.ok(await evalJs(`!!document.querySelector('#notification-container [data-level] svg') && !document.querySelector('#notification-container [data-level] button')`), `[${label}] the icon, no Copy button`);
    const r = await evalJs(`(() => { const b = document.querySelector('#notification-container [data-level]').getBoundingClientRect(); return { x: b.left - 10, y: b.top - 10, width: b.width + 20, height: b.height + 20 }; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 3 } });
    fs.writeFileSync(path.join(EVID, `over-constrained-${tag}.png`), Buffer.from(shot.data, 'base64'));
    await flushAutosave();
    assert.deepStrictEqual(await read(), ['parallel'], `[${label}] the second Parallel added nothing`);
    console.log(`[${label}] PASS`);
  } finally { await close(); }
}
await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
