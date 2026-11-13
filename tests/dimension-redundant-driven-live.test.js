// tests/dimension-redundant-driven-live.test.js -- TASK 516 (live headless, REAL mouse + keyboard, SketchStudio): a dimension on a quantity the
// sketch already determines is placed DRIVEN (bracketed, measured value) and cannot be typed; a non-redundant one still opens the value box.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '516' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const dblClick = async (x, y) => { await mouse('mouseMoved', x, y, 0); for (let i = 0; i < 2; i++) { await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(60); } await sleep(300); };
    const rightClick = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(150); await mouse('mousePressed', x, y, 2, 'right'); await mouse('mouseReleased', x, y, 0, 'right'); await sleep(500); };
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', to.x, to.y, 0); await sleep(400);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const lines = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => { const m = e.getScreenCTM(); const pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }); return [pt(+e.getAttribute('x1'), +e.getAttribute('y1')), pt(+e.getAttribute('x2'), +e.getAttribute('y2'))]; }))`).then(JSON.parse);
    const labels = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim()))`).then(JSON.parse);
    const boxOpen = () => evalJs(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden') && i.getBoundingClientRect().width > 0; })()`);
    const key = (k, code, vk, mods = 0) => sendRealKey(send, k, code, vk, mods);
    const typeValue = async (text) => {
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension value input to open', 8000);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
      await send('Input.insertText', { text }); await sleep(100);
      await key('Enter', 'Enter', 13); await sleep(500);
    };
    const shot = async (name) => { if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
    const menu = () => evalJs(`(() => { const m = document.querySelector('.sk-context-menu'); if (!m) return null; return [...m.querySelectorAll('.sk-context-item')].map(r => ({ id: r.dataset.id, checked: r.getAttribute('aria-checked') })); })()`);
    const toasts = () => evalJs(`JSON.stringify([...document.querySelectorAll('#notification-container pre')].map(e => e.textContent.trim()))`).then(JSON.parse);

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-rect') && !!document.getElementById('tool-dim'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    const cv = await centerOf('#svgCanvas');

    // a rectangle, one corner locked, width and height dimensioned: fully constrained. Each of these two dimensions is NOT redundant, so
    // typeValue (which waits for the value box to open) is the check that a non-redundant dimension still opens the box and its typed value drives.
    await clickEl('#tool-rect');
    const A = { x: cv.x - 120, y: cv.y - 100 }, C = { x: cv.x + 120, y: cv.y + 100 };
    await drag(A, C);
    await clickEl('#tool-select');
    const corners = async () => { const l = await lines(); const xs = l.flat(); const x0 = Math.min(...xs.map(p => p.x)), x1 = Math.max(...xs.map(p => p.x)), y0 = Math.min(...xs.map(p => p.y)), y1 = Math.max(...xs.map(p => p.y)); return { x0, x1, y0, y1 }; };
    let R = await corners();
    await rightClick(R.x0, R.y0);
    await clickEl('.sk-context-menu .sk-context-item[data-id="geo-lock"]'); await sleep(300);
    const dimPts = async (a, b, drop, val) => { await clickEl('#tool-dim'); await click(a.x, a.y); await click(b.x, b.y); await mouse('mouseMoved', drop.x, drop.y, 0); await sleep(200); await click(drop.x, drop.y); if (val) await typeValue(val); };
    await dimPts({ x: R.x0, y: R.y0 }, { x: R.x1, y: R.y0 }, { x: (R.x0 + R.x1) / 2, y: R.y0 - 60 }, '3');
    R = await corners();
    await dimPts({ x: R.x1, y: R.y0 }, { x: R.x1, y: R.y1 }, { x: R.x1 + 60, y: (R.y0 + R.y1) / 2 }, '3');
    R = await corners();
    // ---------------------------------------------------------------- 1. the diagonal of the fully constrained square is placed DRIVEN
    const bracketed = `[...document.querySelectorAll('#svgCanvas .dim-label')].find(x => x.textContent.trim().startsWith('('))`;
    const plainWith = (re) => `[...document.querySelectorAll('#svgCanvas .dim-label')].find(x => !x.textContent.trim().startsWith('(') && ${re}.test(x.textContent))`;
    const ptOf = async (finder, what) => { const c = await evalJs(`(() => { const e = ${finder}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); assert(c, what + ' is on screen'); return c; };
    await clickEl('#tool-dim');
    await click(R.x0, R.y0); await click(R.x1, R.y1);
    await mouse('mouseMoved', (R.x0 + R.x1) / 2 + 40, (R.y0 + R.y1) / 2 - 40, 0); await sleep(200);
    await click((R.x0 + R.x1) / 2 + 40, (R.y0 + R.y1) / 2 - 40);
    await sleep(600);
    assert.strictEqual(await boxOpen(), false, 'no value box opens for a dimension the square already determines');
    let L = await labels();
    assert.strictEqual(L.length, 3, 'three dimension labels: ' + JSON.stringify(L));
    assert(L.some(t => /^\(4\.2\)$/.test(t)), 'the diagonal is bracketed at its measured value 4.2: ' + JSON.stringify(L));
    await shot('diagonal-driven-bracketed.png');

    // ---------------------------------------------------------------- 2. a driven dimension cannot be typed: double click in the Dimension tool and in the Select tool
    let c = await ptOf(bracketed, 'the bracketed diagonal label');
    await dblClick(c.x, c.y);
    assert.strictEqual(await boxOpen(), false, 'double click on the driven diagonal (Dimension tool): no value box');
    await clickEl('#tool-select');
    c = await ptOf(bracketed, 'the bracketed diagonal label');
    await dblClick(c.x, c.y);
    assert.strictEqual(await boxOpen(), false, 'double click on the driven diagonal (Select tool): no value box');
    assert.deepStrictEqual(await labels(), L, 'nothing changed');

    // ---------------------------------------------------------------- 3. right-click Driving on it is refused while the square determines it
    c = await ptOf(bracketed, 'the bracketed diagonal label');
    await rightClick(c.x, c.y);
    const m = await menu();
    assert(m && m.some(i => i.id === 'dim-driving'), 'the dimension menu has Driving: ' + JSON.stringify(m));
    await clickEl('.sk-context-menu .sk-context-item[data-id="dim-driving"]'); await sleep(500);
    assert.deepStrictEqual(await labels(), L, 'still bracketed (driven) after the refused Driving');
    assert((await toasts()).some(t => /already determines it/i.test(t)), 'the refusal message is shown: ' + JSON.stringify(await toasts()));
    await shot('driving-refused.png');

    // ---------------------------------------------------------------- 3b. delete one side dimension: now Driving works and the value can be typed
    const side = await ptOf(plainWith('/3[.]0/'), 'a side dimension label');
    await click(side.x, side.y); await key('Delete', 'Delete', 46); await sleep(400);
    L = await labels();
    assert.strictEqual(L.length, 2, 'one side dimension deleted: ' + JSON.stringify(L));
    c = await ptOf(bracketed, 'the bracketed diagonal label');
    await rightClick(c.x, c.y);
    await clickEl('.sk-context-menu .sk-context-item[data-id="dim-driving"]'); await sleep(500);
    L = await labels();
    assert(L.every(t => !/^\(/.test(t)), 'the diagonal is driving now (no brackets): ' + JSON.stringify(L));
    const lab = await ptOf(plainWith('/4[.][0-9]/'), 'the driving diagonal label');
    await dblClick(lab.x, lab.y);
    assert.strictEqual(await boxOpen(), true, 'double click on the now-driving diagonal opens the value box');
    await shot('diagonal-driving-box.png');
    await key('Escape', 'Escape', 27);
    console.log('516 live: ok');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
