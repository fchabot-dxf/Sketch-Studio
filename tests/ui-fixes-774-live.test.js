// tests/ui-fixes-774-live.test.js — TASK 774 in a real browser (Shaper, desktop 1280 x 800), FAKE Google Drive only (tests/helpers/fake-drive-session.js),
// every non-local request blocked and counted:
//   Save as > Google Drive, overwriting "Chair" (open in the FIRST tab) from a second tab:
//   4b. the question says "(it is open in another tab; that tab will close)";
//   2.  its focus is on Cancel: a real Enter cancels (the file is untouched), never Overwrite;
//   4a. leaving the folder (the Up row) drops the question; a folder press while the overwrite check runs is ignored;
//   4c. a folder whose designs cannot be read says so (never "This folder is empty").
//   4h. Settings > Units: the trailing-zeros hint exists ONCE (the row's "i", named "About Show trailing zeros"), no second static line.
//   4i. a ribbon dropdown opened again does not pile up its rows' tooltips.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/774');
fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const drive = createFakeDrive();
  const cdp = await launchBrowser({ tag: '774-ui', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  let gate = null; // while set, every Drive request waits for it (the overwrite check held in flight)
  const driveFetch = drive.fetch;
  drive.fetch = async (...a) => { if (gate) await gate.promise; return driveFetch(...a); };

  try {
    const remote = await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true, drive });
    const shot = async (name, sel = '.sk-fd', pad = 10) => {
      await sleep(120);
      const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      assert(r, 'screenshot target missing: ' + sel);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1.5 } });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
    };
    const at = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const press = async (sel) => {
      const c = await at(sel);
      assert(c, 'selector not found: ' + sel);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(140);
    };
    const hover = async (sel) => { const c = await at(sel); assert(c, 'not found: ' + sel); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' }); };
    const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
    const openMenuAction = async (action) => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await press('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'menu opens');
      await press(`[data-action="${action}"]`);
    };
    const openFurniture = async () => {
      await waitFor(`!!document.querySelector('.sk-fd [data-fd="folder"]')`, 'Save as root ready');
      await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="folder"]')].find((b) => b.textContent.includes('Furniture')).click()`);
      await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'Chair listed inside Furniture');
    };
    const confirmShown = () => evalJs(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`);

    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');

    // ── 4h. Settings > Units: one trailing-zeros hint ──
    await press('#btn-settings');
    await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'Settings open');
    await evalJs(`document.querySelector('.sk-style-panel .sk-style-tab[data-tab="units"]').click()`);
    const tz = await evalJs(`(() => { const row = document.querySelector('.sk-style-panel [data-row="TRAILING_ZEROS"]');
      return { triggers: [...row.querySelectorAll('.sk-hint-i')].map((b) => b.getAttribute('aria-label')), staticHints: [...document.querySelectorAll('.sk-style-panel .sk-style-hint')].map((h) => h.textContent).filter((t) => /0\\.250/.test(t)),
        label: row.querySelector('.sk-style-label').textContent }; })()`);
    console.log('4h: ' + JSON.stringify(tz));
    assert.deepStrictEqual(tz, { triggers: ['About Show trailing zeros'], staticHints: [], label: 'Show trailing zeros' }, '4h: one hint (the "i"), named after its row; no static second line');
    await press('.sk-style-panel [data-row="TRAILING_ZEROS"] .sk-hint-i');
    await waitFor(`!!document.querySelector('.sk-style-panel [data-row="TRAILING_ZEROS"] .sk-hint:not([hidden])')`, 'the hint opens');
    assert.match(await evalJs(`document.querySelector('.sk-style-panel [data-row="TRAILING_ZEROS"] .sk-hint:not([hidden])').textContent`), /0\.250 instead of 0\.25/, '4h: the hint is SETTING_HINTS.TRAILING_ZEROS');
    await shot('settings-trailing-zeros-hint.png', '.sk-style-panel [data-row="TRAILING_ZEROS"]', 12);
    await press('.sk-style-close');

    // ── 4i. ribbon dropdown tooltips do not pile up ──
    const NAME = '.sk-ribbon-group:not([data-fixed]) > button.sk-ribbon-group-label';
    const tipCount = () => evalJs(`document.querySelectorAll('.sk-tooltip').length`);
    const openDropdownAndHover = async () => {
      await press(NAME);
      await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item')`, 'dropdown open');
      await hover('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item');
      await waitFor(`!!document.querySelector('.sk-tooltip:not([hidden])')`, 'a row tooltip shows');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 700, button: 'none' });
      await press(NAME); // close it
      await waitFor(`!document.querySelector('.sk-ribbon-sect-menu.show')`, 'dropdown closed');
    };
    const tips0 = await tipCount();
    await openDropdownAndHover();
    const tips1 = await tipCount();
    await openDropdownAndHover();
    await openDropdownAndHover();
    const tips3 = await tipCount();
    console.log(`4i: tooltips before ${tips0}, after 1 open ${tips1}, after 3 opens ${tips3}`);
    assert.strictEqual(tips3, tips1, '4i: reopening the dropdown leaves no extra tooltip behind');

    // ── a first design "Chair" in "Furniture" (tab 1) ──
    await evalJs(`(() => { const st = window.__designController.state; st.joints.set('J_OLD', { x: 10, y: 10 }); st.saveState('old'); })()`);
    await openMenuAction('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Save as opens');
    if (await evalJs(`document.querySelector('.sk-fd').dataset.fdTab !== 'drive'`)) await press('.sk-fd [data-fd-tab="drive"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="new-folder"]:not(:disabled)')`, 'Drive browser ready');
    await press('.sk-fd [data-fd="new-folder"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="mkdir-input"]')`, 'mkdir opens');
    await press('.sk-fd [data-fd="mkdir-input"]');
    await typeText('Furniture');
    await sendRealKey(send, 'Enter', 'Enter', 13);
    await waitFor(`document.querySelector('.sk-fd .sk-fd-dest')?.textContent.includes('Furniture')`, 'Furniture created');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Chair');
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'Chair saved');
    const origId = drive.byName('Chair.sketch.json')[0].id;

    // ── a second tab, Save as "Chair" in Furniture ──
    await openMenuAction('new-design');
    await waitFor(`!!document.querySelector('[role="dialog"]') || document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Untitled'`, 'New design');
    if (await evalJs(`!!document.querySelector('[role="dialog"] .sk-tp-card')`)) await press('[role="dialog"] .sk-tp-card');
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Untitled'`, 'new Untitled active');
    await evalJs(`(() => { const st = window.__designController.state; st.joints.set('J_NEW', { x: 55, y: 66 }); st.saveState('new'); })()`);
    await openMenuAction('save-as');
    await openFurniture();
    await press('.sk-fd [data-fd="design"]');
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'the overwrite question');
    const msg = await evalJs(`document.querySelector('.sk-fd .sk-fd-confirm-msg').textContent`);
    assert.strictEqual(msg, '"Chair" already exists in "Furniture" (it is open in another tab; that tab will close). Are you sure you want to overwrite it?', '4b: the question says the other tab will close: ' + msg);
    await shot('saveas-overwrite-question.png');
    // 2: the focus is on Cancel; a real Enter cancels
    assert.strictEqual(await evalJs(`document.activeElement && document.activeElement.dataset.fd`), 'confirm-cancel', '2: the question focuses Cancel');
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, String.fromCharCode(13));
    await waitFor(`document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'Enter answered');
    assert.ok(await evalJs(`!!document.querySelector('.sk-fd')`), '2: the dialog stays open');
    assert.ok(parseProjectFile(drive.files.get(origId).content).document.geometry.joints.some(([id]) => id === 'J_OLD'), '2: Enter did not overwrite: the file is untouched');

    // 4a: leaving the folder drops the question
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'the question again');
    await press('.sk-fd [data-fd="up"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="up"]')`, 'back at the root');
    assert.strictEqual(await confirmShown(), false, '4a: the Up row dropped the question about the folder left');
    assert.ok(await evalJs(`!document.querySelector('.sk-fd [data-choice="ok"]').hidden`), '4a: Save is back');

    // 4a: a folder press while the overwrite check runs is ignored
    await openFurniture();
    await press('.sk-fd [data-fd="design"]');
    let release; gate = { promise: new Promise((r) => { release = r; }) };
    await press('.sk-fd [data-choice="ok"]'); // the check starts and waits on Drive
    await press('.sk-fd [data-fd="up"]'); // ignored while busy
    gate = null; release();
    await waitFor(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'the question after the held check');
    assert.ok(await evalJs(`!!document.querySelector('.sk-fd [data-fd="up"]') && document.querySelector('.sk-fd .sk-fd-dest').textContent.includes('Furniture')`), '4a: the press while busy was ignored: still in Furniture with its question');
    await press('.sk-fd [data-fd="confirm-cancel"]');

    // 4c: a folder whose designs cannot be read says so
    await press('.sk-fd [data-fd="up"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="up"]') && !!document.querySelector('.sk-fd [data-fd="folder"]')`, 'root again');
    drive.offline = true;
    await evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="folder"]')].find((b) => b.textContent.includes('Furniture')).click()`);
    await waitFor(`!!document.querySelector('.sk-fd .sk-tp-err') && document.querySelector('.sk-fd .sk-tp-err').textContent.length > 0`, 'the read error');
    const list = await evalJs(`({ list: document.querySelector('.sk-fd [data-fd="designs"]').textContent, err: document.querySelector('.sk-fd .sk-tp-err').textContent })`);
    console.log('4c: ' + JSON.stringify(list));
    assert.ok(!/This folder is empty/.test(list.list) && /could not be read/.test(list.list), '4c: never "empty" on a failed read: ' + JSON.stringify(list));
    await shot('saveas-folder-read-failed.png');
    drive.offline = false;
    await press('.sk-fd [data-choice="__cancel"]');

    const blockedUrls = remote.blocked();
    console.log(`ui-fixes-774-live: ok (${blockedUrls.length} non-local requests blocked${blockedUrls.length ? ': ' + blockedUrls.join(', ') : ''})`);
  } finally {
    await cdp.close();
  }
})();
