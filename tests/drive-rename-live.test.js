// tests/drive-rename-live.test.js — TASK 635 end-to-end (headless Edge/Chrome + FAKE Drive over CDP; zero real Google calls):
// Save as -> draw -> rename from the drawer (the pending autosave must not undo it) -> the fake Drive file is "<name>.sketch.json", its saved
// name and drawing are right, the tab label follows, and the menu's "Open in Drive" link is the design's project FOLDER in a new tab.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { settledCentre } from './helpers/settled-centre.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '635', width: 1280, height: 820 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
  };
  const clickSel = async (sel) => {
    const c = await settledCentre(cdp, sel, sel);
    await click(c.x, c.y);
  };
  const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
  try {
    const session = await installFakeDriveSession(cdp, { signedIn: true });
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');

    await clickSel('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
    await clickSel('[data-action="save-as"]');
    // TASK 759: THE Save as dialog; signed in, it opens on its Google Drive tab (today's Drive save underneath)
    await waitFor(`!!document.querySelector('.sk-fd[data-fd-tab="drive"] input')`, 'Save as dialog on the Drive tab');
    await evalJs(`document.querySelector('.sk-fd input').value = 'Untitled'`);
    await clickSel('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd') && (document.querySelector('.sk-doctab.active .sk-doctab-name') || {}).textContent === 'Untitled' && !!document.querySelector('.sk-doctab.active .sk-doctab-home[data-home="drive"]')`, 'saved design is current (on Drive)');
    await evalJs(`(async () => { await ${S}.flushDrive(); })()`);
    assert.strictEqual(session.drive.byName('Untitled.sketch.json').length, 1, 'Untitled.sketch.json on fake Drive');

    // draw a line (a pending autosave), then rename from the drawer straight away
    await evalJs(`document.getElementById('tool-line').click()`); await sleep(100);
    const r = await evalJs(`(() => { const b = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await click(Math.round(r.x + r.w * 0.30), Math.round(r.y + r.h * 0.35));
    await click(Math.round(r.x + r.w * 0.58), Math.round(r.y + r.h * 0.35));
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(150);
    assert.strictEqual(await evalJs(`document.querySelectorAll('#svgCanvas .shape-elem').length`), 1, 'a line was drawn');
    await clickSel('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
    await clickSel('.sk-sidebar-doc');
    await waitFor(`!!document.querySelector('.sk-sidebar-docinput')`, 'inline rename field');
    await evalJs(`document.querySelector('.sk-sidebar-docinput').value = 'bromont'`);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(`(document.querySelector('.sk-sidebar-doc') || {}).textContent === 'bromont'`, 'drawer shows bromont');
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(400);
    await evalJs(`(async () => { await ${S}.flushDrive(); })()`);

    const live = [...session.drive.files.values()].filter((f) => f.name.endsWith('.sketch.json') && !f.trashed);
    assert.deepStrictEqual(live.map((f) => f.name), ['bromont.sketch.json'], 'the Drive file is renamed');
    const saved = JSON.parse(live[0].content);
    assert.strictEqual(saved.name, 'bromont', 'the saved name is renamed');
    assert.strictEqual(saved.document.geometry.shapes.length, 1, 'the drawing made before the rename is kept');
    await waitFor(`(document.querySelector('.sk-doctab.active .sk-doctab-name') || {}).textContent === 'bromont'`, 'tab label shows bromont', 20000);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent`), 'bromont', 'tab label follows');

    await waitFor(`!!document.querySelector('[data-section="status"] a[data-action="open-in-drive"]')`, 'Open in Drive link in the status line');
    const link = await evalJs(`(() => { const a = document.querySelector('[data-section="status"] a[data-action="open-in-drive"]'); return { href: a.href, target: a.target, text: a.textContent }; })()`);
    const folder = session.drive.files.get(live[0].parents[0]);
    assert.strictEqual(folder.name, 'My Designs');
    assert.deepStrictEqual(link, { href: `https://drive.google.com/drive/folders/${folder.id}`, target: '_blank', text: 'Open in Drive' });
    console.log('drive-rename-live: ok');
  } finally {
    await cdp.close();
  }
})();
