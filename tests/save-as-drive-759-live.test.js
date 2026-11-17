// tests/save-as-drive-759-live.test.js — TASK 759 (owner turn 2266), Shaper in depth, in a real browser: a browser WITH a file picker (the File System Access API
// path of #ui/project-file.js: a picked file has a handle) and the Google Drive tab signed in. The FAKE Google session only (tests/helpers/fake-drive-session.js)
// and every non-local request blocked (tests/helpers/block-remote.js: the count is printed). The browser's real picker cannot be answered through CDP, so the
// page's showSaveFilePicker / showOpenFilePicker are replaced by a fake one over an in-page "disk" (the app's own picker path runs unchanged).
//   signed OUT: Save as -> Local writes the file through the picker (no download); the tab shows the device glyph; an edit + Ctrl+S writes BACK into the same
//   file (no picker, no dialog); Open -> Local opens a file as a new tab, and Save writes back to it; after a reload the home is the name only: Ctrl+S asks for
//   the file again (the picker, same name).
//   signed IN through the Save as dialog's own Google Drive tab (the fake Google sign-in): the name field appears, Save writes the design to the fake Drive exactly as
//   before (the drive.file .sketch.json), the tab shows the Drive glyph; Open -> Google Drive lists it and opens it.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });

// the fake picker: files live in the page's sessionStorage (they survive a reload, as a file on disk does); every picker call and every write is counted
const FAKE_PICKER = `(() => {
  const disk = { get: (n) => sessionStorage.getItem('disk:' + n), set: (n, t) => sessionStorage.setItem('disk:' + n, t) };
  const count = (k) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1));
  const handle = (name) => ({ kind: 'file', name,
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { disk.set(name, buf); count('writes:' + name); } }; },
    async getFile() { return new File([disk.get(name)], name); } });
  window.showSaveFilePicker = async ({ suggestedName }) => { count('savePicker'); sessionStorage.setItem('lastSuggested', suggestedName); return handle(suggestedName); };
  window.showOpenFilePicker = async () => { count('openPicker'); return [handle(sessionStorage.getItem('nextOpen'))]; };
})();`;

