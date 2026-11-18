// tests/save-button-768-live.test.js — TASK 768 (owner turn 2314), Shaper in depth, desktop 1280 x 800, in a real browser: THE Save button at the end of the shared
// header and the LOADING state. FAKE Google session only (tests/helpers/fake-drive-session.js, signed in; slowed / failing through its own `drive.fetch`) and every
// non-local request blocked (tests/helpers/block-remote.js); the page's file pickers are a fake over an in-page "disk" (as save-as-local-759-live), with a slow write.
//   no home: an edit turns the button "not saved"; a press opens THE Save as dialog; Local -> the file is written, the button "saved" ("Saved to <file>").
//   a file home: an edit -> "not saved"; a press writes it back with THE spinner in the button while the write is slow, a second press meanwhile writes nothing more;
//   then "saved". The tab's dot says the same (one source).
//   a Drive home: a press while the fake Drive answers slowly shows the spinner, then "saved" ("Saved to Google Drive"); writes failing -> "failed" (red, the
//   store's reason in the tooltip, the tab's dot red), a press once Drive answers again retries -> "saved"; signed out, an edit waits for sign-in ("signin",
//   amber, the menu's status text); signed in again -> "saved".
//   loading: opening a slow fake-Drive design shows the loading tab + the button spinner AT ONCE, the overlay "Loading <name>…" only after the declared delay, and
//   all of it goes when the design is drawn; a fast open never shows the overlay; no spinner is left anywhere.
//   Through all of it the stage buttons and the Save button keep their exact rects (fixed footprint, nothing shifts).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { LOADING_OVERLAY_DELAY_MS } from '../packages/ui/document-activity.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/768');
fs.mkdirSync(EVID, { recursive: true });

// the fake picker (save-as-local-759-live's), plus a slow write: sessionStorage 'slowWrite' = ms the file's close() waits
const FAKE_PICKER = `(() => {
  const disk = { get: (n) => sessionStorage.getItem('disk:' + n), set: (n, t) => sessionStorage.setItem('disk:' + n, t) };
  const count = (k) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1));
  const handle = (name) => ({ kind: 'file', name,
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { const ms = Number(sessionStorage.getItem('slowWrite') || 0); if (ms) await new Promise((r) => setTimeout(r, ms)); disk.set(name, buf); count('writes:' + name); } }; },
    async getFile() { return new File([disk.get(name)], name); } });
  window.showSaveFilePicker = async ({ suggestedName }) => { count('savePicker'); return handle(suggestedName); };
  window.showOpenFilePicker = async () => [handle(sessionStorage.getItem('nextOpen'))];
})();`;

