// tests/parameters-reference-789-live.test.js - TASK 789 bug 6 (hunt 784 #6, live headless, REAL mouse via CDP, SketchStudio): the Parameters (fx)
// window shows what a REFERENCE dimension measures NOW. A line 37 long with a reference (driven) distance on it is dragged to about 86.5 with the
// window open: its row's Value reads the new length, the same text as the canvas label (before: the label followed, the row stayed "(37.0)").
// A reference radius on a circle dragged bigger follows too. Screenshots of the window + canvas: .evidence/789/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const EVID = path.join(process.cwd(), '.evidence', '789');
const DOC = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 37, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c1', { x: 20, y: 40, fixed: true, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'cir1', type: 'circle', joints: ['c1'], radius: 10, sketchId: 'sketch-1' },
    ],
    constraints: [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'distance', joints: ['a', 'b'], value: 37, offset: -12, name: 'd1', isDriven: true, driven: true },
      { type: 'distance', shape: 'cir1', isRadius: true, value: 10, name: 'd2', isDriven: true, driven: true },
    ],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

await (async () => {
  const cdp = await launchBrowser({ tag: '789', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    await installFakeDriveSession({ ws: cdp.ws, send, evalJs });
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(80); };
    const click = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); };
    const drag = async (a, b) => { await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= 12; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12, 1); await sleep(30); } await mouse('mouseReleased', b.x, b.y, 0); await sleep(400); };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const rowValue = (name) => evalJs(`(() => { const r = document.querySelector('.sk-pwin tr.sk-ptable-row[data-name="${name}"]'); return r ? [...r.children].map((c) => { const i = c.querySelector('input'); return i ? i.value : c.textContent; }) : null; })()`);
    const labels = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map((e) => e.textContent.trim()))`).then(JSON.parse);
    // the autosaved design (SketchStudio keeps its state to itself: the stored document is what the page holds after a flush)
    const stored = async () => { await cdp.flushAutosave(); return JSON.parse(await evalJs(`import('/packages/ui/project-store.js').then(async ({ getProjectStore }) => { const s = getProjectStore(); const r = await s.get(await s.currentId()); return JSON.stringify(r.document.geometry); })`)); };
    const joint = async (id) => Object.fromEntries((await stored()).joints)[id];
    const shot = async (file) => {
      const r = await evalJs(`(() => { const a = document.querySelector('.sk-pwin').getBoundingClientRect(); const s = document.getElementById('svgCanvas').getBoundingClientRect(); const l = Math.max(s.left, Math.min(a.left, s.left + s.width * 0.25)); return { x: l, y: s.top, w: Math.min(1600 - l, a.right + 20 - l), h: Math.min(900 - s.top, Math.max(a.bottom, s.top + s.height * 0.75) - s.top) }; })()`);
      const p = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1.5 } });
      const buf = Buffer.from(p.data, 'base64'); fs.writeFileSync(path.join(EVID, file), buf);
      return createHash('md5').update(buf).digest('hex').toUpperCase();
    };

    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url); await waitForApp('svgCanvas');
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await navigate(url); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Reference 789', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url); await waitForApp('svgCanvas');
    await waitFor(`document.querySelectorAll('#svgCanvas .dim-label').length === 2`, 'the design to load (its two dimension labels)');
    await sleep(400);

    // open the Parameters window (footer fx button), Select tool
    await click(await centerOf('#btn-parameters'));
    await waitFor(`!!document.querySelector('.sk-pwin tr.sk-ptable-row[data-name="d1"]')`, 'the d1 row');
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
    let r1 = await rowValue('d1');
    console.log('before drag: d1 row', JSON.stringify(r1), 'labels', JSON.stringify(await labels()));
    // the canvas labels: the line's distance and the circle's radius ('R ' + the value); a row's Value cell (index 2) shows the value alone
    const lineLabel = async () => (await labels()).find((t) => !t.startsWith('R'));
    const radiusLabel = async () => ((await labels()).find((t) => /^\(?R/.test(t)) || '').replace(/^\(R\s*(.*)\)$/, '($1)').replace(/^R\s*/, '');   // R2-11: a reference reads (R 15) -> (15)
    assert.strictEqual(r1[2].trim(), await lineLabel(), 'before: the d1 row reads what the canvas label reads');
    assert.strictEqual(r1[2].trim(), '(37)', 'before: 37');
    const before = await shot('fx-reference-before.png');

    // drag the free end b from 37 to about 86.5 along the line (it stays horizontal)
    await drag(await toScreen(37, 0), await toScreen(86.5, 0));
    const b = await joint('b');
    const len = Math.hypot(b.x, b.y);
    assert(len > 70, 'the line got longer: ' + len.toFixed(3));
    const lab = await lineLabel();
    r1 = await rowValue('d1');
    console.log('after drag: length', len.toFixed(3), 'd1 row', JSON.stringify(r1), 'labels', JSON.stringify(await labels()));
    assert(Math.abs(parseFloat(lab.replace(/[()]/g, '')) - len) < 0.06, `the canvas label follows the drag (${lab} vs ${len.toFixed(3)})`);
    assert.strictEqual(r1[2].trim(), lab, 'the d1 row reads the same as the canvas label after the drag');

    // a reference radius: drag the circle's rim out (10 -> about 16)
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
    await drag(await toScreen(30, 40), await toScreen(36, 40));
    const r = (await stored()).shapes.find((x) => x.id === 'cir1').radius;
    const r2 = await rowValue('d2');
    console.log('after rim drag: radius', r.toFixed(3), 'd2 row', JSON.stringify(r2));
    assert(r > 12, 'the circle got bigger: ' + r);
    const rl = await radiusLabel();
    assert(Math.abs(parseFloat(rl.replace(/[()]/g, '')) - r) < 0.06, `the canvas radius label follows (${rl} vs ${r.toFixed(3)})`);
    assert.strictEqual(r2[2].trim(), rl, 'the d2 row reads the same as the canvas radius label after the drag');
    const after = await shot('fx-reference-after.png');
    console.log(`screenshots: .evidence/789/fx-reference-before.png md5 ${before}, fx-reference-after.png md5 ${after}`);
    console.log('PASS parameters-reference-789-live');
  } finally {
    await cdp.close();
  }
})();
