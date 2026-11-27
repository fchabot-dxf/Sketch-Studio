// tests/delete-point-rule-1044-live.test.js — TASK 1044 THE POINT RULE in the REAL SketchStudio page (headless Edge / Chrome via CDP, real mouse,
// touch and keys), desktop 1280 x 800 and phone 390 x 844: a line's END selected, then Delete by the key (desktop), the footer red X and the
// right-click / touch-and-hold menu's Delete (and Trace's edit view, desktop: the same shared Design canvas): the line stays and the hint "Select the line to delete it, or the corner mark to separate." shows;
// the ORIGIN selected: the footer red X is ENABLED (it agrees with the key: audit O-08b / O-08c) and its press shows "The origin can't be
// deleted."; the line itself still deletes (the control). Screenshots of the hints in .evidence/1044/ (local only).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const CURVE_HINT = 'Select the line to delete it, or the corner mark to separate.';
const ORIGIN_HINT = "The origin can't be deleted.";
const EVID = path.resolve('.evidence/1044'); fs.mkdirSync(EVID, { recursive: true });
const cdp = await launchBrowser({ tag: '1044-delete', width: 1280, height: 800 });
if (!cdp) { console.log('delete-point-rule-1044-live: skipped (no headless Edge/Chrome binary installed)'); process.exit(0); }
const { port, send, evalJs, navigate, waitForApp } = cdp;
let C = '#svgCanvas';
let phone = false;
const mouse = (type, x, y, buttons, clickCount = 1, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(300); };
const press = (p) => (phone ? tap(p) : click(p));
const menuAt = async (p) => {
  if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(300); return; }
  await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 2, 1, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 'right'); await sleep(350);
};
const key = (k, code, vk, mods = 0) => sendRealKey(send, k, code, vk, mods, '').then(() => sleep(300));
const esc = () => key('Escape', 'Escape', 27);
const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
const shapes = () => evalJs(`new Set([...document.querySelectorAll('${C} [data-shape-id]')].map((e) => e.dataset.shapeId)).size`);
const toast = () => evalJs(`(document.getElementById('notification-container') || { textContent: '' }).textContent`);
const clearToasts = () => evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; return true; })()`);
const footerDisabled = () => evalJs(`document.getElementById('btn-delete-selection').disabled`);
const menuRow = (id) => centre(`.sk-context-menu .sk-context-item[data-id="${id}"]`);
const shotToast = async (name) => {
  const r = await centre('#notification-container .notification, #notification-container > *');
  const W = phone ? 390 : 1280;
  const clip = r ? { x: Math.max(0, r.x - r.w / 2 - 12), y: Math.max(0, r.y - r.h / 2 - 12), width: Math.min(W, r.w + 24), height: r.h + 24, scale: 2 } : null;
  const res = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const b = Buffer.from(res.data, 'base64'); fs.writeFileSync(path.join(EVID, name), b);
  return `${name} md5 ${crypto.createHash('md5').update(b).digest('hex')}`;
};

const HOSTS = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null },
  trace: { url: '/apps/trace/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="edit"]').click()` },
};
async function openPage(isPhone, host) {
  phone = isPhone; C = host.canvas;
  await installFakeDriveSession(cdp);
  if (phone) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  else { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); }
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
  if (host.show) { await sleep(400); await evalJs(host.show); }
  await waitForApp(host.canvasId); await sleep(500);
}

try {
  for (const [hostName, isPhone] of [['sketchstudio', false], ['sketchstudio', true], ['trace', false]]) {
    const P = `${hostName} ${isPhone ? 'phone 390x844' : 'desktop 1280x800'}`;
    await openPage(isPhone, HOSTS[hostName]);
    const r = await centre(C);
    const A = { x: r.x - 80, y: r.y - 70 }, B = { x: r.x + 80, y: r.y - 70 }, mid = { x: r.x, y: r.y - 70 };
    await pressRibbonTool(evalJs, press, 'tool-line');
    await press(A); await press(B); await esc(); await esc();
    await pressRibbonTool(evalJs, press, 'tool-select'); await sleep(200);
    assert.strictEqual(await shapes(), 1, `${P}: the line is drawn`);

    const paths = [['footer red X', async () => { assert.strictEqual(await footerDisabled(), false, `${P}: the red X is enabled for the selected end (it answers with the hint)`); await press(await centre('#btn-delete-selection')); }],
      [isPhone ? 'touch-and-hold menu Delete' : 'right-click menu Delete', async () => { await menuAt(B); const row = await menuRow('geo-delete'); assert(row, `${P}: the end's menu has Delete`); await press(row); }]];
    if (!isPhone) paths.unshift(['Delete key', () => key('Delete', 'Delete', 46)]);
    for (const [name, del] of paths) {
      await esc(); await press(B); await clearToasts();
      await del(); await sleep(250);
      assert.strictEqual(await shapes(), 1, `${P} ${name}: the line END + Delete deletes nothing`);
      const t = await toast();
      assert(t.includes(CURVE_HINT), `${P} ${name}: the hint shows (got "${t}")`);
      console.log(`ok   ${P} ${name}: the end + Delete: nothing deleted, hint "${CURVE_HINT}"`);
    }
    console.log(`ok   ${P}: ${await shotToast(`hint-curve-${hostName}-${isPhone ? 'phone' : 'desktop'}.png`)}`);

    // the origin: the red X agrees with the key (both: nothing, the origin's hint)
    const org = await toScreen(0, 0);
    for (const name of isPhone ? ['footer red X'] : ['Delete key', 'footer red X']) {
      await esc(); await press(org); await clearToasts();
      if (name === 'Delete key') await key('Delete', 'Delete', 46);
      else { assert.strictEqual(await footerDisabled(), false, `${P}: the red X is enabled with the origin selected`); await press(await centre('#btn-delete-selection')); }
      await sleep(250);
      assert.strictEqual(await shapes(), 1, `${P} origin ${name}: nothing deleted`);
      const t = await toast();
      assert(t.includes(ORIGIN_HINT), `${P} origin ${name}: the origin's hint (got "${t}")`);
      console.log(`ok   ${P} origin + ${name}: nothing deleted, hint "${ORIGIN_HINT}"`);
    }
    console.log(`ok   ${P}: ${await shotToast(`hint-origin-${hostName}-${isPhone ? 'phone' : 'desktop'}.png`)}`);

    // the control: the line itself still deletes, with no hint
    await esc(); await press(mid); await clearToasts();
    await press(await centre('#btn-delete-selection')); await sleep(250);
    assert.strictEqual(await shapes(), 0, `${P}: the line selected + the red X deletes it`);
    assert(!(await toast()).includes(CURVE_HINT), `${P}: no hint when something was deleted`);
    console.log(`ok   ${P}: the line itself still deletes, no hint`);
  }
  console.log('delete-point-rule-1044-live: ok');
} finally {
  await cdp.close();
}
