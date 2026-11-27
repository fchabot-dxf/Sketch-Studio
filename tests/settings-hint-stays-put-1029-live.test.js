// tests/settings-hint-stays-put-1029-live.test.js — TASK 1029 / BUG-243: opening a hint in the Settings panel never moves anything under the pointer.
// The panel was centred by translate(-50%,-50%): the hint opening grew it, the "i" slid from under a resting pointer, pointerleave closed the hint, the
// panel shrank back, pointerenter opened it again (a ~16 ms flicker loop) and the click missed. Desktop 1280 x 800 and phone width 390 x 844.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { blockRemote } from './helpers/block-remote.js';

const TRIG = `.sk-style-panel [data-row="TRAILING_ZEROS"] .sk-hint-i`;
const HINT = `.sk-style-panel [data-row="TRAILING_ZEROS"] .sk-hint`;

async function phase(name, width, height) {
  const cdp = await launchBrowser({ tag: '1029-' + name, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return false; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    await blockRemote(cdp);
    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    await navigate(url, 10000); await waitForApp('design-canvas');
    await resetBufferLive(cdp);
    await navigate(url, 10000); await waitForApp('design-canvas');
    await evalJs(`document.querySelector('#btn-settings').click()`);
    await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, name + ': Settings open');
    await evalJs(`document.querySelector('.sk-style-panel .sk-style-tab[data-tab="units"]').click()`);
    await waitFor(`!!document.querySelector('${TRIG}')`, name + ': the trigger exists');
    await evalJs(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const rectJs = `(() => { const b = document.querySelector('${TRIG}').getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(','); })()`;
    const before = await evalJs(rectJs);
    const [l, t, w, h] = before.split(',').map(Number);
    const x = l + w - 1, y = t + h - 1; // the trigger's own bottom-right corner: the edge
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await waitFor(`!document.querySelector('${HINT}').hidden`, name + ': hover opens the hint');
    await evalJs(`new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 300))`); // would a flicker loop run? let it
    assert.strictEqual(await evalJs(rectJs), before, name + ': the "i" did not move when its hint opened');
    assert.strictEqual(await evalJs(`!document.querySelector('${HINT}').hidden`), true, name + ': the hover hint stays open under the resting pointer');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
    await evalJs(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    assert.strictEqual(await evalJs(`!document.querySelector('${HINT}').hidden`), true, name + ': the click pinned the hint (still open with the pointer away)');
    console.log(name + ': ok ' + before);
  } finally { await cdp.close(); }
  return true;
}
if (await phase('desktop', 1280, 800)) await phase('phone', 390, 844);
console.log('settings-hint-stays-put-1029-live: ok');
