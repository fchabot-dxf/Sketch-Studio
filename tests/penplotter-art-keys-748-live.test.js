// tests/penplotter-art-keys-748-live.test.js: TASK 748 (live headless, REAL keys). Pen Plotter's Toolpath ("Prepare") and Export stages: the ten letters the
// retired art-tool keys held (V T S L R E P F X N) and Enter (the retired polyline finish) change no tool state any more. What the app exposes:
// the shared plotter canvas's class list (setTool put tool-<name> there), body.shape-tools, the Design ribbon's active tool, and the active stage.
// The letters are printed with what they now do (nothing observable here: no handler listens for them in these stages). Screenshots: .evidence/748.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '748');
const LETTERS = [['v', 'KeyV', 86], ['t', 'KeyT', 84], ['s', 'KeyS', 83], ['l', 'KeyL', 76], ['r', 'KeyR', 82], ['e', 'KeyE', 69], ['p', 'KeyP', 80], ['f', 'KeyF', 70], ['x', 'KeyX', 88], ['n', 'KeyN', 78]];

await (async () => {
  const cdp = await launchBrowser({ tag: '748', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(300); };
    const clickSel = async (sel) => { const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const key = async (k, code, vk, text = '') => { await sendRealKey(send, k, code, vk, 0, text); await sleep(200); };
    const snapshot = () => evalJs(`(() => { const c = document.getElementById('canvas'); const a = document.querySelector('.sk-ribbon [aria-pressed="true"], .sk-ribbon .active');
      return { stage: (document.querySelector('.sk-header-tab[aria-selected="true"], .sk-header-tab.active') || {}).dataset ? document.querySelector('.sk-header-tab[aria-selected="true"], .sk-header-tab.active').dataset.tab : null,
        canvasClass: c ? c.getAttribute('class') : null, shapeTools: document.body.classList.contains('shape-tools'), ribbon: a ? a.id : null, bodyClass: document.body.className }; })()`);
    const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };

    await resetBufferLive(cdp); // a clean Untitled design: the shared open-tabs list carries nothing in
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="toolpath"]')`, 'Pen Plotter ready'); await sleep(600);

    for (const stage of ['toolpath', 'export']) {
      await clickSel(`.sk-header-tab[data-tab="${stage}"]`); await sleep(700);
      const base = await snapshot();
      assert.strictEqual(base.stage, stage, `on the ${stage} stage: ` + JSON.stringify(base));
      assert(!/tool-(rotate|scale|line|rect|ellipse|polyline|freehand|scissors|node)/.test(base.canvasClass || ''), `${stage}: no art tool class to start with`);
      for (const [ch, code, vk] of LETTERS) {
        await key(ch, code, vk, ch);
        assert.deepStrictEqual(await snapshot(), base, `${stage}: a bare ${ch.toUpperCase()} changes no tool state`);
      }
      await key('Enter', 'Enter', 13);
      assert.deepStrictEqual(await snapshot(), base, `${stage}: Enter changes no tool state`);
      await shot(`${stage}-after-ten-letters.png`);
      console.log(stage, 'ok: V T S L R E P F X N and Enter change nothing; state', JSON.stringify(base));
    }
    console.log('penplotter-art-keys-748-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
