// tests/document-tabs-strip-live.test.js — TASK 587 (docs/DOCUMENT-TABS-DESIGN.md slice 3): the strip in the REAL SketchStudio page, real pointer.
// Its own row BELOW the header, above the ribbon (TASK 602, owner; no header control moves sideways or changes size, nothing overlaps it: the header,
// the ribbon, the SKETCHES box, the Construction / Recenter buttons), click / + / close x, THE question on an unsaved tab, the 11th tab (T7), and the
// other hosts (Shaper, Pen Plotter, Trace) show the same strip (TASK 605; their stage switching is tests/document-tabs-stages-live.test.js).
// TASK 602 sizes (owner: "tabs can be minimal size"): a 26 px row with a mouse, a 45 px row under a finger (44 px tabs, close x and "+": real 44 px
// targets). Widths like browser tabs: 1 or 2 tabs at the full 240 px, shrinking evenly as more open, never below the minimum (72 px mouse, 104 px finger),
// then the row scrolls sideways with the active tab in view; measured with 1, 2, 5 and 10 tabs at 1400 px (mouse) and 390 px (touch).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '587', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
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
    const widths = () => evalJs(`[...document.querySelectorAll('.sk-doctab')].map((e) => Math.round(e.getBoundingClientRect().width))`);
    // TASK 602: the strip is between the header's bottom and the ribbon's top, and overlaps none of the header, the ribbon, the SKETCHES box, the canvas buttons
    const checkPlace = async (what) => {
      const b = await evalJs(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const x = e.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, left: x.left, right: x.right }; };
        return { strip: r('.sk-doctabs'), header: r('header'), ribbon: r('#toolsRibbon'), box: r('.sk-browser'), construct: r('#btn-construct-toggle'), recenter: r('#btn-recenter-view') }; })()`);
      const topExpected = b.header ? b.header.bottom : 0;
      assert(Math.abs(b.strip.top - topExpected) < 0.5 && b.strip.bottom <= b.ribbon.top + 0.5, what + ': the strip is right under the header (or at top on phones), above the ribbon: ' + JSON.stringify(b));
      for (const k of ['box', 'construct', 'recenter']) {
        const o = b[k]; if (!o) continue;
        assert(o.top >= b.strip.bottom - 0.5 || o.bottom <= b.strip.top + 0.5 || o.left >= b.strip.right - 0.5 || o.right <= b.strip.left + 0.5, `${what}: the strip does not overlap ${k}: ` + JSON.stringify(b));
      }
    };
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
    // the strip is its own row immediately below the header; hiding it moves NO header control sideways or resizes one
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').previousElementSibling.tagName`), 'HEADER');
    const withStrip = await headerRects();
    await evalJs(`document.querySelector('.sk-doctabs').hidden = true`); await sleep(100);
    const without = await headerRects();
    await evalJs(`document.querySelector('.sk-doctabs').hidden = false`); await sleep(100);
    assert.deepStrictEqual(withStrip, without, 'every header control keeps its x, width and height');

    // the row's height is fixed: 1 tab or 10, the page below does not move (and not when the tabs first appear)
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').offsetHeight`), 26, 'the strip row is 26 px tall with one tab (TASK 602)');
    // TASK 602: the strip sits between the header's bottom and the ribbon's top, and overlaps nothing (header, ribbon, SKETCHES box, Construction / Recenter)
    await waitFor(`!!document.querySelector('.sk-browser') && document.querySelector('.sk-browser').getClientRects().length > 0`, 'the floating SKETCHES box');
    await checkPlace('1400 px');
    await shot('strip-with-sketches-box-1440.png', { x: 0, y: 0, width: 760, height: 260 });
    assert.deepStrictEqual(await widths(), [240], '1 tab: full width (240 px)');
    // "+" opens an Untitled tab; a click on a tab switches
    await clickEl('.sk-doctab-new');
    assert.deepStrictEqual(await names(), ['Beta', 'Untitled']);
    assert.deepStrictEqual(await widths(), [240, 240], '2 tabs: both at full width');
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

    // the 11th tab (T7); widths at 5 and 10 tabs
    for (let i = 0; i < 2; i++) await clickEl('.sk-doctab-new');
    assert.strictEqual((await names()).length, 5);
    assert.deepStrictEqual(await widths(), [240, 240, 240, 240, 240], '5 tabs fit at 1400 px: full width');
    for (let i = 0; i < 5; i++) await clickEl('.sk-doctab-new');
    assert.strictEqual((await names()).length, 10);
    const w10 = await widths();
    assert(w10.every((w) => w === w10[0]) && w10[0] < 240 && w10[0] >= 72, '10 tabs shrink evenly, not below 72 px: ' + JSON.stringify(w10));
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').scrollWidth <= document.querySelector('.sk-doctabs').clientWidth`), true, '10 tabs fit at 1400 px without scrolling');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').offsetHeight`), 26, 'still 26 px with ten tabs');
    await checkPlace('1400 px, 10 tabs');
    await clickEl('.sk-doctab-new');
    assert.strictEqual((await names()).length, 10, 'no 11th tab');
    assert(/Close a tab first/.test(await evalJs(`document.querySelector('.sk-doctabs-msg').textContent`)), 'the strip says why');

    // phone (390 x 844, a finger): a 31 px row (TASK 608, owner ruling; was 45), tabs the full row height, close x / + >= 24 x 24; widths at 1, 2, 5, 10 tabs (real taps on "+"); one line that scrolls, the active tab in view
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1`, 'phone: one restored tab');
    await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn')`, 'phone: the ribbon');
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tapNew = async () => { await evalJs(`document.querySelector('.sk-doctab-new').scrollIntoView({ inline: 'nearest', block: 'nearest' })`); await sleep(80); const c = await center('.sk-doctab-new'); await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(350); };
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').offsetHeight`), 31, 'phone: the strip row is 31 px (30 px tabs + its line)');
    await checkPlace('phone');
    const phoneW = { 1: await widths() };
    await tapNew(); phoneW[2] = await widths();
    for (let i = 0; i < 3; i++) await tapNew();
    phoneW[5] = await widths();
    for (let i = 0; i < 5; i++) await tapNew();
    phoneW[10] = await widths();
    assert.deepStrictEqual(phoneW[1], [240], 'phone, 1 tab: full width');
    assert(phoneW[2].length === 2 && phoneW[2][0] === phoneW[2][1] && phoneW[2][0] < 240 && phoneW[2][0] > 104, 'phone, 2 tabs share the row evenly: ' + JSON.stringify(phoneW[2]));
    assert(phoneW[5].every((w) => w === 104) && phoneW[10].length === 10 && phoneW[10].every((w) => w === 104), 'phone, 5 and 10 tabs stop at the 104 px minimum: ' + JSON.stringify([phoneW[5], phoneW[10]]));
    const phone = await evalJs(`(() => { const s = document.querySelector('.sk-doctabs'); const tops = [...s.querySelectorAll('.sk-doctab')].map((e) => Math.round(e.getBoundingClientRect().top)); const a = s.querySelector('.sk-doctab.active').getBoundingClientRect(); const sr = s.getBoundingClientRect();
      const targets = [...s.querySelectorAll('.sk-doctab-main, .sk-doctab-x, .sk-doctab-new')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      return { oneLine: new Set(tops).size === 1, scrolls: s.scrollWidth > s.clientWidth, w: s.clientWidth, activeInView: a.left >= sr.left - 0.5 && a.right <= sr.right + 0.5, small: targets.filter(([w, h]) => w < 24 || h < 24) }; })()`);
    assert(phone.oneLine && phone.scrolls && phone.w <= 390 && phone.activeInView, 'phone: one line that scrolls, the active tab in view: ' + JSON.stringify(phone));
    assert.deepStrictEqual(phone.small, [], 'phone: every tab, close x and "+" is at least 24 x 24 (WCAG 2.2 AA minimum target)');
    await shot('strip-phone.png', { x: 0, y: 0, width: 390, height: 200 });
    console.log('strip widths: 1400 px 1/2/5 tabs 240, 10 tabs ' + w10[0] + '; phone ' + JSON.stringify(phoneW));
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });

    // TASK 605: the other hosts show the SAME strip: the row right under the header (26 px), the host's own content starts below it (nothing under it)
    for (const h of ['shaper', 'penplotter', 'trace']) {
      await navigate(url(h), 10000);
      await waitFor(`!!document.querySelector('.sk-doctabs') && !!document.querySelector('.sk-doctab-name')`, h + ' strip');
      const g = await evalJs(`(() => { const s = document.querySelector('.sk-doctabs'), hd = document.querySelector('header'); const sr = s.getBoundingClientRect(), hr = hd.getBoundingClientRect();
        const below = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2); return { prev: s.previousElementSibling === hd, h: Math.round(sr.height), gap: Math.abs(sr.top - hr.bottom), onTop: s.contains(below), statusText: !!document.getElementById('save-status') || !!document.getElementById('tr-status') }; })()`);
      assert(g.prev && g.h === 26 && g.gap < 0.5 && g.onTop, h + ': the strip is the 26 px row right under the header and nothing covers it: ' + JSON.stringify(g));
      assert.strictEqual(g.statusText, false, h + ': no header status text any more (the tab dot shows the state)');
    }
    console.log('document-tabs-strip-live: ok');
  } finally { await cdp.close(); }
})();
