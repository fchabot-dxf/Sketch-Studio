// tests/dimension-point-line-live.test.js -- TASK 520 (live headless, REAL mouse + keyboard, SketchStudio): the Dimension tool's
//  A. point-to-line dimension (click a point, then the line): is driving, holds the PERPENDICULAR distance when the line is swung
//     by a real drag, a typed value drives it, and ONE Undo click removes it. The same from line-first is the object dimension (not covered here).
//  B. line-to-line dimension in BOTH click orders is driving (not a reference) and positive.
// SketchStudio exposes no state global, so everything is read from what the user sees: the joint handles' screen positions and the dimension labels.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '520' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', to.x, to.y, 0); await sleep(400);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    // every drawn line as its two screen-space ends (the joint dots carry no ids in the DOM, the lines carry their coordinates)
    const lines = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => { const m = e.getScreenCTM(); const pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }); return [pt(+e.getAttribute('x1'), +e.getAttribute('y1')), pt(+e.getAttribute('x2'), +e.getAttribute('y2'))]; }))`).then(JSON.parse);
    const labels = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim()))`).then(JSON.parse);
    const perpPx = (p, a, b) => Math.abs(((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y));
    const key = (k, code, vk, mods = 0) => sendRealKey(send, k, code, vk, mods);
    const typeValue = async (text) => {
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden') ; })()`, 'the dimension value input to open', 8000);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
      await send('Input.insertText', { text }); await sleep(100);
      await key('Enter', 'Enter', 13); await sleep(500);
    };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('tool-dim'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    const cv = await centerOf('#svgCanvas');

    const drawLine = async (x1, y1, x2, y2) => { await clickEl('#tool-line'); await click(x1, y1); await click(x2, y2); await key('Escape', 'Escape', 27); await sleep(200); };

    // ---------------------------------------------------------------- A. point to line
    // line L: horizontal, left to right; line M: a tilted line above it whose right end is the point P to dimension
    await drawLine(cv.x - 200, cv.y + 80, cv.x + 200, cv.y + 80);
    await drawLine(cv.x - 150, cv.y - 120, cv.x + 60, cv.y - 80);
    let LN = await lines();
    assert.strictEqual(LN.length, 2, 'two lines drawn: ' + JSON.stringify(LN));
    LN.sort((u, v) => u[0].y - v[0].y);                               // [upper line M, lower line L]
    const P = LN[0][0].x > LN[0][1].x ? LN[0][0] : LN[0][1];          // the right end of the upper line is the point to dimension

    const create = async () => {
      await clickEl('#tool-dim');
      await click(P.x, P.y);                                       // the point
      await click(cv.x - 60, cv.y + 80);                           // the line (its middle)
      await click(cv.x + 100, cv.y - 20);                          // drop the label
      await typeValue('3');
    };
    const linesBefore = JSON.stringify(await lines());
    await create();
    // ONE Undo click removes the whole dimension (value included) and leaves the lines where they were
    await clickEl('#btn-undo'); await sleep(300);
    assert.strictEqual((await labels()).length, 0, 'one undo removes the dimension');
    assert.strictEqual(JSON.stringify(await lines()), linesBefore, 'and the geometry is where it was');
    await create();
    const afterCreate = await labels();
    assert(afterCreate.some(t => /3\.0/.test(t) && !/\(/.test(t)), 'a driving (no parentheses) 3.0 dimension label is shown: ' + JSON.stringify(afterCreate));
    const measure = async () => { const l = (await lines()).sort((u, v) => u[0].y - v[0].y); const up = l[0], lo = l[1]; const pt = up[0].x > up[1].x ? up[0] : up[1]; return { pt, a: lo[0], b: lo[1], d: perpPx(pt, lo[0], lo[1]), lo }; };
    assert.strictEqual((await lines()).length, 2, 'no extra shape was added by the dimension');
    const shot = async (name) => { if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
    await shot('point-line-created.png');
    const d3 = (await measure()).d;
    // the typed value drives: 3 -> 4.5 scales the perpendicular distance by 1.5
    { const c = await centerOf('.dim-label'); assert(c, 'the dimension label is on screen'); await mouse('mouseMoved', c.x, c.y, 0); for (let i = 0; i < 2; i++) { await mouse('mousePressed', c.x, c.y, 1); await sleep(30); await mouse('mouseReleased', c.x, c.y, 0); await sleep(60); } }   // a real double click on the label opens the editor
    await typeValue('4.5');
    const d45 = (await measure()).d;
    assert(Math.abs(d45 / d3 - 1.5) < 0.02, `typed value drives the perpendicular distance: 3 -> 4.5 scaled it by ${(d45 / d3).toFixed(3)} (px ${d3.toFixed(1)} -> ${d45.toFixed(1)})`);

    // swing the long line: a real drag of its right end; the perpendicular distance must hold
    await clickEl('#tool-select');
    const m0 = await measure();
    const end = m0.b.x > m0.a.x ? m0.b : m0.a;                      // the right end of the long line
    await drag(end, { x: end.x, y: end.y - 70 });
    await shot('point-line-swung.png');
    const m1 = await measure();
    assert(Math.abs(m1.lo[0].y - m0.lo[0].y) + Math.abs(m1.lo[1].y - m0.lo[1].y) + Math.abs(m1.pt.y - m0.pt.y) > 20, 'the drag moved the geometry');
    assert(Math.abs(m1.d - d45) / d45 < 0.02, `after swinging the line the perpendicular distance holds: ${d45.toFixed(1)} px -> ${m1.d.toFixed(1)} px`);

    console.log('A. point-to-line: ok');

    // ---------------------------------------------------------------- B. line to line, both click orders
    await clickEl('#btn-clear'); await sleep(400);
    await drawLine(cv.x - 200, cv.y - 100, cv.x + 100, cv.y - 100);
    await drawLine(cv.x - 200, cv.y + 100, cv.x + 100, cv.y + 100);
    for (const [first, second, name] of [[-100, 100, 'upper line then lower line'], [100, -100, 'lower line then upper line']]) {
      await clickEl('#tool-dim');
      await click(cv.x - 50, cv.y + first); await click(cv.x - 50, cv.y + second);
      await click(cv.x + 180, cv.y);                          // drop the label
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the value input after dropping the line-line label', 8000);
      await key('Enter', 'Enter', 13); await sleep(500);   // accept the measured value
      const ls = await labels();
      assert(ls.length >= 1, name + ': a dimension label exists: ' + JSON.stringify(ls));
      const t = ls[ls.length - 1];
      assert(!/\(/.test(t) && !/-/.test(t) && /\d/.test(t), name + ': the label is a positive, driving (no parentheses) value: ' + t);
      await clickEl('#btn-undo'); await sleep(300);
      assert.strictEqual((await labels()).length, 0, name + ': one undo removes it');
    }
    console.log('B. line-to-line: ok in both click orders');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
