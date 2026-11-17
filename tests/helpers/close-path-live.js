// tests/helpers/close-path-live.js — TASK 760: CLOSE PATH in the REAL apps (headless Edge / Chrome via CDP, real mouse / touch / keys), shared by the
// close-path-760-*-live test files (one per app and phase, each short). Every phase drops the fixture tests/fixtures/svg/close-path-760-engraving.svg
// (a 30 x 20 mm plate drawn 0.08 mm short of closed + an open engraving zigzag) on the app's Design canvas, as a user drops a file.
// What is read: the page's drawing (the shapes' data-shape-id elements, the open-end markers .open-end-marker, the toasts of #notification-container);
// Shaper's own dev / test seam (window.__designController) where the loops are asserted.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';
import { pressRibbonTool } from './ribbon-tool.js';

export const FIXTURE = fs.readFileSync(path.resolve('tests/fixtures/svg/close-path-760-engraving.svg'), 'utf8');
export const IMPORTED = 8; // 4 engraving lines + 4 plate lines
export const OFFER_TEXT = '1 outline is almost closed (largest gap 0.08 mm) · 1 open path left open';
export const HOSTS = {
  sketchstudio: { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null },
  shaper: { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="design"]').click()` },
  penplotter: { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="design"]').click()` },
  trace: { name: 'trace', url: '/apps/trace/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="edit"]').click()` },
};

/** Opens a browser on `host` (phone: 390 x 844 touch, else 1280 x 800 mouse), drops the fixture; returns the page tools. null: no browser installed. */
export async function openClosePathPage(host, { phone = false, tag = '' } = {}) {
  const EVID = path.resolve('.evidence/760');
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '760-' + host.name + (phone ? '-phone' : '') + tag, width: 1280, height: 800 });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const C = host.canvas;
  const mouse = (type, x, y, buttons, clickCount = 1, modifiers = 0, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), modifiers, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
  const click = async (p, modifiers = 0) => { await mouse('mouseMoved', p.x, p.y, 0, 0, modifiers); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1, modifiers); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, modifiers); await sleep(450); };
  const press = (p) => (phone ? tap(p) : click(p));
  // a MIDDLE-button drag: the canvas pan (pan-zoom.js)
  const panDrag = async (a, b, steps = 10) => { const m = (type, p, buttons) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: 'middle', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }); await mouse('mouseMoved', a.x, a.y, 0); await sleep(40); await m('mousePressed', a, 4); await sleep(40); for (let i = 1; i <= steps; i++) { await m('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, 4); await sleep(20); } await m('mouseReleased', b, 0); await sleep(350); };
  const dblclick = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(180); await tap({ x: p.x + 5, y: p.y + 5 }); await sleep(200); return; } // the second tap within the double-tap time
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90);
    await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(500);
  };
  const menuAt = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(300); return; }
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 2, 1, 0, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 0, 'right'); await sleep(350);
  };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(350));
  const keys = {
    closePath: () => key('C', 'KeyC', 67, 8, 'C'), select: () => key('s', 'KeyS', 83, 0, 's'), esc: () => key('Escape', 'Escape', 27),
    undo: () => key('z', 'KeyZ', 90, 2), // Ctrl+Z
  };
  // the page's drawing
  const shapeCount = () => evalJs(`new Set([...document.querySelectorAll('${C} [data-shape-id], #pen-underlay [data-shape-id]')].map((e) => e.dataset.shapeId)).size`);
  const markers = () => evalJs(`document.querySelectorAll('${C} .open-end-marker').length`);
  const offer = () => evalJs(`(() => { const t = [...document.querySelectorAll('#notification-container > div')].find((d) => d.querySelector('.notif-action-btn') && d.style.opacity !== '0');
    if (!t) return null; const b = t.querySelector('.notif-action-btn').getBoundingClientRect(), r = t.getBoundingClientRect();
    return { text: t.querySelector('pre').textContent, label: t.querySelector('.notif-action-btn').textContent, btn: { x: b.left + b.width / 2, y: b.top + b.height / 2, h: b.height },
      clip: { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 } }; })()`);
  // world (mm) -> screen through the canvas's own CTM (its user space is the world)
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
  const pxPerMm = () => evalJs(`document.querySelector('${C}').getScreenCTM().a`);
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 2 } } : {}) }); const f = path.join(EVID, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('screenshot ' + f); return f; };
  const worldClip = async (x0, y0, x1, y1, pad = 30) => { const a = await toScreen(x0, y0), b = await toScreen(x1, y1); const x = Math.max(0, Math.min(a.x, b.x) - pad), y = Math.max(0, Math.min(a.y, b.y) - pad); return { x, y, width: Math.abs(b.x - a.x) + 2 * pad, height: Math.abs(b.y - a.y) + 2 * pad }; };
  const wheel = async (p, deltaY, n) => { for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(p.x), y: Math.round(p.y), deltaX: 0, deltaY }); await sleep(60); } await sleep(300); };
  const ribbon = (id) => pressRibbonTool(evalJs, press, id);
  const toolActive = () => evalJs(`(() => { const b = document.getElementById('tool-closePath'); const sec = b && b.closest('.sk-ribbon-group'); return !!b && (b.classList.contains('active') || (!!sec && sec.querySelector('.sk-ribbon-group-label').classList.contains('active'))); })()`);
  const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`);
  const menuRow = (id) => evalJs(`(() => { const e = document.querySelector('.sk-context-menu .sk-context-item[data-id="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; })()`);

  const open = async () => {
    await installFakeDriveSession(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(400); await evalJs(host.show); }
    await waitForApp(host.canvasId); await sleep(400);
    const before = await shapeCount();
    await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(FIXTURE)}], 'close-path-760-engraving.svg', { type: 'image/svg+xml' })); const c = document.querySelector('${C}');
      c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`new Set([...document.querySelectorAll('${C} [data-shape-id], #pen-underlay [data-shape-id]')].map((e) => e.dataset.shapeId)).size >= ${before + IMPORTED}`, host.name + ': the dropped file drawn');
    await sleep(500);
    return before;
  };
  return { cdp, send, evalJs, waitFor, mouse, T, tap, click, press, panDrag, dblclick, menuAt, keys, shapeCount, markers, offer, toScreen, pxPerMm, shot, worldClip, wheel, ribbon, toolActive, menuIds, menuRow, open, close: () => cdp.close() };
}

