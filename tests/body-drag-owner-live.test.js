// tests/body-drag-owner-live.test.js -- TASK 538, the owner's case in the REAL SketchStudio (headless, REAL mouse via CDP Input.dispatchMouseEvent):
// an arc drawn with the arc tool below the origin, its centre held on the Y axis by the H/V tool (origin + centre: vertical) and 50 from the
// origin by the dimension tool; its ends free. Grab the arc's BODY at its lowest point and pull it down (20 mouse steps): the centre stays,
// the radius grows by the pull, both ends keep their angles, the sweep its sign and size; pull back up: it returns. The owner's numbers (50 below
// the origin, pulled 10) at the app's default zoom (about 78 px per unit) are kept in ratio: DIM 1.5 units below the origin, PULL 0.3. Geometry is read from the DOM
// (the arc path and its centre joint dot), in world units through the canvas transform. World y points down (SVG).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '538' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const EV = process.env.EVIDENCE_DIR;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const dragPath = async (from, to, steps = 20) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1); await sleep(40);
      for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, 1); await sleep(30); }
      await sleep(100); await mouse('mouseReleased', to.x, to.y, 0); await sleep(400);
    };
    const key = (k, code, vk) => sendRealKey(send, k, code, vk);
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    // the arc as drawn: its path (start, end, radius, flags) in WORLD units (the path's own coordinates), the canvas transform (world -> screen),
    // the origin's screen position, and every drawn joint dot (world) so the arc centre can be found as the dot at the path's centre
    const geom = () => evalJs(`(() => {
      const p = document.querySelector('#svgCanvas path.shape-elem'); const m = (p || document.querySelector('#svgCanvas .joint-handle')).getScreenCTM();
      const o = document.querySelector('#svgCanvas .joint-handle[data-joint-id="j_origin"]');
      const out = { m: [m.a, m.b, m.c, m.d, m.e, m.f], origin: o ? [+o.getAttribute('cx'), +o.getAttribute('cy')] : null, dots: [] };
      if (p) { const n = (p.getAttribute('d') || '').match(/-?\\d+\\.?\\d*(e-?\\d+)?/g).map(Number); out.arc = { d: p.getAttribute('d'), s: [n[0], n[1]], r: n[2], large: n[5], sweep: n[6], e: [n[7], n[8]] }; }
      for (const c of document.querySelectorAll('#svgCanvas circle')) { if (c.classList.contains('joint-handle')) continue; const r = +c.getAttribute('r'); if (r > 0 && r < 20) out.dots.push([+c.getAttribute('cx'), +c.getAttribute('cy')]); }
      out.labels = [...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim());
      return JSON.stringify(out); })()`).then(JSON.parse);
    const toScreen = (g, p) => ({ x: g.m[0] * p[0] + g.m[2] * p[1] + g.m[4], y: g.m[1] * p[0] + g.m[3] * p[1] + g.m[5] });
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // the arc centre: the drawn dot at distance r from both path ends (the path is drawn from the joints)
    const centreOf = (g) => { const c = g.dots.filter(q => Math.abs(dist(q, g.arc.s) - g.arc.r) < 1e-3 * g.arc.r && Math.abs(dist(q, g.arc.e) - g.arc.r) < 1e-3 * g.arc.r); assert.strictEqual(c.length > 0, true, 'the arc centre dot is drawn: ' + JSON.stringify(g)); return c[0]; };
    const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI;
    const state = (g) => { const c = centreOf(g); return { c, r: g.arc.r, aS: ang(c, g.arc.s), aE: ang(c, g.arc.e), large: g.arc.large, sweep: g.arc.sweep }; };
    // a legible crop around the arc and the origin (scale 2)
    const shot = async (name, g) => {
      if (!EV) return;
      const c = toScreen(g, centreOf(g)), o = toScreen(g, g.origin), R = g.arc.r * g.m[0] + 60;
      const x = Math.min(c.x - R, o.x - 40), y = Math.min(o.y - 40, c.y - R), w = 2 * R, h = Math.max(c.y + R, o.y + 40) - y;
      const png = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 2 } });
      fs.writeFileSync(path.join(EV, name), Buffer.from(png.data, 'base64'));
    };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-arc') && !!document.getElementById('tool-select'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    // pan the view up 250 px (a real middle-button drag) so the arc below the origin sits clear of the canvas edges (a drag near an edge pans the view)
    const cv = await centerOf('#svgCanvas');
    const mid = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'middle', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await mid('mouseMoved', cv.x + 300, cv.y + 100, 0); await mid('mousePressed', cv.x + 300, cv.y + 100, 4);
    for (let i = 1; i <= 10; i++) { await mid('mouseMoved', cv.x + 300, cv.y + 100 - 25 * i, 4); await sleep(30); }
    await mid('mouseReleased', cv.x + 300, cv.y - 150, 0); await sleep(400);
    let g = await geom();
    assert(g.origin, 'the origin joint is drawn');
    const O = toScreen(g, g.origin), scale = g.m[3], DIM = 1.5, PULL = 0.3;
    assert(O.y < cv.y - 100, 'the view panned up: origin at screen y ' + O.y);
    // 1. the arc: centre DIM below the origin, ends at 20 and 160 degrees below it (screen y down), radius 0.9 units (all on screen below the origin)
    const C = { x: O.x, y: O.y + DIM * scale }, Rpx = 0.9 * scale, a0 = 20 * Math.PI / 180, a1 = 160 * Math.PI / 180;
    await clickEl('#tool-arc');
    await click(C.x, C.y); await click(C.x + Rpx * Math.cos(a0), C.y + Rpx * Math.sin(a0)); await click(C.x + Rpx * Math.cos(a1), C.y + Rpx * Math.sin(a1));
    await key('Escape', 'Escape', 27); await sleep(300);
    g = await geom();
    assert(g.arc, 'the arc is drawn');
    const c0 = toScreen(g, centreOf(g));
    // 2. vertical with the origin: the H/V tool on the origin and the arc centre
    await clickEl('#tool-hv'); await click(O.x, O.y); await click(c0.x, c0.y); await key('Escape', 'Escape', 27); await sleep(300);
    // 3. the DIM dimension between the origin and the centre
    await clickEl('#tool-dim'); await click(O.x, O.y); await click(c0.x, c0.y); await click(O.x + 90, (O.y + c0.y) / 2);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension input', 8000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: String(DIM) }); await sleep(100); await key('Enter', 'Enter', 13); await sleep(600);
    await key('Escape', 'Escape', 27); await clickEl('#tool-select'); await sleep(300);
    g = await geom();
    const before = state(g);
    console.log('built:', JSON.stringify({ labels: g.labels, origin: g.origin, centre: before.c, r: before.r, ends: [before.aS, before.aE], path: g.arc.d }));
    assert(g.labels.some(t => parseFloat(t) === DIM), `a driving ${DIM} dimension: ` + JSON.stringify(g.labels));
    assert(Math.abs(before.c[0] - g.origin[0]) < 1e-6 && Math.abs(before.c[1] - g.origin[1] - DIM) < 1e-6, `the centre is held ${DIM} below the origin on the Y axis: ` + JSON.stringify(before.c));
    assert(Math.abs(before.aS - 20) < 1 && Math.abs(before.aE - 160) < 1, 'the arc is as drawn (ends at 20 and 160 degrees): ' + JSON.stringify(before));
    await shot('owner-arc-before.png', g);

    // 4. pull the body (the arc's lowest point) down by PULL, then back up
    const low = toScreen(g, [before.c[0], before.c[1] + before.r]);
    await dragPath(low, { x: low.x, y: low.y + PULL * scale });
    g = await geom();
    const down = state(g);
    await shot('owner-arc-after-down.png', g);
    console.log(`pulled down ${PULL}:`, JSON.stringify(down));
    assert(dist(down.c, before.c) < 1e-6, `the centre stays (${JSON.stringify(before.c)} -> ${JSON.stringify(down.c)})`);
    assert(Math.abs(down.r - before.r - PULL) < 0.01, `the radius grows by ${PULL} (${before.r} -> ${down.r})`);
    assert(Math.abs(down.aS - before.aS) < 0.1 && Math.abs(down.aE - before.aE) < 0.1, `the ends keep their angles (${before.aS}, ${before.aE} -> ${down.aS}, ${down.aE})`);
    assert(down.large === before.large && down.sweep === before.sweep, 'the drawn sweep keeps its flags (no complement)');
    const low2 = toScreen(g, [down.c[0], down.c[1] + down.r]);
    await dragPath(low2, { x: low2.x, y: low2.y - PULL * scale });
    g = await geom();
    const back = state(g);
    await shot('owner-arc-after-up.png', g);
    console.log(`pulled back up ${PULL}:`, JSON.stringify(back));
    assert(dist(back.c, before.c) < 1e-6 && Math.abs(back.r - before.r) < 0.01, `pulled back up: centre kept, radius back (${back.r})`);
    assert(Math.abs(back.aS - before.aS) < 0.1 && Math.abs(back.aE - before.aE) < 0.1, 'pulled back up: the ends keep their angles');
    if (EV) fs.writeFileSync(path.join(EV, 'owner-arc-live.json'), JSON.stringify({ before, down, back }, null, 1));
    console.log(`body-drag-owner-live.test.js: ok (radius ${before.r.toFixed(3)} -> ${down.r.toFixed(3)} -> ${back.r.toFixed(3)}, centre kept)`);
  } finally { await cdp.close(); }
})();
