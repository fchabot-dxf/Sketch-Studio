// tests/parameter-tab-complete-live.test.js - TASK 595: in the real browser, SketchStudio, real keys: typing "wi" in a dimension's box lists
// [width, wing] with the top row highlighted; the real Tab key completes "width" (caret after it, list closed, the box still open and focused:
// the browser's own Tab focus move is prevented); "wi", Down, Tab gives "wing". The node twin: tests/parameter-tab-complete-node.test.js.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '595', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons = 0, clickCount) => send('Input.dispatchMouseEvent', { type, x, y, button: (type === 'mouseMoved' && !buttons) ? 'none' : 'left', buttons, clickCount: clickCount != null ? clickCount : type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); await sleep(250); };
    const clickEl = async (sel) => { const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); await click(c.x, c.y); };
    const key = (k, code, vk) => sendRealKey(send, k, code, vk);
    const type = async (text) => { await send('Input.insertText', { text }); await sleep(120); };
    const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'); const c = document.getElementById('dimComplete'); const shown = !!c && !c.classList.contains('hidden'); const lis = shown ? [...c.querySelectorAll('li')] : []; return { open: !i.classList.contains('hidden'), value: i.value, caret: i.selectionStart, list: shown ? lis.map((li) => li.querySelector('.dc-name').textContent) : null, sel: lis.findIndex((li) => li.getAttribute('aria-selected') === 'true'), active: document.activeElement && document.activeElement.id }; })()`);
    const refocus = () => evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('dimInput'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    const cv = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const A = { x: cv.x - 300, y: cv.y + 20 }, B = { x: cv.x + 108, y: cv.y + 20 };
    const rows = [20, 120, 180, 240].map((dy) => ({ P: { x: A.x, y: cv.y + dy }, Q: { x: B.x, y: cv.y + dy } }));
    await clickEl('#tool-line');
    for (const { P, Q } of rows) { await clickEl('#tool-line'); await click(P.x, P.y); await click(Q.x, Q.y); await key('Escape', 'Escape', 27); await sleep(200); }
    const dimension = async ({ P, Q }, text) => {
      await clickEl('#tool-select'); await clickEl('#tool-dim');
      await click(P.x, P.y); await click(Q.x, Q.y);
      await mouse('mouseMoved', (P.x + Q.x) / 2, P.y - 30); await sleep(200); await click((P.x + Q.x) / 2, P.y - 30);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the dimension box', 8000);
      await refocus();
      if (text) { await type(text); await key('Enter', 'Enter', 13); await sleep(400); }
    };
    // three parameters through the box itself (a dimension typed `name = value` creates the parameter), then a fourth dimension's box
    await dimension(rows[0], 'width = 6'); await dimension(rows[1], 'wing = 2'); await dimension(rows[2], 'height = 9');
    await dimension(rows[3]);
    const names = 'width, wing, height';

    await type('wi');
    let b = await box();
    assert.deepStrictEqual(b.list, ['width', 'wing'], 'the list for "wi" (parameters: ' + names + '): ' + JSON.stringify(b));
    assert.strictEqual(b.sel, 0, 'the top row is highlighted: ' + JSON.stringify(b));
    await key('Tab', 'Tab', 9); await sleep(150);
    b = await box();
    assert.strictEqual(b.value, 'width', 'the real Tab key completes: ' + JSON.stringify(b));
    assert.strictEqual(b.caret, 5, 'caret after it'); assert.strictEqual(b.list, null, 'the list closed');
    assert.strictEqual(b.open, true, 'the box is still open'); assert.strictEqual(b.active, 'dimInput', 'and keeps the focus (the browser Tab focus move was prevented)');
    await refocus(); await key('Backspace', 'Backspace', 8); await key('Backspace', 'Backspace', 8); await key('Backspace', 'Backspace', 8); await key('Backspace', 'Backspace', 8); await key('Backspace', 'Backspace', 8);
    await type('wi'); await key('ArrowDown', 'ArrowDown', 40); await sleep(100);
    b = await box(); assert.strictEqual(b.sel, 1, 'Down moves the highlight: ' + JSON.stringify(b));
    await key('Tab', 'Tab', 9); await sleep(150);
    b = await box(); assert.strictEqual(b.value, 'wing', 'wi, Down, Tab gives wing: ' + JSON.stringify(b));
    console.log('parameter-tab-complete-live: ok');
  } finally { await cdp.close(); }
})();