/** The smoke every app runs (desktop): the offer notice, the open ends marked by Shift+C, the ribbon button beside Break, Close them closes the plate. */
export async function closePathSmoke(host) {
  const t = await openClosePathPage(host);
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const out = {};
  try {
    const base = await t.open();
    const o = await t.offer();
    assert.ok(o, host.name + ': the import shows the offer notice');
    out.offer = [o.text, o.label];
    assert.deepStrictEqual(out.offer, [OFFER_TEXT, 'Close them'], host.name + ': its text and action');
    assert.strictEqual(await t.shapeCount(), base + IMPORTED, host.name + ': nothing closed by the import');
    out.order = await t.evalJs(`[...document.querySelectorAll('.sk-ribbon-group[data-section="modify"] .sk-ribbon-btn')].map((b) => b.id)`);
    assert.strictEqual(out.order[out.order.indexOf('tool-break') + 1], 'tool-closePath', host.name + ': the Close path button right after Break: ' + out.order);
    await t.keys.closePath();
    out.markers = await t.markers();
    assert.ok(await t.toolActive(), host.name + ': Shift+C switched to Close path');
    assert.strictEqual(out.markers, 4, host.name + ': the 4 open ends are marked (the plate\'s 2, the engraving\'s 2)');
    await t.keys.select();
    assert.strictEqual(await t.markers(), 0, host.name + ': no marker with the Select tool');
    const o2 = await t.offer();
    assert.ok(o2, host.name + ': the offer is still there');
    await t.click(o2.btn);
    out.after = await t.shapeCount();
    assert.strictEqual(out.after, base + IMPORTED + 1, host.name + ': Close them added the one closing line');
    assert.strictEqual(await t.offer(), null, host.name + ': the offer is gone');
    await t.keys.closePath();
    out.markersAfter = await t.markers();
    assert.strictEqual(out.markersAfter, 2, host.name + ': only the engraving line\'s 2 ends are still open');
    await t.keys.select();
    console.log(`close-path-760 smoke ${host.name}: ALL CHECKS PASSED ${JSON.stringify(out)}`);
    return out;
  } finally { await t.close(); }
}
