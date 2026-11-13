// tests/save-key-leave-runner.js — TASK 558 (owner rulings 2026-11-12), live in a real host, REAL keys and clicks:
//   Ctrl+S on an unsaved Untitled opens the Save as name prompt (in the sidebar); the typed name stores it.
//   Ctrl+S on a named design writes the pending autosave NOW (before the 1.5 s poll); no prompt.
//   Ctrl+S never reaches the canvas shortcuts (a bare "s" there picks the Select tool).
//   The browser's leave-page warning (beforeunload) is armed while an unsaved Untitled has content, and NOT for a clean Untitled or a
//   named, saved design (a page-initiated reload is the probe: CDP's own Page.navigate never runs beforeunload).
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { HOSTS } from './unsaved-prompt-runner.js';

export async function runSaveKeyLeave({ host }) {
  const H = HOSTS[host];
  const cdp = await launchBrowser({ tag: 'savekey-' + host, width: 1400, height: 850, leaveDialog: 'stay' }); // the leave-page warning: answered "stay"
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const clickEl = async (sel) => { const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
    const typeText = async (str) => { for (const ch of str) await key(ch, /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : 'Digit' + ch, ch.toUpperCase().charCodeAt(0), 0, ch); };
    const ctrlS = () => key('s', 'KeyS', 83, 2);
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const storedShapes = (name) => evalJs(`(async () => { const s = ${S}; const r = (await s.listRecent({})).find((d) => d.name === ${JSON.stringify(name)}); if (!r) return -1; return (await s.get(r.id)).document.geometry.shapes.length; })()`);
    const shapes = () => evalJs(`document.querySelectorAll('#${H.canvas} .shape-elem').length`);
    const ready = () => waitFor(`(() => { const c = document.getElementById('${H.canvas}'); return !!c && c.dataset.docReady === '1' && c.getBoundingClientRect().width > 0 && !!document.querySelector('.sk-sidebar-btn'); })()`, host + ' ready', 20000);
    const enterDesign = async () => { if (host === 'penplotter') { await waitFor(`!!document.querySelector('.stage-btn[data-stage="design"]')`, 'stages'); await evalJs(`document.querySelector('.stage-btn[data-stage="design"]').click()`); } await ready(); };
    const load = async () => { await navigate(`http://127.0.0.1:${port}${H.url}`, 8000); await enterDesign(); };
    let n = 0;
    const drawLine = async () => {
      const before = await shapes();
      await clickEl('#tool-line');
      const r = await evalJs(`(() => { const b = document.getElementById('${H.canvas}').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      const dy = 0.08 * (n++);
      await click(Math.round(r.x + r.w * 0.30), Math.round(r.y + r.h * (0.30 + dy))); await click(Math.round(r.x + r.w * 0.55), Math.round(r.y + r.h * (0.30 + dy)));
      await key('Escape', 'Escape', 27); await sleep(250);
      await waitFor(`document.querySelectorAll('#${H.canvas} .shape-elem').length === ${before + 1}`, 'the drawn line');
    };
    // a page-initiated reload: did the browser raise its leave-page dialog? The helper records every dialog and answers it "stay", so the page
    // with its drawing is kept.
    const { dialogs } = cdp;
    const leaveWarns = async () => {
      const n0 = dialogs.length;
      await evalJs(`setTimeout(() => { location.reload(); }, 0), 1`);
      for (let i = 0; i < 25 && dialogs.length === n0; i++) await sleep(100);
      if (dialogs.length > n0) { assert.deepStrictEqual(dialogs.slice(n0), ['beforeunload'], 'the dialog is the leave-page warning'); await sleep(300); return true; }
      await enterDesign(); // no warning: the page reloaded
      return false;
    };

    // 1. a clean Untitled: no leave-page warning
    console.log(`${host} step 1`);
    await load();
    await evalJs(`(async () => { await ${S}.setCurrent(null); })()`); await load();
    await clickEl('#tool-select'); // a user gesture on the page (the browser shows the warning only after one)
    assert.strictEqual(await leaveWarns(), false, 'a clean Untitled: no leave-page warning');
    // 2. an unsaved Untitled with content: the warning is armed (stay: the drawing is still there)
    console.log(`${host} step 2`);
    await drawLine();
    assert.strictEqual(await leaveWarns(), true, 'an unsaved Untitled with content: the leave-page warning is armed');
    assert.strictEqual(await shapes(), 1, 'stayed: the drawing is kept');
    // 3. Ctrl+S on the unsaved Untitled: the Save as name prompt, in the sidebar; Ctrl+S does not pick the Select tool
    console.log(`${host} step 3`);
    await clickEl('#tool-line'); await sleep(150);
    const lineActive = () => evalJs(`document.getElementById('tool-line').classList.contains('active')`);
    const activeBefore = await lineActive();
    await ctrlS();
    await waitFor(`(() => { const a = document.querySelector('.sk-sidebar-ask input'); return !!a && document.activeElement === a; })()`, 'Ctrl+S on an unsaved design: the Save as name prompt', 5000);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-ask input').value`), 'Untitled', 'the prompt starts from the current name');
    await key('a', 'KeyA', 65, 2); await typeText('Saved1'); await key('Enter', 'Enter', 13); await sleep(700);
    assert.strictEqual(await storedShapes('Saved1'), 1, 'the typed name stores the drawing');
    assert.strictEqual(await evalJs('document.title'), `Saved1 — ${H.name}`, 'and it is the named, current design');
    assert.strictEqual(await lineActive(), activeBefore, 'Ctrl+S did not switch the tool');
    // 4. Ctrl+S on the named design: the pending edit is written NOW (the autosave poll is 1.5 s), no prompt
    console.log(`${host} step 4`);
    await drawLine();
    await ctrlS(); await sleep(500);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar-ask')`), false, 'Ctrl+S on a named design asks nothing');
    assert.strictEqual(await storedShapes('Saved1'), 2, 'Ctrl+S on a named design wrote the new line at once');
    // 5. a named, saved design: no leave-page warning; the reload restores it
    console.log(`${host} step 5`);
    assert.strictEqual(await leaveWarns(), false, 'a named, saved design: no leave-page warning');
    assert.strictEqual(await shapes(), 2, 'the reload restored the named design');
    console.log(`save-key-leave ${host}: ok`);
  } finally {
    await cdp.close();
  }
}
