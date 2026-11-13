// tests/angle-dimension-arc-live.test.js -- TASK 543 (live headless, REAL mouse, SketchStudio): the owner's document (two lines 10 degrees
// apart, ANGLE value 10 whose label sat in the 170 degree sector). Loaded through the app's own project store + restore path.
//  A. the drawn arc spans 10 degrees (read back from the page's own SVG path), between the two line directions, label 10.0
//  B. a real drag of the label across the vertex into the other sectors never changes what the arc measures (10), moves no geometry,
//     and one Undo puts the label back
//  C. creation: the drop sector decides the value (task 543); D. typed past 180 (190, 270: the reflex arc, label inside), 0 refused (task 553)
// With EVIDENCE_DIR set, writes the full-page screenshot and arc crops there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const OWNER = JSON.parse(fs.readFileSync(new URL('./fixtures/angle-dimension/owner-trapezoid-angle.json', import.meta.url), 'utf8'));
const RADIUS = OWNER.geometry.constraints.find((c) => c.type === 'angle').offset;   // the arc is the SVG arc path with this radius
const INT = { x: 587.4900947223791, y: 7584.647136653884 };                        // the lines' intersection (computed from the document)

await (async () => {
  const cdp = await launchBrowser({ tag: '543' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1);
      for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10, 1); await sleep(30); }
      await mouse('mouseReleased', to.x, to.y, 0); await sleep(500);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    // the angle dimension's arc as drawn: its two end points in WORLD units (the path is in world coordinates)
    const arc = () => evalJs(`(() => { for (const p of document.querySelectorAll('#svgCanvas path')) { const m = (p.getAttribute('d') || '').match(/^M ([-\\d.e]+) ([-\\d.e]+) A ([-\\d.e]+) [-\\d.e]+ 0 ([01]) 1 ([-\\d.e]+) ([-\\d.e]+)$/); if (m && Math.abs(+m[3] - ${RADIUS}) < 1) return JSON.stringify({ sx: +m[1], sy: +m[2], large: +m[4], ex: +m[5], ey: +m[6] }); } return null; })()`).then((s) => s && JSON.parse(s));
    const spanOf = (a) => { const d = (x) => Math.atan2(x.y - INT.y, x.x - INT.x) * 180 / Math.PI; return ((d({ x: a.ex, y: a.ey }) - d({ x: a.sx, y: a.sy })) % 360 + 360) % 360; };
    const shot = async (name, clip) => { if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from((await send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}))).data, 'base64')); };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`!!document.getElementById('svgCanvas') && !!document.getElementById('tool-select')`, 'SketchStudio to load');
    await sleep(1000);
    // seed the owner's document as the current design, then reload: the app's own restore loads it
    await evalJs(`(async () => { const { getProjectStore } = await import('/packages/ui/project-store.js'); const s = getProjectStore();
      const p = await s.newDesign('owner-543', { app: 'sketchstudio' }); await s.save(${JSON.stringify(OWNER)}, { app: 'sketchstudio', id: p.id }); return p.id; })()`);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas .dim-label')`, 'the owner dimension to be drawn', 15000);
    // the dimension sits 19757 units from the vertex, past the top of the first fit: a real wheel zoom-out brings the whole dimension into view
    { const cvr = await centerOf('#svgCanvas'); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cvr.x, y: cvr.y, deltaX: 0, deltaY: 700 }); await sleep(500); }
    await shot('arc-zoomed-out.png');

    // ---- A. the arc spans the value
    const a0 = await arc();
    assert(a0, 'the angle dimension arc is in the page');
    const span0 = spanOf(a0);
    assert(Math.abs(span0 - 10) < 0.5, `A: the drawn arc spans ${span0.toFixed(2)} degrees; the label reads 10`);
    const label0 = await evalJs(`document.querySelector('#svgCanvas .dim-label').textContent.replace(/\\s+/g, '')`);
    assert(/10\.0/.test(label0), 'A: the label reads 10.0: ' + label0);
    console.log('A. arc span', span0.toFixed(2), 'label', label0);

    // ---- B. a real label drag into other sectors never changes what the arc measures
    await click((await centerOf('#tool-select')).x, (await centerOf('#tool-select')).y);
    const cv = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const vertex = await evalJs(`(() => { const c = document.getElementById('svgCanvas'); const m = c.getScreenCTM(); return { x: m.a * ${INT.x} + m.c * ${INT.y} + m.e, y: m.b * ${INT.x} + m.d * ${INT.y} + m.f }; })()`);
    const stable = JSON.stringify(await evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]))`));
    for (const target of [{ x: cv.l + cv.w * 0.3, y: cv.t + cv.h * 0.25 }, { x: cv.l + cv.w * 0.75, y: cv.t + cv.h * 0.7 }, { x: vertex.x - 120, y: vertex.y + 40 }]) {
      const lab = await centerOf('#svgCanvas .dim-label');
      await drag(lab, target);
      const a = await arc();
      assert(a, 'B: the arc is still drawn after the label drag');
      const sp = spanOf(a);
      assert(Math.abs(sp - 10) < 0.5, `B: after dragging the label to (${Math.round(target.x)},${Math.round(target.y)}) the arc spans ${sp.toFixed(2)}, not 10`);
    }
    assert.strictEqual(JSON.stringify(await evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]))`)), stable, 'B: the lines did not move');
    await shot('arc-after-label-drag.png');
    console.log('B. label dragged into other sectors: arc stays 10, geometry unchanged');

    // ---- C. CREATION: the sector the label is dropped in decides what a NEW dimension measures (Fusion: 10.00 in the 10 degree sector, 170.00 in the 170 one)
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(300); };
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const labels = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.replace(/\s+/g, '')))`).then(JSON.parse);
    const inputOpen = `(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`;
    await clickEl('#btn-clear'); await flushAutosave();                                  // an empty design, then a reload for the default view (the owner document's view is zoomed far out)
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`!!document.getElementById('svgCanvas') && !!document.getElementById('tool-dim')`, 'SketchStudio to reload');
    await waitForApp('svgCanvas');
    const C = await centerOf('#svgCanvas');
    const corner = { x: C.x - 250, y: C.y + 100 };
    const drawLine = async (a, b) => { await clickEl('#tool-line'); await click(a.x, a.y); await click(b.x, b.y); await key('Escape', 'Escape', 27); await sleep(200); };
    await drawLine(corner, { x: corner.x + 400, y: corner.y });                       // line A: along +x
    await drawLine(corner, { x: corner.x + 346, y: corner.y - 200 });                 // line B: 30 degrees above it, sharing the corner
    const create = async (drop, text) => {
      await clickEl('#tool-dim');
      await click(corner.x + 200, corner.y);                                          // line A
      await click(corner.x + 173, corner.y - 100);                                    // line B
      await click(drop.x, drop.y);                                                    // drop the label in the chosen sector
      await waitFor(inputOpen, 'the value input after dropping the angle label', 8000);
      const shown = parseFloat(await evalJs(`document.getElementById('dimInput').value`));
      if (text) { await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`); await send('Input.insertText', { text }); await sleep(100); }
      await key('Enter', 'Enter', 13); await sleep(500);
      return shown;
    };
    const narrow = await create({ x: corner.x + 300, y: corner.y - 40 });             // inside the 30 degree sector
    const t1 = (await labels()).pop();
    await clickEl('#btn-undo'); await sleep(300);
    assert.strictEqual((await labels()).length, 0, 'C: one undo removes the narrow dimension');
    const wide = await create({ x: corner.x + 120, y: corner.y + 120 });             // inside the 150 degree sector below line A
    const t2 = (await labels()).pop();
    console.log('C. label in the narrow sector reads', narrow, '(' + t1 + '), in the wide sector', wide, '(' + t2 + ')');
    assert(Math.abs(narrow - 30) < 2, 'C: the narrow sector measures about 30: ' + narrow);
    assert(Math.abs(narrow + wide - 180) < 0.2, `C: the two sectors are supplements (30 + 150): ${narrow} + ${wide}`);
    assert(t1.includes(narrow.toFixed(1)) && t2.includes(wide.toFixed(1)), 'C: the labels read what the value box showed: ' + t1 + ' / ' + t2);
    // the wide dimension drives: typing 120 re-solves the lines so that sector is 120 (the lines were 150 apart in that sector)
    { const lab = await centerOf('#svgCanvas .dim-label'); await mouse('mouseMoved', lab.x, lab.y, 0); for (let i = 0; i < 2; i++) { await mouse('mousePressed', lab.x, lab.y, 1); await sleep(30); await mouse('mouseReleased', lab.x, lab.y, 0); await sleep(60); } }
    await waitFor(inputOpen, 'the editor to open on a double click', 8000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`); await send('Input.insertText', { text: '120' }); await key('Enter', 'Enter', 13); await sleep(500);
    const t3 = (await labels()).pop();
    assert(t3.includes('120.0'), 'C: the wide dimension was edited to 120: ' + t3);
    await shot('arc-created-wide.png');
    console.log('C. wide-sector dimension typed to 120 holds:', t3);

    // ---- D. TASK 553: past 180 like Fusion. A new dimension in the 30 sector typed 190, then 270 in the value box: the sector keeps opening
    // the same way round, the arc is drawn over the reflex sector (large-arc flag 1) and the label sits inside it; 0 is refused.
    // The arc's span is read from the page's SVG path alone: its centre from the two ends, the radius and the large-arc flag (sweep flag 1).
    const anyArc = () => evalJs(`(() => { for (const p of document.querySelectorAll('#svgCanvas path')) { const m = (p.getAttribute('d') || '').match(/^M ([-\\d.e]+) ([-\\d.e]+) A ([-\\d.e]+) [-\\d.e]+ 0 ([01]) 1 ([-\\d.e]+) ([-\\d.e]+)$/); if (m) return JSON.stringify({ sx: +m[1], sy: +m[2], r: +m[3], large: +m[4], ex: +m[5], ey: +m[6] }); } return null; })()`).then((s) => s && JSON.parse(s));
    const reflexOf = (a, glyph) => {
      const mx = (a.sx + a.ex) / 2, my = (a.sy + a.ey) / 2, hx = a.ex - a.sx, hy = a.ey - a.sy, h = Math.hypot(hx, hy) / 2;
      const d = Math.sqrt(Math.max(0, a.r * a.r - h * h)), side = a.large ? -1 : 1;
      const cx = mx + side * (-hy / (2 * h)) * d, cy = my + side * (hx / (2 * h)) * d, n = (x) => ((x % 360) + 360) % 360;
      const a0 = Math.atan2(a.sy - cy, a.sx - cx) * 180 / Math.PI, span = n(Math.atan2(a.ey - cy, a.ex - cx) * 180 / Math.PI - a0);
      return { span, labelInside: n(Math.atan2(glyph.y - cy, glyph.x - cx) * 180 / Math.PI - a0) <= span };
    };
    const glyph = () => evalJs(`(() => { const l = document.querySelector('#svgCanvas .dim-label rect'); const c = document.getElementById('svgCanvas'); const m = c.getScreenCTM().inverse(); const r = l.getBoundingClientRect(); const p = c.createSVGPoint(); p.x = r.left + r.width / 2; p.y = r.top + r.height / 2; const w = p.matrixTransform(m); return JSON.stringify({ x: w.x, y: w.y }); })()`).then(JSON.parse);
    const editTo = async (text) => {
      const lab = await centerOf('#svgCanvas .dim-label'); await mouse('mouseMoved', lab.x, lab.y, 0);
      for (let i = 0; i < 2; i++) { await mouse('mousePressed', lab.x, lab.y, 1); await sleep(30); await mouse('mouseReleased', lab.x, lab.y, 0); await sleep(60); }
      await waitFor(inputOpen, 'the editor to open on a double click', 8000);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`); await send('Input.insertText', { text }); await key('Enter', 'Enter', 13); await sleep(600);
    };
    await clickEl('#btn-undo'); await sleep(300); await clickEl('#btn-undo'); await sleep(300);           // the edit, then the wide dimension
    assert.strictEqual((await labels()).length, 0, 'D: back to the two lines');
    await create({ x: corner.x + 300, y: corner.y - 40 }, '190');                                        // the 30 sector, typed 190 at once
    for (const [text, want] of [['190', 190], ['270', 270]]) {
      if (text !== '190') await editTo(text);
      const a = await anyArc(), g = await glyph(), r = reflexOf(a, g), t = (await labels()).pop();
      console.log(`D. typed ${text}: label ${t}, arc span ${r.span.toFixed(2)}, large-arc ${a.large}, label inside ${r.labelInside}`);
      await shot(`arc-reflex-${want}.png`, { x: corner.x - 340, y: corner.y - 340, width: 680, height: 680 });
      assert(t.includes(`${want}.0`), `D: the label reads ${want}: ${t}`);
      assert(Math.abs(r.span - want) < 0.5 && a.large === 1 && r.labelInside, `D: the arc spans ${r.span.toFixed(2)} (large ${a.large}, label inside ${r.labelInside}), not ${want}`);
    }
    const linesNow = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]))`);
    const before0 = await linesNow();
    await editTo('0');
    if (await evalJs(inputOpen)) await key('Escape', 'Escape', 27);
    assert((await labels()).pop().includes('270.0'), 'D: 0 is refused, the value stays 270');
    assert.strictEqual(await linesNow(), before0, 'D: 0 moved nothing');
    console.log('D. typed 0: refused, still 270, nothing moved');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
