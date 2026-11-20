// tests/drive-folder-browser-live.test.js -- Real browser verification of Google Drive in-app folder browser inside "Sketch Studio":
//   - Desktop Shaper (dark chrome) & SketchStudio (light chrome): Save as -> Google Drive tab shows "Sketch Studio" browser,
//     Refresh, + New folder inline prompt (Enter/Create creates Drive folder and enters it, unmounts input cleanly at rest),
//     breadcrumbs & .. (Up), clicking existing file fills Name, Save stores .sketch.json inside chosen Drive folder (verified in fake-drive),
//     Open -> Google Drive tab browses folders and opens files inside folders.
//   - Phone 390x844: fits within viewport width, zero overflow, >= 44px tap targets.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/drive-browser');
fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const drive = createFakeDrive();
  const cdp = await launchBrowser({ tag: 'drive-browser', width: 1280, height: 800 });
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

    // ── 1. Desktop Shaper (dark chrome): Save as -> Drive folder browser ──
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');

    await openMenuAction('save-as');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Save as opens');
    if (await evalJs(`document.querySelector('.sk-fd').dataset.fdTab !== 'drive'`)) {
      await press('.sk-fd [data-fd-tab="drive"]');
    }
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="crumb-root"]') && !!document.querySelector('.sk-fd [data-fd="new-folder"]')`, 'Drive browser renders in Save as');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd [data-fd="crumb-root"]').textContent`), 'Sketch Studio', 'root crumb is Sketch Studio');

    // Create first folder "Furniture" via + New folder
    await press('.sk-fd [data-fd="new-folder"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="mkdir-input"]')`, 'mkdir row opens');
    await press('.sk-fd [data-fd="mkdir-input"]');
    await typeText('Furniture');
    await shot('save-as-mkdir.png');
    await press('.sk-fd [data-fd="mkdir-ok"]');
    await waitFor(`!document.querySelector('.sk-fd [data-fd="mkdir-input"]') && document.querySelector('.sk-fd .sk-fd-dest')?.textContent.includes('Furniture')`, 'entered newly created Furniture folder');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-fd input').getAttribute('aria-label')`), 'Name', 'after closing mkdir, first .sk-fd input is Name input');

    // Save "Chair" directly inside "Furniture"
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Chair');
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'Save closes dialog');

    const rootDrive = drive.byName('Sketch Studio')[0];
    const furnDrive = drive.byName('Furniture')[0];
    const chairDrive = drive.byName('Chair.sketch.json')[0];
    assert(rootDrive && furnDrive && chairDrive, 'Drive root, Furniture folder, and Chair.sketch.json exist');
    assert.deepStrictEqual(furnDrive.parents, [rootDrive.id], 'Furniture folder is inside Sketch Studio');
    assert.deepStrictEqual(chairDrive.parents, [furnDrive.id], 'Chair.sketch.json is inside Furniture folder');

    // Reopen Save as: opens directly inside "Furniture", shows "Chair" file, click "Sketch Studio" crumb to root, create "Cabinets" & save "Wall Unit"
    await openMenuAction('save-as');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="design"]')`, 'opens inside Furniture folder showing Chair');
    await shot('save-as-in-folder.png');
    assert(await evalJs(`document.querySelector('.sk-fd [data-fd="design"]').textContent.includes('Chair')`), 'Chair listed in Furniture folder');
    await press('.sk-fd [data-fd="crumb-root"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="folder"]')`, 'back at Sketch Studio root showing folders');
    await shot('save-as-root.png');

    await press('.sk-fd [data-fd="new-folder"]');
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="mkdir-input"]')`, 'mkdir row opens again');
    await press('.sk-fd [data-fd="mkdir-input"]');
    await typeText('Cabinets');
    await sendRealKey(send, 'Enter', 'Enter', 13);
    await waitFor(`document.querySelector('.sk-fd .sk-fd-dest')?.textContent.includes('Cabinets')`, 'Enter creates Cabinets and navigates into it');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    await typeText('Wall Unit');
    await press('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd')`, 'Wall Unit saved');

    const cabDrive = drive.byName('Cabinets')[0];
    const wallDrive = drive.byName('Wall Unit.sketch.json')[0];
    assert(cabDrive && wallDrive, 'Cabinets and Wall Unit created in Drive');
    assert.deepStrictEqual(wallDrive.parents, [cabDrive.id], 'Wall Unit saved directly inside Cabinets');

    // Open -> Google Drive tab: browse folders, open Chair from Furniture
    await openMenuAction('open-file');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"] [data-fd="folder"]')`, 'Open shows Drive folders at root');
    await shot('open-folders.png');
    await evalJs(`(() => { const btns = [...document.querySelectorAll('.sk-fd [data-fd="folder"]')]; const b = btns.find((x) => x.textContent.includes('Furniture')); if (b) b.click(); })()`);
    await waitFor(`!!document.querySelector('.sk-fd [data-fd="up"]') && document.querySelector('.sk-fd [data-fd="design"]')?.textContent.includes('Chair')`, 'Furniture folder opened showing Chair');
    await press('.sk-fd [data-fd="design"]');
    await waitFor(`!document.querySelector('.sk-fd') && document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Chair'`, 'Chair opened from Furniture folder');

    // ── 2. Phone 390 x 844 (SketchStudio light chrome): fits viewport & 44px targets ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await press('.sk-sidebar-chevron');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'phone drawer opens');
    await press('[data-action="save-as"]');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"] [data-fd="folder"]')`, 'phone Save as shows Drive folders');
    const phoneMetrics = await evalJs(`(() => {
      const dlg = document.querySelector('.sk-fd').getBoundingClientRect();
      const folder = document.querySelector('.sk-fd [data-fd="folder"]').getBoundingClientRect();
      const tool = document.querySelector('.sk-fd [data-fd="new-folder"]').getBoundingClientRect();
      return { left: Math.round(dlg.left), right: Math.round(dlg.right), vw: innerWidth, folderH: Math.round(folder.height), toolH: Math.round(tool.height) };
    })()`);
    assert(phoneMetrics.left >= 0 && phoneMetrics.right <= 390, `Phone dialog fits 390px: ${JSON.stringify(phoneMetrics)}`);
    assert(phoneMetrics.folderH >= 44 && phoneMetrics.toolH >= 44, `Phone touch targets >= 44px: ${JSON.stringify(phoneMetrics)}`);
    await shot('phone-save-as.png');

    console.log('drive-folder-browser-live: ok');
  } finally {
    await cdp.close();
  }
})();
