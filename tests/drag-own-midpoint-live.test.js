// tests/drag-own-midpoint-live.test.js -- TASK 552 in the REAL SketchStudio (headless, REAL mouse via CDP, one event per 16 ms):
// a line's end is dragged to 50 px from the midpoint of ITS OWN line and the cursor stops. No snap target is within the screen
// threshold, so the drawn end must be exactly under the cursor (gap 0). Until task 552 the drag's midpoint inference compared SNAP.MIDPOINT
// (screen px) with a WORLD distance and included the dragged end's own line: at 78 px per unit the end stuck to the midpoint (gap = 50 px).
// Two zooms: the default (78 px per unit) and zoomed out. The axis snap and the grid magnet are off so a gap left can only be the midpoint.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '552live' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const results = [];
  try {
    const SEL = '#svgCanvas';
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const tool = (t) => evalJs(`document.getElementById('tool-${t}').click()`).then(() => sleep(150));
    const ends = () => evalJs(`JSON.stringify([...document.querySelectorAll('${SEL} line.shape-elem')].map(e => { const m = e.getScreenCTM(); const P = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; return [P(+e.getAttribute('x1'), +e.getAttribute('y1')), P(+e.getAttribute('x2'), +e.getAttribute('y2'))]; }))`).then(JSON.parse);
    const ppu = () => evalJs(`(() => { const o = document.querySelector('${SEL} .joint-handle[data-joint-id="j_origin"]'); return o ? o.getScreenCTM().a : null; })()`);
    for (const zoom of ['default', 'zoomed-out']) {
      const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
      await navigate(url, 8000);
      await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false, GRID_MAGNETISM: 0.001 })); return true; })()`);
      await navigate(url, 8000);
      await waitFor(`(() => { const c = document.querySelector('${SEL}'); return !!c && c.getBoundingClientRect().width > 0 && c.dataset.docReady === '1' && !!document.getElementById('tool-select'); })()`, 'SketchStudio ready');
      await sleep(600);
      const c = await evalJs(`(() => { const r = document.querySelector('${SEL}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      if (zoom === 'zoomed-out') for (let i = 0; i < 80; i++) { const k = await ppu(); if (k != null && k < 45) break; await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: 500 }); await sleep(40); }
      const k = await ppu();
      // a short free line well above the origin joint, drawn with the line tool: the 100 px of the default zoom is 1.3 units (its end is
      // 0.64 units from its own midpoint, inside the 1 unit the old world-unit threshold gave), the 50 px line at 37 px per unit is 1.35
      const y = c.y - 200, half = zoom === 'default' ? 50 : 25;
      await tool('line'); await click(c.x - half, y - half * 0.5); await click(c.x + half, y + half * 0.5);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150);
      await tool('select');
            const before = (await ends())[0];
      assert.ok(Math.hypot(before[1][0] - (c.x + half), before[1][1] - (y + half * 0.5)) < 3, `the line end is drawn where it was placed (${zoom})`);
      await mouse('mouseMoved', c.x + half, y + half * 0.5, 0); await sleep(40); await mouse('mousePressed', c.x + half, y + half * 0.5, 1); await sleep(60);
      // a straight path away from the line's direction (18 degrees up, not along the line: no parallel / H / V rule holds the end); the line stays under
      // twice the old threshold (a half line shorter than 1 unit), so the old rule snapped the end to the line's own midpoint, half the line from the cursor
      const from = { x: c.x + half, y: y + half * 0.5 }, stop = { x: from.x + 0.28 * 2 * half, y: from.y - 0.09 * 2 * half }, n = 12; let cur = from;
      for (let i = 1; i <= n; i++) { cur = { x: from.x + (stop.x - from.x) * i / n, y: from.y + (stop.y - from.y) * i / n }; await mouse('mouseMoved', cur.x, cur.y, 1); await sleep(16); }
      for (let f = 0; f < 10; f++) await evalJs(`new Promise(r => requestAnimationFrame(() => r(true)))`);
      const after = (await ends())[0];
      const gap = Math.hypot(after[1][0] - cur.x, after[1][1] - cur.y);
      await mouse('mouseReleased', cur.x, cur.y, 0); await sleep(200);
      results.push(`${zoom} (${k.toFixed(2)} px per unit): the cursor stopped ${Math.hypot(stop.x - from.x, stop.y - from.y).toFixed(0)} px from where the end was grabbed (a ${(2 * half).toFixed(0)} px line), drawn end ${gap.toFixed(2)} px from the cursor`);
      assert.ok(gap < 1, `${zoom}: the dragged end stays under the cursor (gap ${gap.toFixed(2)} px)`);
    }
    console.log(results.join('\n'));
    console.log('drag-own-midpoint-live.test.js: ok');
  } finally { await cdp.close(); }
})();
