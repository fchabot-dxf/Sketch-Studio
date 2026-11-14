// TASK 589 live, SketchStudio (headless, REAL pointer + key events): with a line selected, the D key starts the Dimension tool WITH that line as its
// first pick: its length label is on screen at once and FOLLOWS the pointer; a click on empty space places it; one Ctrl+Z removes it.
// Esc after the D key forgets the pick. Two parallel lines selected + D = the line-line distance label. Read from what the page shows.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '589' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons, shift) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers: shift ? 8 : 0 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(120); };
    const click = async (x, y, shift) => { await move(x, y); await mouse('mousePressed', x, y, 1, shift); await sleep(40); await mouse('mouseReleased', x, y, 0, shift); await sleep(250); };
    const key = async (k, code, vk, mods = 0) => { await sendRealKey(send, k, code, vk, mods); await sleep(200); };
    const tool = async (t) => { await evalJs(`document.getElementById('tool-${t}').click()`); await sleep(200); };
    const labels = () => evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim())`);
    const labelPos = () => evalJs(`(() => { const e = document.querySelector('#svgCanvas .dim-label'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('#svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 4000);
    await waitFor(`!!document.querySelector('#svgCanvas') && !!document.getElementById('tool-dim')`, 'the canvas and the dimension tool', 15000);
    await sleep(1500);
    const o = await toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const drawLine = async (a, b) => { await tool('line'); await click(a.x, a.y); await click(b.x, b.y); await key('Escape', 'Escape', 27); await tool('select'); };
    const A = [P(150, -300), P(450, -300)], B = [P(150, -180), P(450, -180)];
    await drawLine(...A); await drawLine(...B);
    const mid = (l) => ({ x: Math.round((l[0].x + l[1].x) / 2), y: Math.round((l[0].y + l[1].y) / 2) });
    const box = () => waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box', 8000);
    const base = (await labels()).length;

    // 1. select a line, press D: its length label is there at once and follows the pointer
    await click(mid(A).x, mid(A).y);
    await key('d', 'KeyD', 68);
    const l1 = await labels();
    assert.strictEqual(l1.length, base + 1, 'D with a line selected: its length label is on screen at once: ' + JSON.stringify(l1));
    await move(P(550, -100).x, P(550, -100).y); const p1 = await labelPos();
    await move(P(600, 60).x, P(600, 60).y); const p2 = await labelPos();
    assert(p1 && p2 && Math.hypot(p1.x - p2.x, p1.y - p2.y) > 20, 'the label follows the pointer: ' + JSON.stringify([p1, p2]));
    await click(P(600, 60).x, P(600, 60).y);
    await box(); await key('Enter', 'Enter', 13); await sleep(300);
    assert.strictEqual((await labels()).length, base + 1, 'a click on empty space placed it');
    // ONE Ctrl+Z removes it
    await key('z', 'KeyZ', 90, 2);
    assert.strictEqual((await labels()).length, base, 'one Ctrl+Z removed the dimension: ' + JSON.stringify(await labels()));

    // 2. Esc after the D key forgets the pick
    await tool('select'); await click(mid(A).x, mid(A).y);
    await key('d', 'KeyD', 68);
    assert.strictEqual((await labels()).length, base + 1, 'pending again');
    await key('Escape', 'Escape', 27);
    assert.strictEqual((await labels()).length, base, 'Esc forgot the pick: ' + JSON.stringify(await labels()));

    // 3. two parallel lines selected + D: the line-line distance
    await tool('select'); await click(mid(A).x, mid(A).y); await click(mid(B).x, mid(B).y, true);
    await key('d', 'KeyD', 68);
    const l3 = await labels();
    assert.strictEqual(l3.length, base + 1, 'two parallel lines + D: one pending label: ' + JSON.stringify(l3));
    assert(!l3[l3.length - 1].includes('°'), 'a distance, not an angle: ' + l3[l3.length - 1]);
    await key('Escape', 'Escape', 27);
    console.log('dimension-d-preselect-live: ok');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
