// tests/clear-all-live.test.js — TASK 498 (live headless, REAL mouse): SketchStudio's Clear All ALWAYS empties the whole board,
// even with a selection (it used to delete only the selection), and a repeated click on an empty board is harmless.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '498', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const drag = async (pts) => {
      await mouse('mouseMoved', pts[0][0], pts[0][1], 0); await sleep(30); await mouse('mousePressed', pts[0][0], pts[0][1], 1);
      for (const p of pts.slice(1)) { await mouse('mouseMoved', p[0], p[1], 1); await sleep(20); }
      const l = pts[pts.length - 1]; await mouse('mouseReleased', l[0], l[1], 0); await sleep(300);
    };
    const counts = () => evalJs(`JSON.stringify({ shapes: document.querySelectorAll('#svgCanvas .shape-elem').length, joints: new Set(Array.from(document.querySelectorAll('#svgCanvas .joint-handle')).map(e => e.dataset.jointId)).size })`).then(JSON.parse);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/sketchstudio/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitForApp('svgCanvas');

    const cv = await centerOf('#svgCanvas');
    const draw3 = async () => {
      await clickEl('#tool-circle');
      await drag([[cv.x - 200, cv.y - 100], [cv.x - 170, cv.y - 100], [cv.x - 150, cv.y - 100]]);
      await drag([[cv.x, cv.y - 100], [cv.x + 30, cv.y - 100], [cv.x + 50, cv.y - 100]]);
      await drag([[cv.x + 200, cv.y - 100], [cv.x + 230, cv.y - 100], [cv.x + 250, cv.y - 100]]);
    };
    await draw3();
    const drawn = await counts();
    assert.strictEqual(drawn.shapes, 3, 'three shapes drawn: ' + JSON.stringify(drawn));

    // select one (Select tool, click its rim), then Clear All: the WHOLE board goes, not just the selection
    await clickEl('#tool-select');
    await click(cv.x + 50, cv.y - 100);
    const styles = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('#svgCanvas .shape-elem')).map(e => e.getAttribute('style') + '|' + e.getAttribute('stroke-width')))`).then(JSON.parse);
    assert(new Set(styles).size > 1, 'one shape renders as selected (differs from the other two): ' + JSON.stringify(styles));
    await clickEl('#btn-clear');
    const after = await counts();
    assert.strictEqual(after.shapes, 0, 'Clear All with a selection empties the board: ' + JSON.stringify(after));
    assert(after.joints <= 1, 'only the origin joint remains: ' + JSON.stringify(after));

    // repeated click on an empty board is harmless
    await clickEl('#btn-clear'); await clickEl('#btn-clear');
    const again = await counts();
    assert.deepStrictEqual(again, after, 'repeated Clear All on an empty board changes nothing');

    // and the board is usable afterwards
    await draw3();
    assert.strictEqual((await counts()).shapes, 3, 'drawing works after Clear All');
    await clickEl('#btn-clear');
    assert.strictEqual((await counts()).shapes, 0, 'Clear All with no selection also empties the board');
    console.log('clear-all-live.test.js: ok', JSON.stringify(after));
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
