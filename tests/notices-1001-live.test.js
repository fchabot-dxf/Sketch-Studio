// tests/notices-1001-live.test.js — TASK 1001: SketchStudio desktop (1280x800) + phone (390x844):
//   1. Export -> no "Export started" toast;
//   2. Equal (E key) on a line + a circle -> plain sentence "Equal needs two lines, or two circles or arcs.", no code/Reason/Args;
//   3. Dimension on fully defined geometry -> added as driven, no toast.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/1001');
fs.mkdirSync(EVID, { recursive: true });

const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: -60, y: 20, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 0, y: 20, fixed: true, sketchId: 'sketch-1' }],
      ['cc', { x: 60, y: 40, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false },
      { id: 'c1', type: 'circle', joints: ['cc'], radius: 20, sketchId: 'sketch-1', isConstruction: false },
    ],
    constraints: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1',
    groups: [], profiles: [], parameters: [],
  },
};

async function run({ width, height, tag }) {
  const label = `${width}x${height}`, isPhone = width <= 640;
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), `ss-1001-${tag}-`));
  const cdp = await launchBrowser({ tag: `1001-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;
  const clickPt = async (p, { shift = false } = {}) => {
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const modifiers = shift ? 8 : 0;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'none', clickCount: 0, modifiers });
      await sleep(50);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 1, clickCount: 1, modifiers });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 0, clickCount: 1, modifiers });
    }
    await sleep(200);
  };
  const onLine = (sid, t) => evalJs(`(() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${sid}"]'); if (!e) return null;
    const x1 = +e.getAttribute('x1'), y1 = +e.getAttribute('y1'), x2 = +e.getAttribute('x2'), y2 = +e.getAttribute('y2');
    const p = new DOMPoint(x1 + (x2 - x1) * ${t}, y1 + (y2 - y1) * ${t}).matrixTransform(e.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const onCircle = (sid) => evalJs(`(() => { const e = document.querySelector('#svgCanvas circle.shape-elem[data-shape-id="${sid}"]'); if (!e) return null;
    const cx = +e.getAttribute('cx'), cy = +e.getAttribute('cy'), r = +e.getAttribute('r');
    const p = new DOMPoint(cx + r, cy).matrixTransform(e.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const toasts = () => evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map(e => e.textContent.trim().replace(/^[^A-Za-z]+/, ''))`);
  const clearToasts = () => evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove())`);

  try {
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 1001', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc)}, { app: 'sketchstudio', id: d.id }); })`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="l1"]')`, 'seeded line rendered');
    await sleep(300);

    // 1. Export -> no "Export started" toast
    await clearToasts();
    await evalJs(`(() => { document.getElementById('export-type').value = 'svg'; document.getElementById('export-filename').value = 't1001'; document.getElementById('btn-export-do').click(); })()`);
    let file = null;
    for (let i = 0; i < 60 && !file; i++) {
      const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg'));
      if (f) file = f;
      else await sleep(100);
    }
    assert.ok(file, `[${label}] 1: SVG exported (dlDir=${JSON.stringify(fs.readdirSync(dlDir))}, toasts=${JSON.stringify(await toasts())})`);
    await sleep(300);
    const exportToasts = await toasts();
    assert.deepStrictEqual(exportToasts, [], `[${label}] 1: Export shows no "Export started" toast`);

    // 2. Equal on a line + a circle -> plain sentence, no code/Reason/Args
    await clearToasts();
    if (isPhone) {
      await pressRibbonTool(evalJs, clickPt, 'tool-equal');
      await waitFor(`document.getElementById('tool-equal')?.classList.contains('active')`, 'Equal tool active');
      await clickPt(await onLine('l1', 0.5));
      await clickPt(await onCircle('c1'));
    } else {
      await clickPt(await onLine('l1', 0.5));
      await clickPt(await onCircle('c1'), { shift: true });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', text: 'e' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE' });
    }
    await waitFor(`document.querySelectorAll('#notification-container [data-level]').length === 1`, 'Equal plain-sentence toast');
    await sleep(200);
    const eqToasts = await toasts();
    assert.strictEqual(eqToasts.length, 1, `[${label}] 2: one Equal toast`);
    assert.strictEqual(eqToasts[0], 'Equal needs two lines, or two circles or arcs.', `[${label}] 2: Equal toast is plain sentence`);
    assert.ok(!/ERR-|Reason:|Args:/.test(eqToasts[0]), `[${label}] 2: no code, Reason, or Args`);
    const r = await evalJs(`(() => { const b = document.querySelector('#notification-container [data-level]').getBoundingClientRect(); return { x: Math.max(0, b.left - 10), y: Math.max(0, b.top - 10), width: b.width + 20, height: b.height + 20 }; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVID, `equal-toast-${tag}.png`), Buffer.from(shot.data, 'base64'));

    // 3. Dimension on fully defined geometry (l1 has fixed endpoints) -> added as driven, no toast
    await clearToasts();
    await evalJs(`window.ug?.state?.selectedShapes?.clear()`);
    await pressRibbonTool(evalJs, clickPt, 'tool-dim');
    await waitFor(`document.getElementById('tool-dim')?.classList.contains('active')`, 'Dimension tool active');
    const lp = await onLine('l1', 0.5);
    await clickPt(lp);
    await clickPt({ x: lp.x, y: lp.y - 40 });
    await flushAutosave();
    await sleep(300);
    const dims = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const cur = await m.getProjectStore().loadCurrent({ app: 'sketchstudio' });
      return cur.document.geometry.constraints.filter((c) => c.type === 'distance').map((c) => ({ isDriven: !!(c.isDriven || c.driven) })); })`);
    assert.strictEqual(dims.length, 1, `[${label}] 3: dimension added`);
    assert.strictEqual(dims[0].isDriven, true, `[${label}] 3: dimension added as driven`);
    assert.deepStrictEqual(await toasts(), [], `[${label}] 3: no toast for driven dimension`);

    console.log(`[${label}] PASS`);
  } finally {
    await close();
    fs.rmSync(dlDir, { recursive: true, force: true });
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
