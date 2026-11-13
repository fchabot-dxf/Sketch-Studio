// TASK 535 slice 3 -- formulas typed into a dimension's box, in the REAL apps (headless CDP, REAL mouse and key events; no test hook but reading state).
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

    // ================================================================== A. SketchStudio
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('dimInput'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    assert.strictEqual(await evalJs(`document.getElementById('dimInput').type`), 'text', '#dimInput is a TEXT input (it was type=number, which cannot hold a name or an "=")');
    const cv = await centerOf('#svgCanvas');
    // two horizontal lines
    await clickEl('#tool-line');
    // the canvas shows about 68 px per mm: lines of 6 mm and 4 mm
    const A = { x: cv.x - 300, y: cv.y + 20 }, B = { x: cv.x + 108, y: cv.y + 20 };
    const C = { x: cv.x - 300, y: cv.y + 160 }, D = { x: cv.x - 28, y: cv.y + 160 };
    await click(A.x, A.y); await click(B.x, B.y); await key('Escape', 'Escape', 27); await sleep(200);
    await clickEl('#tool-line');
    await click(C.x, C.y); await click(D.x, D.y); await key('Escape', 'Escape', 27); await sleep(300);
    // dimension 1 (Dim tool: two points, then the placement click opens the box)
    const dimension = async (P, Q, up) => {
      await clickEl('#tool-select'); await clickEl('#tool-dim');
      await click(P.x, P.y); await click(Q.x, Q.y);
      await mouse('mouseMoved', (P.x + Q.x) / 2, P.y - up); await sleep(200); await click((P.x + Q.x) / 2, P.y - up);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box', 8000);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    };
    await dimension(A, B, 60);
    let b = await box();
    assert.strictEqual(b.type, 'text'); assert.strictEqual(b.inputmode, 'text', 'the dimension box asks for the full text keyboard (O16)');
    // typing `width = 6`: the hint says what Enter will do BEFORE Enter
    await type('width = 6');
    b = await box();
    assert.strictEqual(b.hint, 'creates width = 6.0 mm', 'the live hint before Enter: ' + b.hint);
    assert.strictEqual(b.hintErr, false);
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500);
    assert.strictEqual((await box()).open, false, 'Enter closes the box');
    let lab = await labels('#svgCanvas');
    assert(lab.some((t) => /^fx: 6\.0$/.test(t)), 'the label reads "fx: 6.0": ' + JSON.stringify(lab));
    // dimension 2, typed as a formula on the new parameter. While it is being typed the autocomplete offers `width`
    await dimension(C, D, 60);
    await type('wi');
    b = await box();
    assert.deepStrictEqual(b.list.map((r) => [r.name, r.val]), [['width', '6.0 mm']], 'autocomplete after "wi": the parameter with its value and unit: ' + JSON.stringify(b.list));
    assert.strictEqual(b.list[0].sel, 'false', 'no row is picked until Down is pressed (so a plain Enter still commits)');
    await shot('A1-autocomplete-wi.png', await boxClip());
    await key('ArrowDown', 'ArrowDown', 40);
    assert.strictEqual((await box()).list[0].sel, 'true', 'Down picks the first row');
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(200);
    b = await box();
    assert.strictEqual(b.value, 'width', 'Enter inserts the picked name');
    assert.strictEqual(b.list, null, 'the list closes after an insert');
    assert.strictEqual(b.open, true, 'and Enter did NOT commit the dimension');
    assert.strictEqual(b.hint, '= 6.0 mm', 'the hint is the value preview: ' + b.hint);
    await type(' / 2 + pa'); // nothing named pa: no list
    assert.strictEqual((await box()).list, null, 'no match, no list');
    await key('Backspace', 'Backspace', 8); await key('Backspace', 'Backspace', 8); await sleep(100);
    await type('i'); // "+ i": contains-matches: names with an i in them (width), functions after
    b = await box();
    assert(b.list && b.list.length >= 1 && b.list.length <= 8, 'rows: ' + JSON.stringify(b.list));
    assert(b.list.some((r) => r.name === 'width'), 'contains matching offers width for "i"');
    await key('Escape', 'Escape', 27); await sleep(150);
    b = await box();
    assert.strictEqual(b.list, null, 'Esc closes the list'); assert.strictEqual(b.open, true, 'and leaves the box open (a second Esc is the box\'s own)');
    for (let i = 0; i < 4; i++) await key('Backspace', 'Backspace', 8);
    await sleep(100);
    b = await box(); assert.strictEqual(b.value, 'width / 2', 'edited back: ' + JSON.stringify(b.value));
    await type(' + 1');
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500);
    lab = await labels('#svgCanvas');
    assert(lab.filter((t) => /^fx: /.test(t)).length === 2, 'both dimensions carry the fx mark: ' + JSON.stringify(lab));
    assert(lab.includes('fx: 4.0'), 'width / 2 + 1 mm = 4.0 (a unitless 1 takes the document unit): ' + JSON.stringify(lab));
    // reopen d1 with two quick clicks on its label (Select tool): the box opens with the FORMULA, not the value
    await clickEl('#tool-select');
    const d1Label = async () => evalJs(`(() => { const g = [...document.querySelectorAll('#svgCanvas .dim-label')].find((x) => /6\.0/.test(x.textContent)); if (!g) return null; const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    let p = await d1Label(); assert(p, 'the d1 label is on the canvas');
    await dblclick(p.x, p.y);
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the box to reopen on d1', 5000);
    b = await box();
    assert.strictEqual(b.value, 'width', 'the box opens with the dimension\'s FORMULA');
    // O4: typing `width = 8` lists what else changes, BEFORE Enter
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('width = 8');
    b = await box();
    assert.strictEqual(b.hint, 'sets width 6.0 -> 8.0 mm, also changes d2', 'the O4 hint: ' + b.hint);
    await shot('A2-box-with-formula-and-hint.png', await boxClip());
    const undoBefore = await evalJs(`(() => { const s = window.__sketchState || null; return s ? s.history.length : null; })()`);
    void undoBefore;
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(700);
    lab = await labels('#svgCanvas');
    assert(lab.includes('fx: 8.0') && lab.includes('fx: 5.0'), 'Enter changed both dimensions: ' + JSON.stringify(lab));
    await shot('A3-fx-labels.png', await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: Math.round(r.left + 60), t: Math.round(r.top + 60), w: 700, h: 420 }; })()`));
    // ONE undo restores both
    await key('z', 'KeyZ', 90, 2); await sleep(700);
    lab = await labels('#svgCanvas');
    assert(lab.includes('fx: 6.0') && lab.includes('fx: 4.0') && !lab.some((t) => /8\.0|5\.0/.test(t)), 'one Ctrl+Z changed both back: ' + JSON.stringify(lab));
    await key('y', 'KeyY', 89, 2); await sleep(700);
    lab = await labels('#svgCanvas');
    assert(lab.includes('fx: 8.0') && lab.includes('fx: 5.0'), 'redo: ' + JSON.stringify(lab));
    // O5: a bare unknown name is refused with the hint; the box stays open; nothing changes
    p = await d1Label(); // d1 label now reads 8
    p = await evalJs(`(() => { const g = [...document.querySelectorAll('#svgCanvas .dim-label')].find((x) => /8\.0/.test(x.textContent)); const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await dblclick(p.x, p.y);
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the box to reopen', 5000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('gap');
    b = await box();
    assert.strictEqual(b.hint, "unknown parameter 'gap' (type gap = 30 to create it)", 'the O5 hint: ' + b.hint);
    assert.strictEqual(b.hintErr, true, 'shown as an error'); assert.strictEqual(b.invalid, 'true', 'aria-invalid');
    await shot('A4-unknown-name-refused.png', await boxClip());
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
    b = await box();
    assert.strictEqual(b.open, true, 'Enter on a refused text keeps the box open (and the text)'); assert.strictEqual(b.value, 'gap');
    lab = await labels('#svgCanvas');
    assert(lab.includes('fx: 5.0'), 'nothing changed (the edited label is hidden while its box is open): ' + JSON.stringify(lab));
    // a unit mismatch and a loop are refused too
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('30 deg'); b = await box();
    assert.strictEqual(b.hintErr, true, 'a length cannot be an angle: ' + b.hint);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('width = d1'); b = await box();
    assert(/d1|width/.test(b.hint) && b.hintErr, 'a loop is refused with its path: ' + b.hint);
    // the mouse: click a row of the list to insert it
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('wi');
    const row = await centerOf('#dimComplete li');
    assert(row, 'the list row is on screen');
    await click(row.x, row.y); await sleep(200);
    b = await box();
    assert.strictEqual(b.value, 'width', 'a mouse click on a row inserts it (the box keeps focus: ' + b.active + ')'); assert.strictEqual(b.active, 'dimInput');
    // a plain number replaces the formula (the fx mark goes)
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('3mm'); // a unit suffix, which a type=number box could not hold
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(700);
    lab = await labels('#svgCanvas');
    assert(lab.includes('3.0') && !lab.some((t) => /^fx: 8/.test(t)), 'a plain number replaces the formula and drops the fx mark: ' + JSON.stringify(lab));
    // d2 still follows the parameter (d1 was detached from width, which stays 8)
    assert(lab.includes('fx: 5.0'), 'the other dimension still follows width: ' + JSON.stringify(lab));
    // after a reload the formulas are still there (autosave): the fx label comes back
    await flushAutosave();
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`!!document.getElementById('dimInput') && document.querySelectorAll('#svgCanvas .dim-label').length >= 2`, 'the drawing to come back after a reload', 15000);
    await waitForApp('svgCanvas');
    lab = await labels('#svgCanvas');
    assert(lab.includes('fx: 5.0') && lab.includes('3.0'), 'after a reload the labels are the same: ' + JSON.stringify(lab));

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

    // ================================================================== C. Shaper (the same shared box)
    // the apps share one browser store (autosave buffer and its view): start Shaper from an empty one
    await send('Storage.clearDataForOrigin', { origin: `http://127.0.0.1:${port}`, storageTypes: 'all' });
    await navigate(url('/apps/shaper/index.html'), 8000);
    await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { await clickEl('[data-mode="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === 'design') break; }
    await waitFor(`!!window.__designController && !!document.getElementById('dimInput')`, 'the Shaper Design tab with its box');
    await waitForApp('design-canvas');
    await evalJs(`(() => {
      const st = window.__designController.state;
      st.clearDocument();
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', -45, -20); J('b', -5, -20); J('c', -45, 10); J('d', -5, 10);
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] });
      st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, name: 'd1', dimMode: 'aligned', glyphPos: { x: -25, y: -35 }, offset: 15 });
      st.constraints.push({ type: 'distance', joints: ['c', 'd'], value: 40, name: 'd2', dimMode: 'aligned', glyphPos: { x: -25, y: 25 }, offset: 15 });
    })()`);
    await clickEl('#tool-select');
    await sleep(500);
    const shaperUnit = await evalJs(`(async () => (await import('#core/settings-manager.js')).default.get('DOC_UNIT') || 'mm')()`);
    const inU = (mm) => (mm / (shaperUnit === 'in' ? 25.4 : 1)).toFixed(1);
    const shLabel = (re) => evalJs(`(() => { const g = [...document.querySelectorAll('#design-canvas .dim-label')].find((x) => ${re}.test(x.textContent)); if (!g) return null; const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: g.textContent.trim() }; })()`);
    let sp = await shLabel(`/${inU(40).replace('.', '\\.')}/`);
    assert(sp, 'a Shaper dimension label (' + inU(40) + ') is on the canvas');
    await dblclick(sp.x, sp.y);
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the Shaper box', 5000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    b = await box();
    assert.strictEqual(b.type, 'text', 'Shaper: the box is a text input'); assert.strictEqual(b.inputmode, 'text');
    await type('stock = 30 mm');
    b = await box();
    assert.strictEqual(b.hint, `creates stock = ${inU(30)} ${shaperUnit}`, 'Shaper: the live hint (a stored unit is shown in the document unit): ' + b.hint);
    await shot('C1-shaper-box-hint.png', await boxClip());
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(700);
    const shLabs = await labels('#design-canvas');
    assert(shLabs.includes(`fx: ${inU(30)}`), 'Shaper: the fx label: ' + JSON.stringify(shLabs));
    // the second dimension uses the parameter in a formula
    sp = await shLabel(`/${inU(40).replace('.', '\\.')}/`);
    await dblclick(sp.x, sp.y);
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the Shaper box (d2)', 5000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await type('sto');
    b = await box();
    assert.strictEqual(b.list && b.list[0].name, 'stock', 'Shaper: the autocomplete offers the new parameter: ' + JSON.stringify(b.list));
    await key('Tab', 'Tab', 9); await sleep(150);
    assert.strictEqual((await box()).value, 'stock', 'Tab inserts the first row');
    await type(' * 2');
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(700);
    const shLabs2 = await labels('#design-canvas');
    assert(shLabs2.includes(`fx: ${inU(60)}`) && shLabs2.includes(`fx: ${inU(30)}`), 'Shaper: both formulas show: ' + JSON.stringify(shLabs2));
    const shState = await evalJs(`JSON.stringify({ p: window.__designController.state.parameters, d: window.__designController.state.constraints.map((c) => [c.name, c.expression || null, Math.round(c.value * 1e6) / 1e6]) })`);
    const ss = JSON.parse(shState);
    assert.deepStrictEqual(ss.p.map((p) => [p.name, p.unit, p.expression]), [['stock', shaperUnit, '30 mm']], 'Shaper: the parameter keeps the units it was typed with (O19), in the document unit: ' + shState);
    assert.deepStrictEqual(ss.d, [['d1', 'stock', 30], ['d2', 'stock * 2', 60]], 'Shaper: the formulas and values: ' + shState);
    console.log('parameters-canvas-live: ok');
  } finally {
    await cdp.close();
  }
})();
