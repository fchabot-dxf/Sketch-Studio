// tests/saveas-overwrite-live.test.js -- Real browser verification for Save as overwriting an existing Drive design with "Are you sure?" confirmation:
//   - Saving with the same name in the same Drive folder opens the "Are you sure you want to overwrite it?" confirmation bar inside Save as.
//   - Cancel keeps both designs intact and returns to Save as; typing a non-colliding name clears confirmation cleanly.
//   - Confirming Overwrite replaces the existing Drive file in place (same Drive file ID, new drawing content, zero duplicates).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/saveas-overwrite');
fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const drive = createFakeDrive();
  const cdp = await launchBrowser({ tag: 'saveas-overwrite', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;

  try {
    await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true, drive });

    const shot = async (name, sel = '.sk-fd', pad = 10) => {
      await sleep(120);
      const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      assert(r, 'screenshot target missing: ' + sel);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1.5 } });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
    };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(140);
    };
    const press = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, 'selector not found: ' + sel);
      await click(c.x, c.y);
    };
    const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
    const openMenuAction = async (action) => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await press('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'menu opens');
      await press(`[data-action="${action}"]`);
    };

    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');

    // Create a first design "Chair" inside "Furniture" with joint J_OLD
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

    const firstFiles = drive.byName('Chair.sketch.json');
    assert.strictEqual(firstFiles.length, 1, '1 Chair.sketch.json initially');
    const origId = firstFiles[0].id;

    // Start a second New blank design with J_NEW, Save as "Chair" in Furniture -> asks "Are you sure you want to overwrite it?"
    await openMenuAction('new-design');
    await waitFor(`!!document.querySelector('[role="dialog"]') || document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Untitled'`, 'New design');
    if (await evalJs(`!!document.querySelector('[role="dialog"] button')`)) {
      // Blank card is first in template picker
      await press('[role="dialog"] .sk-tp-card');
    }
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Untitled'`, 'new Untitled active');
    await evalJs(`(() => { const st = window.__designController.state; st.joints.set('J_NEW', { x: 55, y: 66 }); st.saveState('new'); })()`);

    await openMenuAction('save-as');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="folder"]')`, 'Save as root ready');
    await evalJs(`(() => { [...document.querySelectorAll('.sk-fd [data-fd="folder"]')].find((b) => b.textContent.includes('Furniture')).click(); })()`);
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'Chair listed inside Furniture');

    // Click existing "Chair" row -> fills Name with "Chair", click Save -> confirmation appears
    await press('.sk-fd [data-fd="design"]');
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'Overwrite confirmation appears');
    assert(await evalJs(`/Are you sure you want to overwrite/i.test(document.querySelector('.sk-fd .sk-fd-confirm-msg').textContent)`), 'Confirmation asks if sure to overwrite');
    await shot('overwrite-confirm.png');

    // Cancel keeps original untouched; click Save -> Overwrite replaces same Drive file ID
    await press('.sk-fd [data-fd="confirm-cancel"]');
    await waitFor(`document.querySelector('.sk-fd [data-fd="confirm"]').hidden && !document.querySelector('.sk-fd [data-choice="ok"]').hidden`, 'Cancel restores Save button');
    assert(parseProjectFile(drive.files.get(origId).content).document.geometry.joints.some(([id]) => id === 'J_OLD'), 'Cancel leaves original file untouched');

    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="confirm"]').hidden`, 'Confirmation reopens on Save');
    await press('.sk-fd [data-fd="confirm-overwrite"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'Overwrite completes and closes dialog');

    const afterFiles = drive.byName('Chair.sketch.json');
    assert.strictEqual(afterFiles.length, 1, 'still only 1 Chair.sketch.json in Drive (no duplicate)');
    assert.strictEqual(afterFiles[0].id, origId, 'kept exact same Drive file ID');
    const overwritten = parseProjectFile(afterFiles[0].content);
    assert(overwritten.document.geometry.joints.some(([id]) => id === 'J_NEW'), 'overwritten file has new geometry');
    assert(!overwritten.document.geometry.joints.some(([id]) => id === 'J_OLD'), 'old geometry was replaced');

    console.log('saveas-overwrite-live: ok');
  } finally {
    await cdp.close();
  }
})();
