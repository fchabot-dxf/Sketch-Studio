// tests/dimension-pick-live-runner.js -- TASK 555 live (headless, REAL pointer + key events), shared by dimension-pick-live-studio / -shaper.
// The Dimension tool picks like Fusion: click an entity (its dimension is a preview that follows the cursor), click a second entity (the
// preview changes kind), click on empty space (the label is placed), Esc cancels. Everything is read from what the page shows (the dimension
// labels); a crossing line + an axis is an ANGLE label (has a degree sign), a parallel line + an axis a DISTANCE label.
// HOST env: 'studio' or 'shaper'. EVIDENCE_DIR env: where the screenshots of the previews go.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const HOST = process.env.HOST === 'shaper' ? 'shaper' : 'studio';
const CANVAS = HOST === 'shaper' ? '#design-canvas' : '#svgCanvas';
const URL_PATH = HOST === 'shaper' ? '/apps/shaper/index.html' : '/apps/sketchstudio/index.html';
const EVID = process.env.EVIDENCE_DIR || '';

await (async () => {
  const cdp = await launchBrowser({ tag: '555' + HOST });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(120); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk); await sleep(150); };
    const tool = async (t) => { await evalJs(`document.getElementById('tool-${t}').click()`); await sleep(200); };
    const labels = () => evalJs(`[...document.querySelectorAll('${CANVAS} .dim-label')].map(e => e.textContent.trim())`);
    const lit = () => evalJs(`document.querySelectorAll('[data-ref-axis]').length`);
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('${CANVAS}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const shot = async (name, clip) => {
      if (!EVID) return;
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
      fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, `${HOST}-${name}`), Buffer.from(r.data, 'base64'));
    };

    await navigate(`http://127.0.0.1:${port}${URL_PATH}`, 4000);
    if (HOST === 'shaper') { await evalJs(`localStorage.clear(); document.querySelector('.mode-btn[data-mode="design"]').click()`); await sleep(1500); }
    await waitFor(`!!document.querySelector('${CANVAS}') && !!document.getElementById('tool-dim')`, 'the canvas and the dimension tool', 15000);
    await sleep(1500);
    const o = await toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const drawLine = async (a, b) => { await tool('line'); await click(a.x, a.y); await click(b.x, b.y); await key('Escape', 'Escape', 27); };

    // the sketch: L1 slanted (crosses the X axis), L2 horizontal (parallel to it), L3 short, with an end point P to pick
    const L1 = [P(200, -150), P(380, -60)], L2 = [P(420, -260), P(560, -260)], L3 = [P(60, -300), P(110, -250)];
    await drawLine(...L1); await drawLine(...L2); await drawLine(...L3);
    const mid = (l) => ({ x: Math.round((l[0].x + l[1].x) / 2), y: Math.round((l[0].y + l[1].y) / 2) });
    const dimensionBox = () => waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box', 8000);
    const accept = async () => { try { await dimensionBox(); } catch (err) { await shot('FAIL.png', { x: o.x - 100, y: o.y - 400, w: 800, h: 600 }); throw new Error(err.message + ' labels ' + JSON.stringify(await labels())); } await key('Enter', 'Enter', 13); await sleep(400); };
    const startLabels = (await labels()).length;
    const newest = async (n) => { const ls = await labels(); assert.strictEqual(ls.length, startLabels + n, `label count after ${n} dimensions: ${JSON.stringify(ls)}`); return ls[ls.length - 1]; };

    // 1. line + X axis (crossing): preview after ONE pick (the length), then after TWO picks (the angle to the axis), a click on empty space places it
    await tool('dim');
    await click(mid(L1).x, mid(L1).y);
    await move(P(300, 90).x, P(300, 90).y);
    assert.strictEqual((await labels()).length, startLabels + 1, 'one pick: ONE preview label (the length) follows the cursor');
    assert(!(await labels()).slice(-1)[0].includes('°'), 'one pick: the preview is the length, not an angle: ' + JSON.stringify(await labels()));
    await shot('pick1-line-length-preview.png', { x: o.x + 100, y: o.y - 220, w: 460, h: 340 });
    await move(P(520, 2).x, P(520, 2).y);
    assert.strictEqual(await lit(), 1, 'the X axis lights up while a line previews and the pointer is on it');
    await click(P(520, 2).x, P(520, 2).y);
    await move(P(450, 110).x, P(450, 110).y); await move(P(452, 112).x, P(452, 112).y);
    assert.strictEqual((await labels()).length, startLabels + 1, 'two picks: still ONE preview label (the length preview was replaced)');
    assert((await labels()).slice(-1)[0].includes('°'), 'two picks: the preview is now the ANGLE to the axis: ' + JSON.stringify(await labels()));
    await shot('pick2-line-axis-angle-preview.png', { x: o.x + 100, y: o.y - 220, w: 520, h: 360 });
    await click(P(452, 112).x, P(452, 112).y); await accept();
    assert((await newest(1)).includes('°'), 'placed: an angle label');

    // 2. parallel line + X axis: the DISTANCE to the axis
    await click(mid(L2).x, mid(L2).y);
    await click(P(520, 2).x, P(520, 2).y);
    await move(P(640, -130).x, P(640, -130).y); await move(P(642, -131).x, P(642, -131).y);
    await click(P(642, -131).x, P(642, -131).y); await accept();
    const dAxis = await newest(2);
    assert(!dAxis.includes('°') && /\d/.test(dAxis), 'line parallel to the axis + the axis: a distance label: ' + dAxis);

    // 3. one line, then a click on empty space: its length is placed
    await click(mid(L3).x, mid(L3).y);
    await move(P(150, -340).x, P(10, -330).y); await move(P(152, -342).x, P(152, -342).y);
    await click(P(152, -342).x, P(152, -342).y); await accept();
    const len = await newest(3);
    assert(!len.includes('°') && /\d/.test(len), 'line + empty space: the length: ' + len);

    // 4. line + point: L1, then P (an end of L3) = the perpendicular distance from P to L1
    await click(mid(L1).x, mid(L1).y);
    await click(L3[0].x, L3[0].y);
    await shot('pick2-line-point-preview.png', { x: o.x, y: o.y - 340, w: 520, h: 360 });
    assert.strictEqual((await labels()).length, startLabels + 4, 'line + point: still ONE preview label (the length preview was replaced)');
    await move(P(40, -180).x, P(40, -180).y); await move(P(42, -181).x, P(42, -181).y);
    await click(P(42, -181).x, P(42, -181).y); await accept();
    const pl = await newest(4);
    assert(!pl.includes('°') && /\d/.test(pl), 'line + point: a distance label: ' + pl);

    // 5. Esc after one pick leaves nothing (and no preview)
    await tool('dim');
    await click(mid(L1).x, mid(L1).y); await move(P(300, 60).x, P(300, 60).y);
    assert.strictEqual((await labels()).length, startLabels + 5, 'one pick: a preview label');
    await key('Escape', 'Escape', 27);
    assert.strictEqual((await labels()).length, startLabels + 4, 'Esc: the preview is gone, nothing was placed: ' + JSON.stringify(await labels()));
    // ... and a first point picked, then Esc, is forgotten: the next line click starts that LINE's length
    await tool('dim');
    await click(L3[0].x, L3[0].y); await key('Escape', 'Escape', 27); await tool('dim');
    await click(mid(L2).x, mid(L2).y);
    assert.strictEqual((await labels()).length, startLabels + 5, 'after Esc the first pick starts afresh (a line length preview)');
    await key('Escape', 'Escape', 27);
    console.log(`dimension-pick-live ${HOST}: ok ${JSON.stringify(await labels())}`);
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
