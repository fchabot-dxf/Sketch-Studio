// TASK 535 slice 3 -- formulas typed into a dimension's box, PART B ONLY (parts A and C moved to tests/parameters-canvas-node.test.js, task 580).
// (original header:)
//  A. SketchStudio at 1400 px: `width = 6` creates a parameter and the label reads "fx: 6.0"; a second dimension typed `width` follows it; the O4 hint lists
//     the other dimension BEFORE Enter; Enter changes both in ONE undo step; an unknown name is refused with the O5 hint and the box stays open; the
//     autocomplete list (rows with value and unit, Down + Enter, Esc, a mouse click); the box is a TEXT input (#dimInput is no longer type=number); plain numbers
//     still work and drop the formula; the labels survive a reload.
//  B. the 390 px phone layout: the box is a text input with the TEXT keyboard (inputmode), the hint and the autocomplete list fit inside the screen.
//  C. Shaper: the same box (the shared code), a formula and `name = value` on a seeded drawing, the fx label.
// EVIDENCE_DIR (optional): screenshots are written there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';


await (async () => {
  const cdp = await launchBrowser({ tag: '535-3', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  try {
    const mouse = (type, x, y, buttons = 0, clickCount) => send('Input.dispatchMouseEvent', { type, x, y, button: (type === 'mouseMoved' && !buttons) ? 'none' : 'left', buttons, clickCount: clickCount != null ? clickCount : type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); await sleep(250); };
    const dblclick = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); for (const n of [1, 2]) { await mouse('mousePressed', x, y, 1, n); await sleep(30); await mouse('mouseReleased', x, y, 0, n); await sleep(60); } await sleep(300); };
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
    const type = async (text) => { await send('Input.insertText', { text }); await sleep(120); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' is on screen'); await click(c.x, c.y); };
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
    const shot = async (name, clip) => {
      const p = { format: 'png' };
      if (clip) p.clip = { x: clip.l, y: clip.t, width: clip.w, height: clip.h, scale: 2 };
      const buf = Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return createHash('md5').update(buf).digest('hex');
    };
    // a clip around the box + hint + list (the picture must show them at a legible size)
    const boxClip = async (pad = 70) => {
      const els = ['#dimInput', '#dimHint', '#dimComplete'].map((s) => rectOf(s));
      const rs = (await Promise.all(els)).filter(Boolean);
      const l = Math.max(0, Math.min(...rs.map((r) => r.l)) - pad), t = Math.max(0, Math.min(...rs.map((r) => r.t)) - pad), r = Math.max(...rs.map((x) => x.r)) + pad, b = Math.max(...rs.map((x) => x.b)) + pad;
      return { l, t, w: r - l, h: b - t };
    };
    const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'); const h = document.getElementById('dimHint'); const c = document.getElementById('dimComplete'); const open = !i.classList.contains('hidden'); return { open, value: i.value, type: i.type, inputmode: i.inputMode, hint: h && !h.classList.contains('hidden') ? h.textContent : null, hintErr: !!(h && h.classList.contains('err')), invalid: i.getAttribute('aria-invalid'), list: c && !c.classList.contains('hidden') ? [...c.querySelectorAll('li')].map((li) => ({ name: li.querySelector('.dc-name').textContent, val: li.querySelector('.dc-val').textContent, sel: li.getAttribute('aria-selected') })) : null, active: document.activeElement && document.activeElement.id }; })()`);
    const labels = (sel) => evalJs(`JSON.stringify([...document.querySelectorAll('${sel} .dim-label')].map((g) => g.textContent.trim().replace(/\\s+/g, ' ')))`).then(JSON.parse);

    // ================================================================== setup: SketchStudio with one formula dimension (parts A and C moved to node, task 580)
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('dimInput'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    const cv = await centerOf('#svgCanvas');
    const A = { x: cv.x - 300, y: cv.y + 20 }, B = { x: cv.x + 108, y: cv.y + 20 };
    await clickEl('#tool-line');
    await click(A.x, A.y); await click(B.x, B.y); await key('Escape', 'Escape', 27); await sleep(300);
    await clickEl('#tool-dim');
    await click(A.x, A.y); await click(B.x, B.y);
    await mouse('mouseMoved', (A.x + B.x) / 2, A.y - 60); await sleep(200); await click((A.x + B.x) / 2, A.y - 60);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box', 8000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('width = 6');
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500);
    let b;
    let lab = await labels('#svgCanvas');
    assert(lab.some((t) => /^fx: 6\.0$/.test(t)), 'the label reads "fx: 6.0": ' + JSON.stringify(lab));

    // ================================================================== B. 390 px phone layout
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    await clickEl('#tool-select').catch(async () => { await evalJs(`document.getElementById('tool-select').scrollIntoView({ inline: 'center' })`); await sleep(200); await clickEl('#tool-select'); });
    const fx = await evalJs(`(() => { const g = [...document.querySelectorAll('#svgCanvas .dim-label')].find((x) => /fx/.test(x.textContent)); if (!g) return null; g.scrollIntoView({ block: 'center', inline: 'center' }); const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(fx, 'a formula label is on the 390 px canvas');
    await dblclick(fx.x, fx.y);
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the box on a phone-width screen', 5000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('p');
    await type('a');
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.value = 'width / 2 + w'; i.setSelectionRange(13, 13); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(200);
    b = await box();
    assert.deepStrictEqual([b.type, b.inputmode], ['text', 'text'], 'the box asks a phone for the TEXT keyboard (type=text, inputmode=text)');
    assert(b.list && b.list.length >= 1, 'the list is open: ' + JSON.stringify(b));
    const vw = 390;
    for (const sel of ['#dimInput', '#dimHint', '#dimComplete']) {
      const r = await rectOf(sel);
      assert(r, sel + ' is visible at 390 px');
      assert(r.l >= 0 && r.r <= vw, `${sel} fits inside the 390 px screen: ${JSON.stringify(r)}`);
    }
    const list = await rectOf('#dimComplete'), input = await rectOf('#dimInput'), hint = await rectOf('#dimHint');
    assert(list.b <= 800 && hint.b <= 800 && list.t >= 0 && hint.t >= 0, 'and inside the screen vertically');
    const overlaps = (a, c) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    assert(!overlaps(list, input) && !overlaps(hint, input) && !overlaps(list, hint), 'the list and the hint never cover the box or each other: ' + JSON.stringify({ input, list, hint }));
    assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'no horizontal page overflow at 390 px');
    assert(list.h / 34 <= 8.5, 'at most about 8 rows');
    await shot('B1-phone-390-autocomplete.png', await boxClip(30));
    await key('Escape', 'Escape', 27); await key('Escape', 'Escape', 27); await sleep(200);
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(500);

    console.log('parameters-canvas-live: ok');
  } finally {
    await cdp.close();
  }
})();