await (async () => {
  const cdp = await launchBrowser({ tag: '768s', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const t0 = Date.now();
  try {
    const net = await blockRemote(cdp);
    const session = await installFakeDriveSession(cdp, { signedIn: true });
    const realFetch = session.drive.fetch;
    const slow = { write: 0, read: 0 };
    session.drive.fetch = async (url, init = {}) => { // the fake Drive, answering slowly when the test says so
      const write = (init.method || 'GET').toUpperCase() !== 'GET';
      const ms = write ? slow.write : (String(url).includes('alt=media') ? slow.read : 0);
      if (ms) await sleep(ms);
      return realFetch(url, init);
    };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PICKER });
    await send('Page.setDownloadBehavior', { behavior: 'deny' });

    const shot = async (name, sel = 'header.sk-header', pad = 0, extra = '') => {
      const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const b = e.getBoundingClientRect(); ${extra} return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 2 } });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
    };
    const headerAndStrip = (name) => shot(name, 'header.sk-header', 0, `const s = document.querySelector('.sk-doctabs').getBoundingClientRect(); return { x: 0, y: 0, w: 640, h: s.bottom };`);
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(80);
    };
    const press = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' exists'); await click(c.x, c.y);
    };
    const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
    const esc = () => sendRealKey(send, 'Escape', 'Escape', 27);
    const menu = async (action) => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await press('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu open');
      await press(`[data-action="${action}"]`);
    };
    const drawLine = async (fy = 0.4) => {
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(80);
      const r = await evalJs(`(() => { const b = document.getElementById('design-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.35), Math.round(r.y + r.h * fy)); await click(Math.round(r.x + r.w * 0.6), Math.round(r.y + r.h * (fy + 0.1)));
      await esc(); await sleep(80);
    };
    const btn = () => evalJs(`(() => { const b = document.querySelector('.sk-save'); return { state: b.dataset.state, label: b.getAttribute('aria-label'), title: b.title, spinner: !!b.querySelector('.sk-spinner[role="status"]'), inHeader: b.parentNode.matches('header.sk-header') }; })()`);
    const waitState = (state, what) => waitFor(`document.querySelector('.sk-save').dataset.state === ${JSON.stringify(state)}`, what, 15000);
    // the stage buttons' and the Save button's rects, for "nothing shifts between states"
    const rects = () => evalJs(`JSON.stringify([...document.querySelectorAll('header .sk-header-tab, header .sk-save')].map((e) => { const r = e.getBoundingClientRect(); return [e.className.split(' ')[0], r.left, r.top, r.width, r.height]; }))`);
    const ss = (k) => evalJs(`sessionStorage.getItem(${JSON.stringify(k)})`);
    const states = new Set();
    let base = null;
    const checkRects = async (state) => { const now = await rects(); if (!base) base = now; assert.strictEqual(now, base, `state ${state}: the stage buttons and the Save button keep their rects`); states.add(state); };

    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas');
    await waitState('new', 'a fresh Untitled: the button is quiet ("new")');
    let b = await btn();
    assert.strictEqual(b.inHeader, true, 'the Save button is IN the shared header');
    assert.strictEqual(await evalJs(`document.querySelector('header.sk-header .sk-sidebar-btn').nextElementSibling.classList.contains('sk-save') && document.querySelector('header.sk-header .sk-save').nextElementSibling.classList.contains('sk-header-tabs')`), true, 'between menu button and stage tabs');
    assert.ok(/^Save \(Ctrl\+S\) · Not saved yet$/.test(b.title), 'its title has the shortcut from the table: ' + b.title);
    assert.strictEqual(b.label, 'Save, Not saved yet', 'aria-label with the state');
    await checkRects('new'); await headerAndStrip('desk-1-new.png');

    // ---- no home: an edit -> not saved; a press -> THE Save as dialog; Local -> the file is its home -> saved
    await drawLine();
    await waitState('unsaved', 'an edit: not saved');
    await checkRects('unsaved'); await headerAndStrip('desk-2-unsaved-nohome.png');
    await press('.sk-save');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'a press with no home opens THE Save as dialog');
    await press('.sk-fd [data-fd-tab="local"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Local 768'); await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'saved to a file: the dialog closed');
    await waitState('saved', 'saved to its file');
    b = await btn();
    assert.strictEqual(b.label, 'Save, Saved to Local 768.sketch.json', 'saved: the file named');
    await checkRects('saved'); await headerAndStrip('desk-3-saved-file.png');

    // ---- a file home: an edit -> not saved; a SLOW press -> the spinner, a second press writes nothing more; then saved
    await drawLine(0.6);
    await waitState('unsaved', 'an edit of the file design');
    assert.strictEqual((await btn()).label, 'Save, Changes not saved to Local 768.sketch.json', 'not saved: the file named');
    await evalJs(`sessionStorage.setItem('slowWrite', '1500')`);
    await press('.sk-save');
    await waitState('saving', 'a press: saving');
    b = await btn();
    assert.strictEqual(b.spinner, true, 'THE spinner (role=status) in the button while the file is written');
    assert.strictEqual(b.label, 'Save, Saving to Local 768.sketch.json…', 'aria-label says saving');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-save').getAttribute('aria-disabled')`), 'true', 'aria-disabled while saving');
    assert.ok(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot.saving')`), 'the tab shows saving too (one source)');
    await checkRects('saving'); await headerAndStrip('desk-4-saving-file.png');
    await press('.sk-save'); // a second press while it saves
    await waitState('saved', 'the slow write done: saved');
    await evalJs(`sessionStorage.removeItem('slowWrite')`);
    assert.strictEqual(await ss('writes:Local 768.sketch.json'), '2', 'two writes in all (Save as + ONE press): the press during the save did nothing');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`), false, 'the tab: no dot');

    // ---- a Drive home (Save as -> Google Drive), the fake Drive slow: the spinner, then saved
    await menu('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'the Save as dialog');
    await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd-panel="drive"]:not([hidden])') && !document.querySelector('.sk-fd-name').hidden`, 'the Drive tab (signed in)');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Drive 768'); await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
    await waitFor(`!document.querySelector('.sk-fd')`, 'saved to Drive');
    await waitFor(`!!document.querySelector('.sk-doctab.active .sk-doctab-home[data-home="drive"]')`, 'the tab: a Drive home');
    await waitState('saved', 'a Drive design, written');
    assert.strictEqual((await btn()).label, 'Save, Saved to Google Drive', 'saved: to Google Drive');
    await headerAndStrip('desk-5-saved-drive.png');
    slow.write = 1500;
    await drawLine(0.25);
    await press('.sk-save');
    await waitState('saving', 'Drive slow: saving');
    assert.strictEqual((await btn()).spinner, true, 'the spinner while the fake Drive answers slowly');
    assert.strictEqual((await btn()).label, 'Save, Saving to Google Drive…', 'saving to Google Drive');
    await checkRects('saving-drive'); await headerAndStrip('desk-6-saving-drive.png');
    await waitState('saved', 'the slow Drive write done: saved');
    slow.write = 0;

    // ---- writes failing: failed (red, the store's reason), a press once Drive answers again retries -> saved
    session.setFailWrites(1000);
    await drawLine(0.7);
    await press('.sk-save');
    await waitState('failed', 'Drive refuses the write: failed');
    b = await btn();
    assert.ok(/^Save, Not saved to Google Drive: .+\. Kept on this device\.$/.test(b.label), 'failed: the store\'s reason: ' + b.label);
    assert.ok(b.title.endsWith('Press to try again.'), 'the tooltip says a press retries: ' + b.title);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-save')).backgroundColor`), 'rgb(220, 38, 38)', 'failed is the error colour');
    assert.ok(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot.failed')`), 'the tab dot is red too (one source)');
    await checkRects('failed'); await headerAndStrip('desk-7-failed.png');
    session.setFailWrites(0);
    await press('.sk-save');
    await waitState('saved', 'a press retried: saved');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`), false, 'the tab: no dot');

    // ---- signed out (the fake account): an edit of the Drive design waits for sign-in (the menu's status text, amber); signed in again -> saved
    await evalJs(`import('/packages/ui/cloud/google-account.js').then((m) => m.getGoogleAccount().signOut())`);
    await drawLine(0.15);
    await waitState('signin', 'signed out: waiting for sign-in');
    b = await btn();
    assert.ok(/^Save, Not saved to Google Drive: .+\. Kept on this device\.$/.test(b.label), 'signin: the status line text: ' + b.label);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-save')).backgroundColor`), 'rgb(180, 83, 9)', 'signin is amber');
    await checkRects('signin'); await headerAndStrip('desk-7b-signin.png');
    await evalJs(`import('/packages/ui/cloud/google-account.js').then((m) => m.getGoogleAccount().signIn())`);
    await waitState('saved', 'signed in again: the held write went: saved');

    // ---- LOADING: two more designs on the fake Drive; a SLOW open, then a FAST one
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const cur = s; await s.newDesign('Slow 768', { app: 'shaper' }); await s.newDesign('Fast 768', { app: 'shaper' }); await s.flushDrive(); })`);
    // record every overlay show and loading-tab appearance from now on (a fast load must never show the overlay)
    await evalJs(`(() => { window.__768 = { overlay: 0, loadTab: 0 }; new MutationObserver(() => { const o = document.querySelector('.sk-loading'); if (o && !o.hidden) window.__768.overlay++; if (document.querySelector('.sk-doctab-loading')) window.__768.loadTab++; }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] }); })()`);
    slow.read = 1800;
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"] [data-fd="design"]')`, 'the Open dialog lists the Drive designs', 15000);
    const slowId = await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="design"]')].find((e) => e.textContent.includes('Slow 768')).dataset.design`);
    const tPress = Date.now();
    await press(`.sk-fd [data-design="${slowId}"]`);
    await waitFor(`!!document.querySelector('.sk-doctab-loading .sk-spinner[role="status"]')`, 'the loading tab, at once', 3000);
    const tTab = Date.now() - tPress;
    b = await btn();
    assert.strictEqual(b.state, 'loading', 'the header button shows the load'); assert.strictEqual(b.spinner, true, 'with THE spinner');
    assert.strictEqual(b.label, 'Save, Loading Slow 768…', 'naming the design');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab-loading').textContent`), 'Loading Slow 768…Slow 768', 'the loading tab: the spinner\'s text + the name');
    const early = await evalJs(`!document.querySelector('.sk-loading').hidden`);
    const tEarly = Date.now() - tPress;
    if (tEarly < LOADING_OVERLAY_DELAY_MS - 50) assert.strictEqual(early, false, `no overlay before the delay (${tEarly} ms < ${LOADING_OVERLAY_DELAY_MS} ms)`);
    await checkRects('loading'); await headerAndStrip('desk-8-loading-tab.png');
    await waitFor(`!document.querySelector('.sk-loading').hidden`, 'the overlay after the delay', 3000);
    const tOverlay = Date.now() - tPress;
    assert.ok(tOverlay >= LOADING_OVERLAY_DELAY_MS - 30, `the overlay came after the delay: ${tOverlay} ms`);
    const ov = await evalJs(`(() => { const o = document.querySelector('.sk-loading'); const s = document.querySelector('.sk-doctabs').getBoundingClientRect(); const r = o.getBoundingClientRect(); return { text: o.textContent, top: Math.round(r.top), stripBottom: Math.round(s.bottom), pe: getComputedStyle(o).pointerEvents, spinner: !!o.querySelector('.sk-spinner[role="status"]') }; })()`);
    assert.deepStrictEqual(ov, { text: 'Loading Slow 768…Loading Slow 768…', top: ov.stripBottom, stripBottom: ov.stripBottom, pe: 'none', spinner: true }, 'the overlay: under the tab strip, non-blocking, THE spinner + "Loading <name>…"');
    await shot('desk-9-loading-overlay.png', 'body');
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Slow 768'`, 'the slow design opened', 10000);
    assert.deepStrictEqual(await evalJs(`({ tab: !!document.querySelector('.sk-doctab-loading'), overlay: !document.querySelector('.sk-loading').hidden, spinners: document.querySelectorAll('.sk-spinner').length, state: document.querySelector('.sk-save').dataset.state })`),
      { tab: false, overlay: false, spinners: 0, state: 'saved' }, 'drawn: the loading tab, the overlay and every spinner gone');
    slow.read = 0;
    await evalJs(`window.__768 = { overlay: 0, loadTab: 0 }`);
    await menu('open-file');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'the Open dialog again', 15000);
    const fastId = await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="design"]')].find((e) => e.textContent.includes('Fast 768')).dataset.design`);
    const tFast = Date.now();
    await press(`.sk-fd [data-design="${fastId}"]`);
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Fast 768'`, 'the fast design opened', 10000);
    const fastMs = Date.now() - tFast;
    await sleep(LOADING_OVERLAY_DELAY_MS + 100);
    const fast = await evalJs(`({ ...window.__768, spinners: document.querySelectorAll('.sk-spinner').length, tab: !!document.querySelector('.sk-doctab-loading') })`);
    if (fastMs < LOADING_OVERLAY_DELAY_MS) assert.strictEqual(fast.overlay, 0, `a fast open (${fastMs} ms) never showed the overlay`);
    assert.deepStrictEqual([fast.spinners, fast.tab], [0, false], 'and left no spinner');
    assert.deepStrictEqual([...states].sort(), ['failed', 'loading', 'new', 'saved', 'saving', 'saving-drive', 'signin', 'unsaved'], 'every state measured');
    console.log(`loading: tab spinner after ${tTab} ms, overlay after ${tOverlay} ms (delay ${LOADING_OVERLAY_DELAY_MS}); fast open ${fastMs} ms, overlay shows ${fast.overlay}, loading-tab sightings ${fast.loadTab}`);
    console.log(`BLOCKED non-local requests: ${net.blocked().length}`);
    console.log(`save-button-768-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    await cdp.close();
  }
})();
