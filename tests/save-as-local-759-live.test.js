// tests/save-as-local-759-live.test.js — TASK 759 (owner turn 2266): SIGNED OUT, a design is saved to and opened from this device with no Google account, in a real
// browser. The FAKE Google session only (tests/helpers/fake-drive-session.js, signed out) and every non-local request blocked (tests/helpers/block-remote.js:
// the count is printed). This browser is made one WITHOUT the File System Access API (its showSaveFilePicker / showOpenFilePicker are removed before the page
// runs: Firefox, Safari, phones), so the app's real fallback runs: Save writes a DOWNLOAD (caught in a temp folder), Open is an <input type=file> (answered
// through CDP). tests/save-as-drive-759-live.test.js covers the picker (a handle: Save writes back) and the signed-in Drive tab in Shaper.
//   SketchStudio, desktop: Ctrl+S on a new design -> THE Save as dialog on its Local tab; its Google Drive tab shows the sign-in button (no other sign-in UI
//   anywhere); Local -> a .sketch.json download that parses and holds the drawing; the tab shows the device glyph, the strip says once that Save downloads;
//   an edit -> the dot; Ctrl+S -> downloaded again, no dot; Open… -> Local -> Choose a file -> the file opens as a NEW tab; a design file dropped on the
//   drawing opens as a tab too; a reload keeps the tabs (name only).
//   SketchStudio, phone 390: the Save as and Open dialogs fit (no sideways scroll), 44 px targets.
//   Pen Plotter and Trace (smoke): Save as -> Local downloads the file; Open -> Local opens it as a tab.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '759l', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp, once } = cdp;
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-759-dl-'));
  const t0 = Date.now();
  try {
    const net = await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: false });
    // a browser without the File System Access API (the app reads the capability at call time: #ui/project-file.js fileAccess)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showSaveFilePicker; delete window.showOpenFilePicker; delete window.showDirectoryPicker;' });
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
    await send('DOM.enable');
    await send('Page.setInterceptFileChooserDialog', { enabled: true });

    const shot = async (name, sel, pad = 12) => {
      if (!EVID) return;
      await sleep(150);
      const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      assert(r, 'screenshot target ' + sel);
      const vw = await evalJs('innerWidth'), vh = await evalJs('innerHeight');
      const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
      const clip = { x, y, width: Math.min(vw - x, r.w + 2 * pad), height: Math.min(vh - y, r.h + 2 * pad), scale: 2 };
      const s = await send('Page.captureScreenshot', { format: 'png', clip });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
    };
    const center = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' exists'); return c;
    };
    let touch = false;
    const click = async (x, y) => {
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] }); await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250); return;
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const press = async (sel) => { const c = await center(sel); await click(c.x, c.y); };
    const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
    const ctrlS = () => sendRealKey(send, 's', 'KeyS', 83, 2);
    const esc = () => sendRealKey(send, 'Escape', 'Escape', 27);
    const enter = () => sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
    const menu = async (action) => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await press(touch ? '.sk-sidebar-handle' : '.sk-sidebar-btn'); // a phone: the drawer handle
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu open');
      await press(`[data-action="${action}"]`);
    };
    const canvasId = { sketchstudio: 'svgCanvas', penplotter: 'design-canvas', trace: 'design-canvas' };
    const drawLine = async (canvas, fy = 0.4) => {
      await evalJs(`(() => { const b = document.getElementById('tool-line') || document.querySelector('[data-tool="line"]'); b.click(); })()`); await sleep(120);
      const r = await evalJs(`(() => { const b = document.getElementById(${JSON.stringify(canvas)}).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.35), Math.round(r.y + r.h * fy)); await click(Math.round(r.x + r.w * 0.6), Math.round(r.y + r.h * (fy + 0.1)));
      await esc(); await sleep(120);
    };
    const shapes = (canvas) => evalJs(`document.querySelectorAll('#${canvas} .shape-elem').length`);
    const tabs = () => evalJs(`[...document.querySelectorAll('.sk-doctab')].map((t) => ({ name: t.querySelector('.sk-doctab-name').textContent, active: t.classList.contains('active'), home: (t.querySelector('.sk-doctab-home') || {}).dataset ? t.querySelector('.sk-doctab-home').dataset.home : null, dot: !!t.querySelector('.sk-doctab-dot') }))`);
    const active = async () => (await tabs()).find((t) => t.active);
    // no sign-in UI anywhere on the page but the Save as / Open dialog's Google Drive tab (and the menu's own account row, which is not open)
    const signInOutsideDriveTab = () => evalJs(`[...document.querySelectorAll('button, a, [role="button"]')].filter((b) => /sign in/i.test(b.textContent) && b.offsetParent !== null && !b.closest('[data-fd-panel="drive"]') && !b.closest('.sk-sidebar-account')).length + document.querySelectorAll('.sk-sidebar-ask').length + ([...document.querySelectorAll('.sk-toast, .notification, [role="alert"]')].filter((n) => /sign in/i.test(n.textContent)).length)`);
    // every download, read as it completes (the browser writes a download of the same name to the same path, so each is read at once): [{ name, text }]
    const downloads = [];
    const begun = new Map();
    cdp.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Page.downloadWillBegin') begun.set(m.params.guid, m.params.suggestedFilename);
      if (m.method === 'Page.downloadProgress' && m.params.state === 'completed' && begun.has(m.params.guid)) {
        const name = begun.get(m.params.guid); begun.delete(m.params.guid);
        downloads.push({ name, text: fs.readFileSync(path.join(dl, name), 'utf8') });
      }
    });
    const waitDownload = async (n, what) => { const end = Date.now() + 10000; while (downloads.length < n) { if (Date.now() > end) throw new Error('timed out waiting for the download: ' + what); await sleep(50); } return downloads[n - 1]; };
    const chooseFile = async (file, what) => {
      const chooser = once('Page.fileChooserOpened');
      await press('.sk-fd [data-fd="choose-file"]');
      const fc = await Promise.race([chooser, sleep(5000).then(() => null)]);
      assert(fc, 'the file chooser opened: ' + what);
      await send('DOM.setFileInputFiles', { files: [file], backendNodeId: fc.backendNodeId });
    };
    const app = async (id, url) => { await navigate(`http://127.0.0.1:${port}${url}`, 10000); await waitForApp(canvasId[id]); await sleep(300); };

    // ================= SketchStudio, desktop, signed out =================
    await resetBufferLive(cdp);
    await app('sketchstudio', '/apps/sketchstudio/index.html');
    const S = 'svgCanvas';
    assert.strictEqual(await signInOutsideDriveTab(), 0, 'app start: no sign-in prompt');
    assert.strictEqual(await evalJs(`typeof window.showSaveFilePicker`), 'undefined', 'this browser has no save picker (the fallback runs)');
    await drawLine(S);
    assert.strictEqual(await shapes(S), 1, 'a line drawn');
    await ctrlS();
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Ctrl+S on a new design: THE Save as dialog');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd').dataset.fdTab`), 'local', 'signed out: it opens on the Local tab');
    assert.strictEqual(await evalJs(`document.activeElement === document.querySelector('.sk-fd input')`), true, 'focus on the name');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-fd [role="tab"]')].map((t) => t.textContent)`), ['Google Drive', 'Local'], 'the two tabs');
    assert.strictEqual(await signInOutsideDriveTab(), 0, 'Ctrl+S signed out: no sign-in question');
    await shot('saveas-local-signed-out.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd-panel="drive"]:not([hidden]) [data-fd="sign-in"]')`, 'the Drive tab: the sign-in button inside it');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd-name').offsetParent === null && document.querySelector('.sk-fd [data-choice="ok"]').offsetParent === null`), true, 'signed out, Drive tab: no name field, no Save shown (a dead end is not offered)');
    await shot('saveas-drive-signed-out.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="local"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Bracket 759'); await enter();
    const f1 = await waitDownload(1, 'Save as > Local');
    assert.strictEqual(f1.name, 'Bracket 759.sketch.json', 'the file downloaded under the typed name, extension .sketch.json');
    const doc1 = parseProjectFile(f1.text);
    assert.strictEqual(doc1.app, 'sketchstudio'); assert.strictEqual(doc1.document.geometry.shapes.length, 1, 'the file parses and holds the line');
    await waitFor(`!document.querySelector('.sk-fd')`, 'the dialog closed');
    let a = await active();
    assert.deepStrictEqual([a.name, a.home, a.dot], ['Bracket 759', 'file', false], 'the tab: named after the file, the device glyph, no dot');
    const note = await waitFor(`document.querySelector('.sk-doctabs-msg').textContent`, 'the strip note');
    assert.ok(/as a download/.test(note), 'the strip says once that Save downloads the file: ' + note);
    await shot('tab-file-home-note.png', '.sk-doctabs', 0);
    // an edit: the dot; Ctrl+S downloads it again under the same name; no dialog
    await drawLine(S, 0.6);
    await waitFor(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`, 'an edit: the dot');
    await ctrlS();
    const f2 = await waitDownload(2, 'Ctrl+S of a name-only file home');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-fd')`), false, 'Ctrl+S of a file home opens no dialog');
    assert.strictEqual(f2.name, 'Bracket 759.sketch.json', 'downloaded again under the same name');
    assert.strictEqual(parseProjectFile(f2.text).document.geometry.shapes.length, 2, 'the second download holds both lines');
    await waitFor(`!document.querySelector('.sk-doctab.active .sk-doctab-dot')`, 'saved: no dot');
    // Open… -> Local -> Choose a file: the first file opens as a NEW tab
    const opened = path.join(dl, 'Opened 759.sketch.json'); fs.writeFileSync(opened, f1.text); // the FIRST save (one line)
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'THE Open dialog');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd').dataset.fdTab`), 'local', 'it opens on the tab last used (Local)');
    await shot('open-local-signed-out.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd-panel="drive"]:not([hidden]) [data-fd="sign-in"]')`, 'Open, Drive tab: the sign-in button');
    await shot('open-drive-signed-out.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="local"]');
    await chooseFile(opened, 'Open > Local');
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2 && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Opened 759'`, 'the file opened as a new tab');
    assert.strictEqual(await shapes(S), 1, 'it shows the file\'s one line');
    a = await active(); assert.deepStrictEqual([a.home, a.dot], ['file', false], 'its home is the file, no dot');
    assert.strictEqual(await evalJs(`document.title`), 'Opened 759 — Sketch', 'the page title names the file\'s design');
    // a design file dropped on the drawing opens as a tab (the import drop target)
    await evalJs(`(() => { const text = ${JSON.stringify(fs.readFileSync(opened, 'utf8'))}; const dt = new DataTransfer(); dt.items.add(new File([text], 'Dropped 759.sketch.json', { type: 'application/json' }));
      const svg = document.getElementById('svgCanvas'); for (const type of ['dragover', 'drop']) svg.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 3 && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Dropped 759'`, 'a dropped design file opened as a tab');
    assert.strictEqual(await shapes(S), 1, 'the dropped file: one line (not imported into the shown design)');
    // a reload: the tabs come back with their home, by name only
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(300);
    await app('sketchstudio', '/apps/sketchstudio/index.html');
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 3`, 'the three tabs after a reload');
    const after = await tabs();
    assert.deepStrictEqual(after.map((t) => [t.name, t.home]), [['Bracket 759', 'file'], ['Opened 759', 'file'], ['Dropped 759', 'file']], 'every tab kept its file home (by name)');
    assert.strictEqual(await signInOutsideDriveTab(), 0, 'after all that: no sign-in prompt ever showed outside the Drive tab');
    // ================= phone 390 =================
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    touch = true;
    await app('sketchstudio', '/apps/sketchstudio/index.html');
    const fits = async (what) => {
      const m = await evalJs(`(() => { const d = document.querySelector('.sk-fd').getBoundingClientRect(); const t = [...document.querySelectorAll('.sk-fd [role="tab"], .sk-fd .sk-tp-btn:not([hidden]), .sk-fd input')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height));
        return { left: d.left, right: d.right, sw: document.scrollingElement.scrollWidth, vw: innerWidth, minH: Math.min(...t) }; })()`);
      assert.ok(m.left >= 0 && m.right <= m.vw && m.sw <= m.vw, what + ': fits at 390, no sideways scroll ' + JSON.stringify(m));
      assert.ok(m.minH >= 44, what + ': 44 px targets ' + JSON.stringify(m));
    };
    await menu('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'phone: the Save as dialog');
    await fits('Save as');
    await shot('phone-saveas-local.png', '.sk-fd', 4);
    await press('.sk-fd [data-fd-tab="drive"]'); await sleep(150);
    await fits('Save as, Drive tab');
    await shot('phone-saveas-drive-signed-out.png', '.sk-fd', 4);
    await press('.sk-fd .sk-tp-cancel');
    await waitFor(`!document.querySelector('.sk-fd')`, 'Cancel closes it');
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'phone: the Open dialog');
    await press('.sk-fd [data-fd-tab="local"]'); await sleep(150);
    await fits('Open');
    await shot('phone-open-local.png', '.sk-fd', 4);
    await esc();
    await waitFor(`!document.querySelector('.sk-fd')`, 'Esc closes it');
    touch = false;
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    // ================= Pen Plotter and Trace (smoke): Save as > Local downloads, Open > Local opens it as a tab =================
    for (const [id, url, name] of [['penplotter', '/apps/penplotter/index.html', 'Plot 759'], ['trace', '/apps/trace/index.html', 'Trace 759']]) {
      await resetBufferLive(cdp);
      await app(id, url);
      if (id === 'penplotter') await drawLine(canvasId[id]);
      const n0 = downloads.length;
      await menu('save-as');
      await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, id + ': the Save as dialog');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-fd').dataset.fdTab`), 'local', id + ': on the Local tab (last used)');
      await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
      await typeText(name); await press('.sk-fd [data-choice="ok"]');
      const got = await waitDownload(n0 + 1, id + ' Save as > Local');
      assert.strictEqual(got.name, name + '.sketch.json', id + ': downloaded ' + name + '.sketch.json');
      assert.strictEqual(parseProjectFile(got.text).app, id, id + ': the file parses, saved by ' + id);
      const f = name + ' (opened).sketch.json'; fs.writeFileSync(path.join(dl, f), got.text);
      await menu('open-file');
      await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, id + ': the Open dialog');
      await chooseFile(path.join(dl, f), id + ' Open > Local');
      await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === ${JSON.stringify(name + ' (opened)')} && document.querySelectorAll('.sk-doctab').length === 2`, id + ': the file opened as a second tab');
      assert.strictEqual(await signInOutsideDriveTab(), 0, id + ': no sign-in prompt');
    }
    console.log(`BLOCKED non-local requests: ${net.blocked().length}${net.blocked().length ? ' ' + JSON.stringify(net.blocked().map((u) => new URL(u).host)) : ''}`);
    console.log(`save-as-local-759-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    fs.rmSync(dl, { recursive: true, force: true });
    await cdp.close();
  }
})();
