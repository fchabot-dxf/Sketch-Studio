// tests/audits/files-audit-1024-kit.js — TASK 1024 (AUDIT ONLY, outside the gate)
// Shared live headless-browser driver for the files / documents audit. Real clicks and keys, the app's own dialogs and its real file-chooser fallback.
// SAFETY: the fake Google session only (tests/helpers/fake-drive-session.js), every non-local request blocked and counted (tests/helpers/block-remote.js).
// The browser has no File System Access API (as Firefox / Safari / phones): Save writes a DOWNLOAD (read at once), Open is an <input type=file>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sendRealKey, sleep } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { blockRemote } from '../helpers/block-remote.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';

export { sleep };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const EVID_DIR = path.join(REPO_ROOT, '.evidence', '1024');
export const FIX_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'files-1024');
fs.mkdirSync(EVID_DIR, { recursive: true });

export const row = (id, text) => console.log(`ROW ${id} | ${text}`);
export const CANVAS = { sketchstudio: 'svgCanvas', penplotter: 'design-canvas', trace: 'design-canvas', shaper: 'design-canvas' };

/** Deep field-by-field diff of two JSON values: [{ path, a, b }] (numbers equal within tol). */
export function diffJson(a, b, p = '', out = [], tol = 1e-9) {
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > tol) out.push({ path: p, a, b }); return out; }
  if (a === b) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path: p, a: 'array?' + Array.isArray(a), b: 'array?' + Array.isArray(b) }); return out; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) out.push({ path: `${p}.${k}`, a: undefined, b: JSON.stringify(b[k]).slice(0, 80) });
      else if (!(k in b)) out.push({ path: `${p}.${k}`, a: JSON.stringify(a[k]).slice(0, 80), b: undefined });
      else diffJson(a[k], b[k], `${p}.${k}`, out, tol);
    }
    return out;
  }
  out.push({ path: p, a, b });
  return out;
}
export const summariseDiff = (d, n = 8) => (d.length ? `${d.length} diffs: ` + d.slice(0, n).map((x) => `${x.path}: ${JSON.stringify(x.a)} -> ${JSON.stringify(x.b)}`).join(' ; ') + (d.length > n ? ' ; ...' : '') : '0 diffs');

