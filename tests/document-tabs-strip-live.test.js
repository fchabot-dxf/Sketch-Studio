// tests/document-tabs-strip-live.test.js — TASK 587 (docs/DOCUMENT-TABS-DESIGN.md slice 3): the strip in the REAL SketchStudio page, real pointer.
// Its own row above the header (no header control moves sideways or changes size), click / + / close x, THE question on an unsaved tab,
// the 11th tab (T7), phone width (one line, scrolls), and the other hosts (Shaper, Pen Plotter, Trace) show NO strip.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '587', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name, clip) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1.5 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  try {
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
    };
    const center = async (sel, i = 0) => {
      const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' #' + i + ' not found'); return c;
    };
    const clickEl = async (sel, i = 0) => { const c = await center(sel, i); await click(c.x, c.y); };
    const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
    const headerRects = () => evalJs(`[...document.querySelector('header').querySelectorAll('button, select, input')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)]; })`);
    const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;

    // two stored designs; the page restores the last (Beta)
    await navigate(url('sketchstudio'), 10000);
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio', 'Alpha'));
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio', 'Beta'));
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`!!document.querySelector('.sk-doctabs')`, 'the strip');
    await waitFor(`document.querySelector('.sk-doctab-name') && document.querySelector('.sk-doctab-name').textContent === 'Beta'`, 'the restored design as the first tab');
    assert.deepStrictEqual(await names(), ['Beta']);
    // the strip is its own row immediately above the header; hiding it moves NO header control sideways or resizes one
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').nextElementSibling.tagName`), 'HEADER');
    const withStrip = await headerRects();
    await evalJs(`document.querySelector('.sk-doctabs').hidden = true`); await sleep(100);
    const without = await headerRects();
    await evalJs(`document.querySelector('.sk-doctabs').hidden = false`); await sleep(100);
    assert.deepStrictEqual(withStrip, without, 'every header control keeps its x, width and height');

    // the row's height is fixed: 1 tab or 10, the page below does not move (and not when the tabs first appear)
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').offsetHeight`), 32, 'the strip row is 32 px tall with one tab');
    // "+" opens an Untitled tab; a click on a tab switches
    await clickEl('.sk-doctab-new');
    assert.deepStrictEqual(await names(), ['Beta', 'Untitled']);
    await clickEl('.sk-doctab-main', 0);
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Beta'`, 'Beta active');
    await clickEl('.sk-doctab-main', 1);
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Untitled'`, 'Untitled active');
    // draw in the Untitled tab with the real pointer: it shows the not-saved dot
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', text: 'l', windowsVirtualKeyCode: 76 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
    await click(500, 400); await click(800, 400);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    await waitFor(`!!document.querySelector('.sk-doctab-dot')`, 'the not-saved dot');
    // a third tab, so the evidence shows 3 tabs, one unsaved
    await clickEl('.sk-doctab-new');
    await shot('strip-3-tabs.png', { x: 0, y: 0, width: 700, height: 130 });
    assert.deepStrictEqual(await names(), ['Beta', 'Untitled', 'Untitled']);
    // close the unsaved tab: THE question, Cancel keeps it
    await clickEl('.sk-doctab-x', 1);
    await waitFor(`/This design is not saved/.test(document.body.innerText)`, 'THE question');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.deepStrictEqual(await names(), ['Beta', 'Untitled', 'Untitled'], 'Cancel keeps the tab');

    // the 11th tab (T7)
    for (let i = 0; i < 8; i++) await clickEl('.sk-doctab-new');
    assert.strictEqual((await names()).length, 10);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').offsetHeight`), 32, 'still 32 px with ten tabs');
    await clickEl('.sk-doctab-new');
    assert.strictEqual((await names()).length, 10, 'no 11th tab');
    assert(/Close a tab first/.test(await evalJs(`document.querySelector('.sk-doctabs-msg').textContent`)), 'the strip says why');

    // phone width: one line that scrolls
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const phone = await evalJs(`(() => { const s = document.querySelector('.sk-doctabs'); const tops = [...s.querySelectorAll('.sk-doctab')].map((e) => Math.round(e.getBoundingClientRect().top)); return { oneLine: new Set(tops).size === 1, scrolls: s.scrollWidth > s.clientWidth, w: s.clientWidth }; })()`);
    assert(phone.oneLine && phone.scrolls && phone.w <= 390, 'phone: ' + JSON.stringify(phone));
    await shot('strip-phone.png', { x: 0, y: 0, width: 390, height: 130 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });

    // the other hosts have no strip
    for (const h of ['shaper', 'penplotter', 'trace']) {
      await navigate(url(h), 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, h + ' sidebar');
      await sleep(300);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctabs').length`), 0, h + ' shows no strip');
    }
    console.log('document-tabs-strip-live: ok');
  } finally { await cdp.close(); }
})();
