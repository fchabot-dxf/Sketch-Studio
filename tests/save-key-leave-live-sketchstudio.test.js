// tests/save-key-leave-live-sketchstudio.test.js — TASK 558, trimmed in TASK 583: what only a BROWSER can check of the save key and the leave-page warning (headless Edge,
// REAL keys and clicks, SketchStudio; the buffer is shared code, so one host is enough):
//   the browser's own leave-page dialog (beforeunload) is raised for an unsaved Untitled with content, and NOT for a clean Untitled or a named, saved design (a
//   page-initiated reload is the probe: CDP's own Page.navigate never runs beforeunload);
//   a REAL Ctrl+S on an unsaved Untitled opens the Save as name prompt in the sidebar and the prompt TAKES THE KEYBOARD FOCUS; the typed name stores it.
// What is stored, when, which design is current, Ctrl+S on a named design writing at once, Ctrl+S not reaching the canvas shortcuts, and whether the warning is armed
// are tests/save-key-leave-sketchstudio-node.test.js and tests/save-key-leave-penplotter-node.test.js.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const H = { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas', name: 'Sketch' };

await (async () => {
  const cdp = await launchBrowser({ tag: 'savekey-sketchstudio', width: 1400, height: 850, leaveDialog: 'stay' }); // the leave-page warning: answered "stay"
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const driveSession = await installFakeDriveSession(cdp, { signedIn: false });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const clickEl = async (sel) => { const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
    const typeText = async (str) => { for (const ch of str) await key(ch, /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : 'Digit' + ch, ch.toUpperCase().charCodeAt(0), 0, ch); };
    const ctrlS = () => key('s', 'KeyS', 83, 2);
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const storedShapes = (name) => evalJs(`(async () => { const s = ${S}; const r = (await s.listRecent({})).find((d) => d.name === ${JSON.stringify(name)}); if (!r) return -1; return (await s.get(r.id)).document.geometry.shapes.length; })()`);
    const shapes = () => evalJs(`document.querySelectorAll('#${H.canvas} .shape-elem').length`);
    const ready = () => waitFor(`(() => { const c = document.getElementById('${H.canvas}'); return !!c && c.dataset.docReady === '1' && c.getBoundingClientRect().width > 0 && !!document.querySelector('.sk-sidebar-btn'); })()`, 'sketchstudio ready', 20000);
    const load = async () => { await navigate(`http://127.0.0.1:${port}${H.url}`, 8000); await ready(); };
    const drawLine = async () => {
      const before = await shapes();
      await clickEl('#tool-line');
      const r = await evalJs(`(() => { const b = document.getElementById('${H.canvas}').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.30), Math.round(r.y + r.h * 0.30)); await click(Math.round(r.x + r.w * 0.55), Math.round(r.y + r.h * 0.30));
      await key('Escape', 'Escape', 27); await sleep(250);
      await waitFor(`document.querySelectorAll('#${H.canvas} .shape-elem').length === ${before + 1}`, 'the drawn line');
    };
    // a page-initiated reload: did the browser raise its leave-page dialog? The helper records every dialog and answers it "stay", so the page with its drawing is kept.
    const { dialogs } = cdp;
    const leaveWarns = async () => {
      const n0 = dialogs.length;
      await evalJs(`setTimeout(() => { location.reload(); }, 0), 1`);
      for (let i = 0; i < 25 && dialogs.length === n0; i++) await sleep(100);
      if (dialogs.length > n0) { assert.deepStrictEqual(dialogs.slice(n0), ['beforeunload'], 'the dialog is the leave-page warning'); await sleep(300); return true; }
      await ready(); // no warning: the page reloaded
      return false;
    };

    // 1. a clean Untitled: no leave-page warning
    await load();
    await resetBufferLive(cdp); await load();
    await clickEl('#tool-select'); // a user gesture on the page
    assert.strictEqual(await leaveWarns(), false, 'a clean Untitled: no leave-page warning');
    // 2. an unsaved Untitled with content: kept in local working buffer across reload (no beforeunload!)
    await drawLine();
    assert.strictEqual(await leaveWarns(), false, 'an unsaved Untitled with content is buffered: no leave-page warning on reload');
    assert.strictEqual(await shapes(), 1, 'reload reopened the Untitled drawing from the working buffer');
    // 3. signed out -> a real Ctrl+S on the unsaved Untitled first asks to sign in; clicking Sign in continues seamlessly to the focused Save as prompt and saves ONLY to Drive
    await clickEl('#tool-line'); await sleep(150);
    await ctrlS();
    await waitFor(`(() => { const b = document.querySelector('.sk-sidebar-ask [data-choice="signin"]'); return !!b && b.getBoundingClientRect().left >= 0; })()`, 'signed out Ctrl+S asks to sign in first', 5000);
    await clickEl('.sk-sidebar-ask [data-choice="signin"]');
    await waitFor(`(() => { const a = document.querySelector('.sk-sidebar-ask input'); return !!a && document.activeElement === a; })()`, 'after sign-in: the Save as name prompt, focused', 5000);
    await key('a', 'KeyA', 65, 2); await typeText('Saved1'); await key('Enter', 'Enter', 13); await sleep(800);
    assert.strictEqual(await storedShapes('Saved1'), 1, 'the typed name stores the drawing');
    assert.strictEqual(driveSession.drive.byName('Saved1.sketch.json').length, 1, 'Saved1 was saved ONLY on Google Drive');
    // 4. a named, saved design: no leave-page warning; the reload restores it
    assert.strictEqual(await leaveWarns(), false, 'a named, saved design: no leave-page warning');
    assert.strictEqual(await shapes(), 1, 'the reload restored the named design');
    console.log('save-key-leave sketchstudio (browser half): ok');
  } finally {
    await cdp.close();
  }
})();
