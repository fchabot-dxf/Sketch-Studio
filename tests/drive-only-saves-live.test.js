// tests/drive-only-saves-live.test.js — TASK 624 end-to-end live verification (headless Edge/Chrome + fake Drive over CDP; ZERO real Google calls).
// Verifies:
//  1. Signed out: no "Save to Google Drive" menu item, no "Save to Google Drive by default" toggle, Untitled status = "Not saved yet".
//  2. Local open-tabs buffer: drawing on Untitled (plus a second Untitled tab) survives page refresh cleanly without storing a local named design.
//  3. Signed out Save as… asks to sign in first -> clicking "Sign in with Google" (fake GIS) continues seamlessly to Save as… -> design lives ONLY on Drive.
//  4. Offline + signed in: brand-new Save as… refuses cleanly ("Google Drive can't be reached; your drawing is kept, try again when online");
//     edits to an existing Drive design queue locally and sync once online again.
//  5. Out-of-band emptied Drive folder: remembered file deleted while "My Designs" stays -> next save recreates a fresh file in the EXISTING folder.
//  6. Legacy local design seeded from pre-624 storage opens and offers inline "Move to Google Drive", moving verified to Drive (and Drive projects have no "Make local").
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '624', width: 1280, height: 820 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const shot = async (name, clip = { x: 0, y: 0, width: 420, height: 760 }) => {
    if (!EVID) return;
    await sleep(200);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1.5 } });
    fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
  };
  const clickSel = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, sel + ' missing');
    await click(c.x, c.y);
  };
  const drawSegment = async (fy = 0.35) => {
    await evalJs(`document.getElementById('tool-line').click()`); await sleep(100);
    const r = await evalJs(`(() => { const b = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await click(Math.round(r.x + r.w * 0.30), Math.round(r.y + r.h * fy));
    await click(Math.round(r.x + r.w * 0.58), Math.round(r.y + r.h * fy));
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
  };
  const shapesCount = () => evalJs(`document.querySelectorAll('#svgCanvas .shape-elem').length`);
  const idbLocalDesigns = () => evalJs(`new Promise((res) => { const r = indexedDB.open('sketch-studio-projects', 1); r.onsuccess = () => { const db = r.result; const g = db.transaction('designs').objectStore('designs').getAll(); g.onsuccess = () => { db.close(); res(g.result.length); }; }; r.onerror = () => res(0); })`);
  const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;

  try {
    const session = await installFakeDriveSession(cdp, { signedIn: false });
    await navigate(url, 10000);
    await waitForApp('svgCanvas');

    // 1. Signed out: no Save to Google Drive entry, no default toggle, status = "Not saved yet"
    await clickSel('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
    assert.strictEqual(await evalJs(`!!document.querySelector('[data-action="save-drive"]')`), false, 'no Save to Google Drive item');
    assert.strictEqual(await evalJs(`!!document.querySelector('[data-account="drive-default"]')`), false, 'no default toggle');
    assert.strictEqual(await evalJs(`document.querySelector('[data-section="status"]').textContent.trim()`), 'Not saved yet');
    await shot('01-menu-signed-out-untitled.png');

    // 2. Draw on Untitled -> refresh -> restored from local open-tabs working buffer (with zero local named designs)
    await clickSel('.sk-sidebar-backdrop');
    await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar closed');
    await drawSegment(0.32);
    assert.strictEqual(await shapesCount(), 1, '1 line drawn on Untitled');
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(400);
    await navigate(url, 10000);
    await waitForApp('svgCanvas');
    await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 1`, 'Untitled drawing restored across page refresh from working buffer');
    assert.strictEqual(await idbLocalDesigns(), 0, 'working buffer stored NO local named design');

    // 3. Signed out Save as… -> prompts Sign in -> click Sign in -> Save as prompt -> saved ONLY to fake Drive
    await clickSel('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
    await clickSel('[data-action="save-as"]');
    await waitFor(`!!document.querySelector('.sk-sidebar-ask [data-choice="signin"]')`, 'Save as asks to sign in first');
    await shot('02-signed-out-save-asks-signin.png');
    await clickSel('.sk-sidebar-ask [data-choice="signin"]');
    await waitFor(`!!document.querySelector('.sk-sidebar-input')`, 'Save as name prompt after sign-in');
    await evalJs(`document.querySelector('.sk-sidebar-input').value = 'Bracket 624'`);
    await clickSel('.sk-sidebar-confirm-btns .ok');
    await waitFor(`(document.querySelector('.sk-sidebar-doc') || {}).textContent === 'Bracket 624'`, 'Bracket 624 is current');
    await evalJs(`(async () => { await ${S}.flushDrive(); })()`);
    assert.strictEqual(session.drive.byName('Bracket 624.sketch.json').length, 1, 'Bracket 624 exists on fake Drive');
    assert.strictEqual(await idbLocalDesigns(), 0, 'zero local named designs stored');
    await waitFor(`/Saved to Google Drive/.test(document.querySelector('[data-section="status"]').textContent)`, 'status shows Saved to Google Drive');
    await shot('03-saved-to-drive-only.png');

    // 4. Open second tab (Untitled with drawn line) -> refresh -> BOTH tabs return
    await clickSel('.sk-sidebar-backdrop');
    await clickSel('.sk-doctab-new');
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, 'second Untitled tab opened');
    await drawSegment(0.55);
    assert.strictEqual(await shapesCount(), 1, 'second Untitled has its own line');
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(400);
    await navigate(url, 10000);
    await waitForApp('svgCanvas');
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, 'both tabs reopened on refresh');
    const tabNames = await evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((n) => n.textContent)`);
    assert.deepStrictEqual(tabNames, ['Bracket 624', 'Untitled'], 'both tabs restored');
    await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 1`, 'Untitled tab kept its drawing across reload');

    // 5. Offline + signed in: Save as… of Untitled refuses cleanly; offline edit to Bracket 624 queues then syncs
    session.setOffline(true);
    await clickSel('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
    await clickSel('[data-action="save-as"]');
    await waitFor(`!!document.querySelector('.sk-sidebar-input')`, 'Save as prompt opens');
    await evalJs(`document.querySelector('.sk-sidebar-input').value = 'OfflineNew'`);
    await clickSel('.sk-sidebar-confirm-btns .ok');
    await waitFor(`/Google Drive can't be reached/.test((document.querySelector('.sk-sidebar-msg.error') || {}).textContent || '')`, 'offline new Save as refused clearly');
    await shot('04-offline-new-save-refused.png');
    assert.strictEqual(await idbLocalDesigns(), 0, 'offline failure stored no local named design');

    await clickSel('.sk-sidebar-backdrop');
    await clickSel('.sk-doctab-main'); // switch back to Bracket 624 (first tab)
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Bracket 624'`, 'Bracket 624 active');
    await drawSegment(0.68);
    assert.strictEqual(await shapesCount(), 2, 'second line drawn offline on Bracket 624');
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(300);
    const hasShadow = await evalJs(`(async () => { const s = ${S}; const cur = await s.current(); return s.hasPendingDrive(cur.id); })()`);
    assert.strictEqual(hasShadow, true, 'offline edit queued in driveShadow');
    session.setOffline(false);
    await evalJs(`(async () => { await ${S}.flushDrive(); })()`);
    await sleep(400);
    const driveDocAfterSync = JSON.parse([...session.drive.files.values()].find((f) => f.name === 'Bracket 624.sketch.json' && !f.trashed).content);
    assert.strictEqual(driveDocAfterSync.document.geometry.shapes.length, 2, 'offline edit synced to Drive when online');

    // 6. Emptied "My Designs" out of band (design file deleted while folder remains) -> next save writes fresh file in EXISTING folder
    const myDesignsFolder = [...session.drive.files.values()].find((f) => f.name === 'My Designs' && !f.trashed);
    const bracketFile = [...session.drive.files.values()].find((f) => f.name === 'Bracket 624.sketch.json' && !f.trashed);
    assert(myDesignsFolder && bracketFile);
    session.drive.files.delete(bracketFile.id);
    await drawSegment(0.78);
    assert.strictEqual(await shapesCount(), 3, 'third line drawn on Bracket 624');
    await waitFor(`(async () => { window.dispatchEvent(new Event('pagehide')); const s = ${S}; await s.flushDrive(); const cur = await s.current(); const d = cur && await s.get(cur.id); return !!(d && d.document.geometry.shapes.length === 3); })()`, '3rd shape saved to store');
    await evalJs(`(async () => { await ${S}.flushDrive(); })()`);
    const freshFiles = [...session.drive.files.values()].filter((f) => f.name === 'Bracket 624.sketch.json' && !f.trashed);
    assert.strictEqual(freshFiles.length, 1, 'fresh file created cleanly after out-of-band file deletion');
    assert.deepStrictEqual(freshFiles[0].parents, [myDesignsFolder.id], 'placed into EXISTING My Designs folder');
    assert.notStrictEqual(freshFiles[0].id, bracketFile.id, 'new Drive file id replaced deleted one');
    assert.strictEqual(JSON.parse(freshFiles[0].content).document.geometry.shapes.length, 3, 'fresh file carries all 3 drawn shapes');

    // 7. Existing legacy local design opens and offers inline "Move to Google Drive"
    await evalJs(`(async () => {
      const m = await import('/packages/ui/project-store.js');
      const local = m.createIdbAdapter();
      await local.putProject({ id: 'legacy-p1', name: 'Legacy Shop', pinned: false, updatedAt: Date.now() });
      await local.putDesign({ id: 'legacy-d1', projectId: 'legacy-p1', name: 'Old Bracket', app: 'sketchstudio', updatedAt: Date.now(), document: { version: 2, geometry: { joints: [['ja', { x: 0, y: 0 }], ['jb', { x: 40, y: 0 }]], shapes: [{ id: 'sl', type: 'line', joints: ['ja', 'jb'] }], constraints: [] }, hosts: {} } });
      await m.getProjectStore().open('legacy-d1');
      return true;
    })()`);
    await navigate(url, 10000);
    await waitForApp('svgCanvas');
    await clickSel('.sk-sidebar-btn');
    await waitFor(`!!document.querySelector('[data-action="move-to-drive"]')`, 'legacy local design offers inline Move to Google Drive');
    await shot('05-legacy-local-offers-move.png');
    await clickSel('[data-action="move-to-drive"]');
    await waitFor(`/Saved to Google Drive/.test(document.querySelector('[data-section="status"]').textContent)`, 'Move to Google Drive completed and verified');
    assert.strictEqual(session.drive.byName('Old Bracket.sketch.json').length, 1, 'Old Bracket moved cleanly to fake Drive');
    assert.strictEqual(await idbLocalDesigns(), 0, 'legacy local design removed only after verified Drive copy');
    await shot('06-legacy-moved-to-drive.png');

    console.log('drive-only-saves-live: ok');
  } finally {
    await cdp.close();
  }
})();