export async function startKit({ tag = '1024', width = 1280, height = 800, signedIn = false } = {}) {
  const cdp = await launchBrowser({ tag, width, height });
  if (!cdp) throw new Error('No headless Chrome/Edge browser installed');
  const { port, send, evalJs, waitFor, navigate, waitForApp, once } = cdp;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-1024-dl-'));
  const net = await blockRemote(cdp);
  const fake = await installFakeDriveSession(cdp, { signedIn });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showSaveFilePicker; delete window.showOpenFilePicker; delete window.showDirectoryPicker;' });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const k = { cdp, port, send, evalJs, waitFor, navigate, waitForApp, once, dl, net, fake, touch: false };

  const downloads = [], begun = new Map();
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.downloadWillBegin') begun.set(m.params.guid, m.params.suggestedFilename);
    if (m.method === 'Page.downloadProgress' && m.params.state === 'completed' && begun.has(m.params.guid)) {
      const name = begun.get(m.params.guid); begun.delete(m.params.guid);
      try { downloads.push({ name, text: fs.readFileSync(path.join(dl, name), 'utf8') }); } catch (e) { downloads.push({ name, text: null, error: e.message }); }
    }
  });
  k.downloads = downloads;
  k.waitDownload = async (n, what, ms = 8000) => { const end = Date.now() + ms; while (downloads.length < n) { if (Date.now() > end) return null; await sleep(50); } return downloads[n - 1]; };

  k.center = async (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  k.click = async (x, y) => {
    if (k.touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] }); await sleep(40);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250); return;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(180);
  };
  /** Click the centre of `sel`; false when it is not there / not shown. */
  k.press = async (sel) => { const c = await k.center(sel); if (!c) return false; await k.click(c.x, c.y); return true; };
  k.typeText = async (text) => { for (const ch of text) { if (/^[a-zA-Z0-9 ]$/.test(ch)) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); else await send('Input.insertText', { text: ch }); } await sleep(60); }; // a punctuation key code can collide with a control key (46 = Delete): such characters go in as text
  k.key = async (key, { ctrl = false, shift = false } = {}) => {
    const map = { Enter: [13, '\r'], Escape: [27, ''], Tab: [9, ''], ArrowRight: [39, ''], ArrowLeft: [37, ''], ArrowDown: [40, ''], Home: [36, ''], End: [35, ''], Delete: [46, ''] };
    const mods = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    if (map[key]) await sendRealKey(send, key, key, map[key][0], mods, map[key][1]);
    else await sendRealKey(send, key, 'Key' + key.toUpperCase(), key.toUpperCase().charCodeAt(0), mods, ctrl ? '' : key);
    await sleep(120);
  };
  k.ctrlS = () => k.key('s', { ctrl: true });
  k.ctrlZ = () => k.key('z', { ctrl: true });
  k.ctrlShiftZ = () => k.key('z', { ctrl: true, shift: true });
  k.esc = () => k.key('Escape');
  k.enter = () => k.key('Enter');
  k.menu = async (action) => {
    if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await k.press(k.touch ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu open');
    await sleep(250);
    return k.press(`[data-action="${action}"]`);
  };
  k.dialog = () => evalJs(`(() => { const d = document.querySelector('.sk-fd'); if (!d) return null; const b = d.getBoundingClientRect(); return { mode: d.dataset.fileDialog, tab: d.dataset.fdTab, name: (d.querySelector('input') || {}).value, err: (d.querySelector('.sk-tp-err') || {}).textContent, confirm: d.querySelector('[data-fd="confirm"]') && !d.querySelector('[data-fd="confirm"]').hidden ? d.querySelector('[data-fd-confirm] , .sk-fd-confirm-msg').textContent : null, focus: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null, rect: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }, tabs: [...d.querySelectorAll('[role=tab]')].map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')), buttons: [...d.querySelectorAll('.sk-tp-actions button, .sk-fd-panel:not([hidden]) button')].filter((x) => x.offsetParent).map((x) => x.textContent) }; })()`);
  k.modal = () => evalJs(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== 'hidden'; }).pop(); if (!d) return null; return { label: d.getAttribute('aria-label'), text: d.textContent.replace(/\\s+/g, ' ').trim().slice(0, 240), buttons: [...d.querySelectorAll('button')].filter((x) => x.offsetParent).map((x) => (x.dataset.choice || x.dataset.action || '') + ':' + x.textContent.trim()) }; })()`);
  k.chooseFile = async (file) => {
    const chooser = once('Page.fileChooserOpened');
    const ok = await k.press('.sk-fd [data-fd="choose-file"]');
    if (!ok) return false;
    const fc = await Promise.race([chooser, sleep(5000).then(() => null)]);
    if (!fc) return false;
    await send('DOM.setFileInputFiles', { files: [file], backendNodeId: fc.backendNodeId });
    return true;
  };
  k.tabs = () => evalJs(`[...document.querySelectorAll('.sk-doctab')].map((t) => ({ key: t.dataset.key, name: t.querySelector('.sk-doctab-name').textContent, active: t.classList.contains('active'), home: (t.querySelector('.sk-doctab-home') || {}).dataset ? (t.querySelector('.sk-doctab-home') || {}).dataset.home : null, dot: !!t.querySelector('.sk-doctab-dot'), dotCls: (t.querySelector('.sk-doctab-dot') || {}).className || null }))`);
  k.active = async () => (await k.tabs()).find((t) => t.active) || null;
  k.shapes = (canvas = 'svgCanvas') => evalJs(`document.querySelectorAll('#${canvas} .shape-elem[data-shape-id]').length`);
  k.shapeKinds = (canvas = 'svgCanvas') => evalJs(`(() => { const o = {}; document.querySelectorAll('#${canvas} .shape-elem[data-shape-id]').forEach((e) => { const t = e.tagName.toLowerCase(); o[t] = (o[t] || 0) + 1; }); return o; })()`);
  k.toasts = () => evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map((e) => '[' + e.dataset.level + '] ' + e.textContent.trim())`);
  k.clearToasts = () => evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove())`);
  k.undoState = () => evalJs(`(() => { const u = document.querySelector('#btn-undo, button[aria-label="Undo"]'), r = document.querySelector('#btn-redo, button[aria-label="Redo"]'); return { canUndo: u ? !u.disabled : null, canRedo: r ? !r.disabled : null }; })()`);
  k.setting = (key, value) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set(${JSON.stringify(key)}, ${JSON.stringify(value)}, { persist: 'local' }); return m.default.get(${JSON.stringify(key)}); })`);
  k.readSetting = (key) => evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.get(${JSON.stringify(key)}))`);
  /** the shared buffer as the app stored it: { active, tabs: [{ key, name, designId, doc, file }] } (docs kept whole) */
  k.buffer = () => evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const b = await m.getProjectStore().readBuffer({}); return b ? JSON.parse(JSON.stringify({ active: b.active, tabs: (b.tabs || []).map((t) => ({ key: t.key, name: t.name, designId: t.designId, doc: t.doc, file: t.file, history: undefined })) })) : null; })`);
  k.flush = async () => { await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(400); };
  k.reset = () => resetBufferLive(cdp);
  k.open = async (app = 'sketchstudio', { reset = true } = {}) => {
    if (reset) await k.reset();
    await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 12000);
    await waitForApp(CANVAS[app]);
    await sleep(350);
  };
  k.reload = async (app = 'sketchstudio') => { await k.flush(); await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 12000); await waitForApp(CANVAS[app]); await sleep(350); };
  k.phone = async (on) => {
    k.touch = !!on;
    if (on) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); }
    else { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); }
  };
  /** screenshot of a selector's box (cropped), saved under .evidence/1024 with its md5 */
  k.shot = async (name, sel, pad = 10) => {
    await sleep(150);
    const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; })()`);
    if (!r) return null;
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(r.vw - x, r.w + 2 * pad), height: Math.min(r.vh - y, r.h + 2 * pad), scale: 1 } });
    const buf = Buffer.from(s.data, 'base64');
    fs.writeFileSync(path.join(EVID_DIR, name), buf);
    return `.evidence/1024/${name} md5=${crypto.createHash('md5').update(buf).digest('hex')}`;
  };
  k.shotFull = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(s.data, 'base64');
    fs.writeFileSync(path.join(EVID_DIR, name), buf);
    return `.evidence/1024/${name} md5=${crypto.createHash('md5').update(buf).digest('hex')}`;
  };
  /** draw one line through real pointer events in the Design canvas (fy: vertical fraction) */
  k.drawLine = async (canvas = 'svgCanvas', fy = 0.4) => {
    await evalJs(`(() => { const b = document.getElementById('tool-line') || document.querySelector('[data-tool="line"]'); b.click(); })()`); await sleep(120);
    const r = await evalJs(`(() => { const b = document.getElementById(${JSON.stringify(canvas)}).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await k.click(Math.round(r.x + r.w * 0.35), Math.round(r.y + r.h * fy)); await k.click(Math.round(r.x + r.w * 0.6), Math.round(r.y + r.h * (fy + 0.1)));
    await k.esc(); await sleep(120);
  };
  k.close = async () => {
    try { fs.rmSync(dl, { recursive: true, force: true }); } catch (_) { /* temp dir already gone */ }
    await cdp.close();
  };
  return k;
}
