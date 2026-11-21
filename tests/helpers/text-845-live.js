// tests/helpers/text-845-live.js — TASK 845: the TEXT tool in the REAL apps (headless Edge / Chrome via CDP, real mouse / touch / keys), shared by the
// text-845-*-live test files (one per app and layout, each short). What is read: the page's drawing (the letters are curves drawn with a
// data-shape-id <text id>_o<n>), the text editor box (.sk-text-editor), the canvas menu, and the hosts' own dev / test seams where the state is
// asserted (Shaper window.__designController, Pen Plotter window.__sketch). Screenshots to .evidence/845/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';
import { pressRibbonTool } from './ribbon-tool.js';

export const HOSTS = {
  sketchstudio: { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null, state: null },
  shaper: { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: 'design', state: 'window.__designController.state' },
  penplotter: { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: 'design', state: 'window.__sketch.controller.state' },
};
export const EVID = path.resolve('.evidence/845');

/** Opens a browser on `host` (phone: 390 x 844 touch, else 1280 x 800 mouse); returns the page tools. null: no browser installed. */
export async function openTextPage(host, { phone = false, tag = '' } = {}) {
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '845-' + host.name + (phone ? '-phone' : '') + tag, width: 1280, height: 800 });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const C = host.canvas;
  const mouse = (type, x, y, buttons, clickCount = 1, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
  const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(450); };
  const press = (p) => (phone ? tap(p) : click(p));
  const dblclick = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(180); await tap({ x: p.x + 4, y: p.y + 4 }); await sleep(300); return; }
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90);
    await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(500);
  };
  const menuAt = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(350); return; }
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 2, 1, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 'right'); await sleep(350);
  };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(350));
  const keys = { esc: () => key('Escape', 'Escape', 27), undo: () => key('z', 'KeyZ', 90, 2), redo: () => key('y', 'KeyY', 89, 2), f8: () => key('F8', 'F8', 119) };
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
  const toWorld = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: s.x, y: s.y }; })()`);
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 2 } } : {}) }); const f = path.join(EVID, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('screenshot ' + f); return f; };
  // the letters drawn on the Design canvas: { n, ids (their text ids), box (screen) }
  const letters = () => evalJs(`(() => { const els = [...document.querySelectorAll('${C} [data-shape-id]')].filter((e) => /_o\\d+$/.test(e.dataset.shapeId));
    const ids = [...new Set(els.map((e) => e.dataset.shapeId.replace(/_o\\d+$/, '')))];
    if (!els.length) return { n: 0, ids, box: null };
    const rs = els.map((e) => e.getBoundingClientRect()); const box = { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
    box.width = box.r - box.x; box.height = box.b - box.y; return { n: els.length, ids, box, types: [...new Set(els.map((e) => e.localName))] }; })()`);
  const editor = () => evalJs(`(() => { const e = document.querySelector('.sk-text-editor'); if (!e) return null; const r = e.getBoundingClientRect();
    return { text: e.querySelector('textarea').value, font: e.querySelector('.sk-text-font').value, size: e.querySelector('.sk-text-size').value, note: e.querySelector('.sk-text-note').textContent,
      focused: document.activeElement === e.querySelector('textarea'), box: { x: r.left, y: r.top, width: r.width, height: r.height }, label: e.getAttribute('aria-label') }; })()`);
  const centreOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y); return { x, y, h: r.height, w: r.width, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const pressEl = async (sel) => { const p = await centreOf(sel); assert.ok(p && p.onTop, `${sel} on screen and not covered: ${JSON.stringify(p)}`); await press(p); return p; };
  // the editor's fields: the user's own typing (focus, select all, the typed text arrives as an input event)
  const typeInto = async (sel, text) => { await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`); await send('Input.insertText', { text }); await sleep(300); };
  // a font picked in the editor's font list (the native list popup is the browser's own: its choice arrives as a change event)
  const pickFont = async (name) => { await evalJs(`(() => { const s = document.querySelector('.sk-text-font'); s.focus(); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300); };
  const ribbon = (id) => pressRibbonTool(evalJs, press, id);
  const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`);
  const menuRow = (id) => evalJs(`(() => { const e = document.querySelector('.sk-context-menu .sk-context-item[data-id="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; })()`);
  const stateJs = (body) => (host.state ? evalJs(`(() => { const st = ${host.state}; ${body} })()`) : Promise.resolve(null));
  const showStage = async (tab) => {
    if (!phone) { await evalJs(`document.querySelector('.sk-header-tab[data-tab="${tab}"]').click()`); await sleep(500); return; }
    if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await pressEl('.sk-sidebar-chevron');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
    await pressEl(`.sk-sidebar-stage[data-tab="${tab}"]`); await sleep(500);
  };
  const open = async () => {
    await installFakeDriveSession(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(400); await showStage(host.show); }
    await waitForApp(host.canvasId); await sleep(400);
  };
  /** Text tool (its ribbon button), a press at screen point p, the text typed in the box that opens there. -> the editor read after typing. */
  const placeText = async (p, text) => {
    await ribbon('tool-text');
    await press(p);
    await waitFor(`!!document.querySelector('.sk-text-editor')`, host.name + ': the text editor opens at the press');
    const ed = await editor();
    assert.ok(ed.focused, host.name + ': the text box has the keyboard');
    await send('Input.insertText', { text });
    await waitFor(`[...document.querySelectorAll('${C} [data-shape-id]')].some((e) => /_o\\d+$/.test(e.dataset.shapeId))`, host.name + ': the letters drawn while typing', 15000);
    await sleep(300);
    return editor();
  };
  return { cdp, send, evalJs, waitFor, mouse, T, tap, click, press, dblclick, menuAt, key, keys, toScreen, toWorld, shot, letters, editor, centreOf, pressEl, typeInto, pickFont,
    ribbon, menuIds, menuRow, stateJs, showStage, open, placeText, phone, close: () => cdp.close() };
}
