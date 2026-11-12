// tests/drag-follow-live.test.js -- TASK 548 in the REAL apps (headless, REAL mouse via CDP Input.dispatchMouseEvent, one event per 16 ms):
// SketchStudio and Shaper's Design tab, zoomed out to a LARGE drawing (under 0.3 px per world unit, so a 40 px pointer event is more than
// SolverConfig.MAX_DRAG_STEP = 100 world units). A free line's end and a rectangle corner are dragged at 10 and 40 px per event; a recorder
// rAF registered after the app's loop reads, every animation frame, the last pointer position and the drawn point (from the DOM): the gap
// must stay under 1 px in every frame and after the cursor stops (until task 548 the joint trailed 20 px more per 40 px event and stayed
// behind: tests/drag-follow.test.js has the same cases in node). The axis snap and the grid magnet are off (user settings) so a gap left can
// only be the drag itself; the path keeps 80 px or more from the origin joint (its 16 px snap magnet).
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const RECORDER = `(() => {
  const M = window.__drag548 = { ptr: null, on: false, frames: [], probe: null, sel: null };
  addEventListener('pointermove', (e) => { M.ptr = [e.clientX, e.clientY]; }, true);
  const tick = () => {
    if (M.on && M.ptr) {
      const e = document.querySelectorAll(M.sel + ' line.shape-elem')[M.probe.i];
      if (e) { const m = e.getScreenCTM(), x = +e.getAttribute(M.probe.end ? 'x2' : 'x1'), y = +e.getAttribute(M.probe.end ? 'y2' : 'y1');
        const p = [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; M.frames.push({ gap: Math.hypot(p[0] - M.ptr[0], p[1] - M.ptr[1]) }); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

await (async () => {
  const cdp = await launchBrowser({ tag: '548live' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const results = [];
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150); };
    for (const host of ['sketchstudio', 'shaper']) {
      const SEL = host === 'shaper' ? '#design-canvas' : '#svgCanvas';
      const tool = (t) => evalJs(`document.getElementById('tool-${t}').click()`).then(() => sleep(150));
      const lines = () => evalJs(`JSON.stringify([...document.querySelectorAll('${SEL} line.shape-elem')].map(e => { const m = e.getScreenCTM(); const P = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; return [P(+e.getAttribute('x1'), +e.getAttribute('y1')), P(+e.getAttribute('x2'), +e.getAttribute('y2'))]; }))`).then(JSON.parse);
      const nearEnd = async (p) => { let best = null; (await lines()).forEach((l, i) => [0, 1].forEach(end => { const d = Math.hypot(l[end][0] - p[0], l[end][1] - p[1]); if (!best || d < best.d) best = { d, i, end, p: l[end] }; })); return best; };
      const ppu = () => evalJs(`(() => { const o = document.querySelector('${SEL} .joint-handle[data-joint-id="j_origin"]'); return o ? o.getScreenCTM().a : null; })()`);
      for (const [name, stepPx] of [['free-point', 10], ['free-point', 40], ['rect-corner', 40]]) {
        // a fresh page, empty storage, the axis snap and the grid magnet off
        const url = `http://127.0.0.1:${port}/apps/${host}/index.html`;
        await navigate(url, 8000);
        await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false, GRID_MAGNETISM: 0.001 })); return true; })()`);
        await navigate(url, 8000);
        if (host === 'shaper') { await waitFor(`!!document.querySelector('.mode-btn[data-mode="design"]')`, 'Shaper'); await evalJs(`document.querySelector('.mode-btn[data-mode="design"]').click()`); }
        await waitFor(`(() => { const c = document.querySelector('${SEL}'); return !!c && c.getBoundingClientRect().width > 0 && c.dataset.docReady === '1' && !!document.getElementById('tool-select'); })()`, host + ' ready');
        await sleep(600);
        await evalJs(RECORDER); await evalJs(`window.__drag548.sel = '${SEL}'`);
        const c = await evalJs(`(() => { const r = document.querySelector('${SEL}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        for (let i = 0; i < 80; i++) { const k = await ppu(); if (k != null && k < 0.3) break; await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: 500 }); await sleep(40); }
        const k = await ppu();
        assert.ok(k < 0.3, `${host}: zoomed out to a large drawing (px per unit ${k})`);
        let grab;
        if (name === 'free-point') { await tool('line'); await click(c.x - 300, c.y - 250); await click(c.x - 160, c.y - 140); await esc(); grab = await nearEnd([c.x - 160, c.y - 140]); }
        else { await tool('rect'); await click(c.x - 300, c.y - 250); await click(c.x - 160, c.y - 140); await esc(); grab = await nearEnd([c.x - 160, c.y - 140]); }
        await tool('select');
        assert.ok(grab && grab.d < 3, `${host} ${name}: the grabbed point is drawn where it was placed`);
        const A = { x: grab.p[0], y: grab.p[1] };
        await mouse('mouseMoved', A.x, A.y, 0); await sleep(40); await mouse('mousePressed', A.x, A.y, 1); await sleep(60);
        await evalJs(`(() => { const M = window.__drag548; M.frames = []; M.probe = ${JSON.stringify({ i: grab.i, end: grab.end })}; M.on = true; return true; })()`);
        const n = Math.round(320 / stepPx);
        let cur = A;
        for (let i = 1; i <= n; i++) { cur = { x: A.x + stepPx * i, y: A.y + stepPx * 0.35 * i }; await mouse('mouseMoved', cur.x, cur.y, 1); await sleep(16); }
        const moving = await evalJs(`window.__drag548.frames.length`);
        for (let f = 0; f < 10; f++) await evalJs(`new Promise(r => requestAnimationFrame(() => r(true)))`);
        const frames = await evalJs(`(() => { const M = window.__drag548; M.on = false; return JSON.stringify(M.frames); })()`).then(JSON.parse);
        await mouse('mouseReleased', cur.x, cur.y, 0); await sleep(200);
        const worst = Math.max(...frames.map(f => f.gap)), last = frames[frames.length - 1].gap;
        results.push(`${host} ${name} ${stepPx} px/event (${(stepPx / k).toFixed(0)} units): ${frames.length} frames (${moving} while moving), worst gap ${worst.toFixed(2)} px, after the stop ${last.toFixed(2)} px`);
        assert.ok(frames.length > 5, `${host} ${name}: frames were recorded`);
        assert.ok(worst < 1, `${host} ${name} ${stepPx} px/event: the dragged point stays under the cursor every frame (worst gap ${worst.toFixed(2)} px; per frame: ${frames.map(f => f.gap.toFixed(1)).join(" ")})`);
      }
    }
    console.log(results.join('\n'));
    console.log('drag-follow-live.test.js: ok');
  } finally { await cdp.close(); }
})();