await (async () => {
  const cdp = await launchBrowser({ tag: '759d', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const t0 = Date.now();
  try {
    const net = await blockRemote(cdp);
    const session = await installFakeDriveSession(cdp, { signedIn: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PICKER });
    const downloads = [];
    cdp.ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Page.downloadWillBegin') downloads.push(m.params.suggestedFilename); });
    await send('Page.setDownloadBehavior', { behavior: 'deny' });

    const shot = async (name, sel, pad = 12) => {
      if (!EVID) return;
      await sleep(150);
      const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      assert(r, 'screenshot target ' + sel);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 2 } });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
    };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const press = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' exists'); await click(c.x, c.y);
    };
    const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
    const ctrlS = () => sendRealKey(send, 's', 'KeyS', 83, 2);
    const esc = () => sendRealKey(send, 'Escape', 'Escape', 27);
    const menu = async (action) => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await press('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu open');
      await press(`[data-action="${action}"]`);
    };
    const drawLine = async (fy = 0.4) => {
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(120);
      const r = await evalJs(`(() => { const b = document.getElementById('design-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.35), Math.round(r.y + r.h * fy)); await click(Math.round(r.x + r.w * 0.6), Math.round(r.y + r.h * (fy + 0.1)));
      await esc(); await sleep(120);
    };
    const shapes = () => evalJs(`document.querySelectorAll('#design-canvas .shape-elem').length`);
    const ss = (k) => evalJs(`sessionStorage.getItem(${JSON.stringify(k)})`);
    const diskShapes = async (name) => parseProjectFile(await ss('disk:' + name)).document.geometry.shapes.length;
    const active = () => evalJs(`(() => { const t = document.querySelector('.sk-doctab.active'); return { name: t.querySelector('.sk-doctab-name').textContent, home: t.querySelector('.sk-doctab-home') ? t.querySelector('.sk-doctab-home').dataset.home : null, dot: !!t.querySelector('.sk-doctab-dot') }; })()`);
    const signInOutsideDriveTab = () => evalJs(`[...document.querySelectorAll('button, a')].filter((b) => /sign in/i.test(b.textContent) && b.offsetParent !== null && !b.closest('[data-fd-panel="drive"]') && !b.closest('.sk-sidebar-account')).length + document.querySelectorAll('.sk-sidebar-ask').length`);
    const load = async () => { await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(300); };

    // ================= signed OUT, a browser with the picker =================
    await resetBufferLive(cdp);
    await load();
    assert.strictEqual(await evalJs(`typeof window.showSaveFilePicker`), 'function', 'this browser has the save picker');
    await drawLine();
    assert.strictEqual(await shapes(), 1, 'a line in Shaper\'s Design');
    await menu('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'THE Save as dialog');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd').dataset.fdTab`), 'local', 'signed out: the Local tab');
    assert.strictEqual(await signInOutsideDriveTab(), 0, 'no sign-in question');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Panel 759'); await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'saved: the dialog closed');
    assert.strictEqual(await ss('savePicker'), '1', 'the save picker was asked once'); assert.strictEqual(await ss('lastSuggested'), 'Panel 759.sketch.json', 'suggesting the typed name');
    assert.strictEqual(await diskShapes('Panel 759.sketch.json'), 1, 'the picked file holds the line'); assert.deepStrictEqual(downloads, [], 'no download');
    let a = await active();
    assert.deepStrictEqual(a, { name: 'Panel 759', home: 'file', dot: false }, 'the tab: the file, the device glyph, no dot');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs-msg').textContent`), '', 'a file with a handle: no download note');
    // an edit + Ctrl+S: written back into the same file, no picker, no dialog
    await drawLine(0.6);
    await waitFor(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`, 'an edit: the dot');
    await shot('tab-file-dirty.png', '.sk-doctabs', 0);
    await ctrlS();
    await waitFor(`sessionStorage.getItem('writes:Panel 759.sketch.json') === '2'`, 'Ctrl+S wrote back into the same file');
    assert.strictEqual(await ss('savePicker'), '1', 'without asking for the file again'); assert.strictEqual(await evalJs(`!!document.querySelector('.sk-fd')`), false, 'and without a dialog');
    assert.strictEqual(await diskShapes('Panel 759.sketch.json'), 2, 'the file now holds both lines');
    await waitFor(`!document.querySelector('.sk-doctab.active .sk-doctab-dot')`, 'saved: no dot');
    // Open -> Local: a file opens as a new tab; its Save writes back to it
    await evalJs(`sessionStorage.setItem('disk:Other 759.sketch.json', sessionStorage.getItem('disk:Panel 759.sketch.json')); sessionStorage.setItem('nextOpen', 'Other 759.sketch.json')`);
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'THE Open dialog');
    await press('.sk-fd [data-fd-tab="local"]');
    await press('.sk-fd [data-fd="choose-file"]');
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2 && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Other 759'`, 'the file opened as a new tab');
    assert.strictEqual(await shapes(), 2, 'it shows the file\'s two lines');
    await drawLine(0.25);
    await ctrlS();
    await waitFor(`sessionStorage.getItem('writes:Other 759.sketch.json') === '1'`, 'Save of the opened file wrote back into it');
    assert.strictEqual(await diskShapes('Other 759.sketch.json'), 3, 'with the new line');
    // a reload: the handle does not survive; the home is the name only; the first Save asks for the file again (same name)
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(300);
    await load();
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, 'the two tabs after a reload');
    a = await active();
    assert.deepStrictEqual([a.name, a.home], ['Other 759', 'file'], 'the active tab kept its file home (by name)');
    await drawLine(0.75);
    await ctrlS();
    await waitFor(`sessionStorage.getItem('savePicker') === '2'`, 'after a reload, Save asks for the file again');
    assert.strictEqual(await ss('lastSuggested'), 'Other 759.sketch.json', 'suggesting the same file name');
    await waitFor(`sessionStorage.getItem('writes:Other 759.sketch.json') === '2'`, 'and writes it');
    assert.strictEqual(await diskShapes('Other 759.sketch.json'), 4, 'with the 4th line');
    assert.strictEqual(await signInOutsideDriveTab(), 0, 'signed out all along: no sign-in prompt');

    // ================= signed IN through the Save as dialog's Google Drive tab =================
    await menu('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'the Save as dialog');
    await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="sign-in"]')`, 'the Drive tab: its sign-in button');
    await press('.sk-fd [data-fd="sign-in"]');
    await waitFor(`!document.querySelector('.sk-fd-name').hidden && !!document.querySelector('.sk-fd [data-fd-panel="drive"]:not([hidden])') && !document.querySelector('.sk-fd [data-fd="sign-in"]')`, 'signed in (fake): the Drive tab shows the name field');
    await shot('saveas-drive-signed-in.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="local"]'); await shot('saveas-local-signed-in.png', '.sk-fd'); await press('.sk-fd [data-fd-tab="drive"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Drive 759'); await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
    await waitFor(`!document.querySelector('.sk-fd')`, 'saved to Drive: the dialog closed');
    await evalJs(`import('/packages/ui/project-store.js').then((m) => m.getProjectStore().flushDrive())`);
    const onDrive = session.drive.byName('Drive 759.sketch.json');
    assert.strictEqual(onDrive.length, 1, 'Drive 759 is on the (fake) Google Drive, a .sketch.json as before');
    assert.strictEqual(parseProjectFile(onDrive[0].content).document.geometry.shapes.length, 4, 'holding the design');
    await waitFor(`(() => { const t = document.querySelector('.sk-doctab.active'); return t.querySelector('.sk-doctab-name').textContent === 'Drive 759' && !!t.querySelector('.sk-doctab-home[data-home="drive"]'); })()`, 'the tab: Drive 759 with the Drive glyph');
    await shot('tab-drive-home.png', '.sk-doctabs', 0);
    // Open -> Google Drive: today's designs list; a click opens it
    await press('.sk-doctab-main'); // the first tab (Panel 759, a file)
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Panel 759'`, 'Panel 759 active');
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"] [data-fd-tab="drive"][aria-selected="true"]')`, 'the Open dialog, on the Drive tab (last used)');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'the Drive designs listed');
    assert.ok((await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="design"]')].map((b) => b.textContent).join('|')`)).includes('Drive 759'), 'Drive 759 is listed');
    await shot('open-drive-signed-in.png', '.sk-fd');
    await press('.sk-fd [data-fd-tab="local"]'); await shot('open-local-signed-in.png', '.sk-fd'); await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'the Drive designs listed again');
    const id = await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="design"]')].find((b) => b.textContent.includes('Drive 759')).dataset.design`);
    await press(`.sk-fd [data-design="${id}"]`);
    await waitFor(`!document.querySelector('.sk-fd') && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Drive 759'`, 'Open > Drive opened it');
    console.log(`BLOCKED non-local requests: ${net.blocked().length}${net.blocked().length ? ' ' + JSON.stringify(net.blocked().map((u) => new URL(u).host)) : ''}`);
    console.log(`save-as-drive-759-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    await cdp.close();
  }
})();
