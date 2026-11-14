// tests/sidebar-open-refused-live.test.js — TASK 479 / 601 (what stays in the browser of the old tests/sidebar-projects.test.js; the rest is in
// tests/sidebar-projects-node.test.js): a refused (newer-version) file opened through the REAL file chooser (Page.setInterceptFileChooserDialog) shows its
// message and changes nothing, even with a garbage collection while the picker is open (the open input has to stay referenced).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));





async function sendRealKey(send, key, code, vk, modifiers = 0, text = '') {
  const down = { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (text) down.text = text;
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

await (async () => {
  const cdp = await launchBrowser({ tag: '479', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, ws } = cdp;
  await installFakeDriveSession(cdp);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-479-'));
  try {
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    // force the <input type=file> fallback path of the browser seam so the real file chooser can be intercepted
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showOpenFilePicker; delete window.showSaveFilePicker;' });
    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const nav = async () => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url }); await Promise.race([l, sleep(8000)]); await sleep(1500); };
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const recent = () => evalJs(`(async () => JSON.stringify((await ${S}.listRecent({})).map((d) => [d.name, d.projectName])))()`).then(JSON.parse);
    const shapes = () => evalJs(`window.__designController.state.shapes.length`);
    const title = () => evalJs(`document.title`);
    const openSb = async () => { await clickEl('.sk-sidebar-btn'); await sleep(350); };

    await nav();
    await clickEl('[data-mode="design"]'); await sleep(1200);
    await key('Escape', 'Escape', 27); await sleep(200);
    // ── a refused file (newer version) shows its message and changes nothing ──
    await key('Escape', 'Escape', 27); await sleep(200);
    const before = JSON.stringify({ r: await recent(), s: await shapes(), t: await title() });
    const bad = path.join(tmpDir, 'newer.sketch.json');
    fs.writeFileSync(bad, JSON.stringify({ format: 'sketch-studio-project', version: 1, app: 'shaper', name: 'Future', document: { version: 99, geometry: { joints: [], shapes: [], constraints: [] }, hosts: {} } }));
    await send('DOM.enable');
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    const fileInputs = () => evalJs(`document.querySelectorAll('input[type=file]').length`);
    const inputsBefore = await fileInputs(); // the page owns some file inputs of its own: compare, don't expect zero
    const chooser = once('Page.fileChooserOpened');
    await openSb();
    await clickEl('[data-action="open-file"]');
    const fc = await Promise.race([chooser, sleep(4000).then(() => null)]);
    assert.ok(fc, 'the file chooser opened');
    // a garbage collection while the picker is open must not lose the chosen file (the open input has to stay referenced)
    await send('HeapProfiler.enable'); await send('HeapProfiler.collectGarbage'); await sleep(200); await send('HeapProfiler.collectGarbage');
    await send('DOM.setFileInputFiles', { files: [bad], backendNodeId: fc.backendNodeId });
    // wait for the real condition (the async file read + refusal), not a fixed sleep; on timeout say what the drawer shows
    await waitFor(`!!(document.querySelector('.sk-sidebar-msg.error') || {}).textContent`, 'the refusal message in the drawer', 10000).catch(async (e) => {
      throw new Error(e.message + '; the drawer shows: ' + JSON.stringify(await evalJs(`(document.querySelector('.sk-sidebar') || {}).innerText || ''`)));
    });
    assert.strictEqual(await fileInputs(), inputsBefore, 'no stray file input is left in the DOM once the open settled');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true, 'the drawer stays open on a refusal');
    const refused = await evalJs(`(document.querySelector('.sk-sidebar-msg.error') || {}).textContent || ''`);
    assert.ok(/newer version/i.test(refused), 'the refusal message is shown in the drawer: ' + refused);
    assert.strictEqual(JSON.stringify({ r: await recent(), s: await shapes(), t: await title() }), before, 'nothing changed (no new design, canvas and title untouched)');
    console.log('sidebar-open-refused-live: ok');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await cdp.close();
  }
})();
